import Anthropic from "@anthropic-ai/sdk";
import { backtestFor, MODE_LABEL, runAction, scanAllMarkets, type ActionName } from "./service";
import { pushAudit, pushMessage } from "./store";
import { formatPrice, normalizeSymbol, SYMBOLS } from "./symbols";
import type {
  AccountProfile,
  ChatCard,
  Decision,
  PlatformStore,
  Quote,
  Snapshot,
  StrategyId,
  SymbolCode,
} from "./types";

const HELP = `AurumDesk Pro Copilot commands & capabilities:
- Market Decision: "Should I buy or sell gold now?" or "/analyze EURUSD"
- Multi-Market Scanner: "Scan all markets" or "/scan" (ranks Gold, Silver, FX & BTC)
- Live Demo Setup: "Simulate a buy setup" or "Simulate sell" (creates a live approval ticket)
- Trade Approvals: "Approve", "Approve half", or "Reject"
- Position Control: "Move stop to break-even", "Close half", "Close my trade", "Flatten all"
- Pending & Price Alerts: "Alert me at 3645" or use the Order Ticket for Limit/Stop orders
- Strategy Switching: "Switch to Key-Level strategy", "Killzone strategy", "Prop Shield", "Trend Pullback"
- Risk & Modes: "Semi-auto", "Auto mode", "Signal only", "Buy only", "Sell only", "Pause", "Risk 0.5%", "Daily loss 3%", "Prop firm preset", "Kill switch", "Resume"
- Reports & Proof: "Show my revenue", "Upcoming news", "Daily briefing", "Backtest gold on 4H"`;

const SYSTEM = `You are AurumDesk Pro AI, an institutional-grade XAU/USD and multi-asset trading decision copilot.
Strict governance rules:
1. Rely ONLY on the live JSON context supplied in the prompt. Never fabricate prices, P&L, indicators, or calendar events.
2. You advise and explain; deterministic server guardrails enforce risk limits, position sizing, and execution.
3. Explain clearly WHY to trade or WHY NOT TO TRADE, referencing specific gates (HTF Trend, 15m RSI/Candle, Structure R:R room, ATR Volatility, Session Killzone, Spread, News Blackout, Personal Risk Guard).
4. Keep answers concise, structured, and executive-ready (under 180 words).
5. Conclude market commentary with: "Decision support only — not financial advice."`;

export interface CopilotResponse {
  reply: string;
  card?: ChatCard;
}

function decisionSummary(d: Decision | null, q: Quote | null): CopilotResponse {
  if (!d || !q) {
    return {
      reply:
        "Live market feed is temporarily degraded, so trading is held safe (fail-closed). Wait a few seconds for reconnection.",
    };
  }
  const sym = d.symbol;
  const passedCount = d.gates.filter((g) => g.pass).length;
  const lines: string[] = [
    `${sym} VERDICT: ${d.verdict} · Gate Score ${d.score}/100 (${passedCount}/${d.gates.length} gates passed) · Strategy: ${d.strategyName}`,
    `Live Quote: Bid ${formatPrice(sym, q.bid)} / Ask ${formatPrice(sym, q.ask)} · Spread ${formatPrice(sym, q.spread)} · Session: ${d.sessionName}`,
  ];

  if (d.plan) {
    const p = d.plan;
    lines.push(
      `Actionable Plan: ${p.side} ${p.lots.toFixed(2)} lots @ ${formatPrice(sym, p.entry)} | SL ${formatPrice(sym, p.stopLoss)}${p.tp1Price ? ` | TP1 ${formatPrice(sym, p.tp1Price)} (50% + BE)` : ""} | TP ${formatPrice(sym, p.takeProfit)} (${p.rewardRatio}R) | Risk $${p.riskAmount.toFixed(2)}.`,
    );
    lines.push('Click Approve on the card below (or type "Approve" / "Approve half").');
  } else {
    const blockers = d.gates.filter((g) => !g.pass).map((g) => `${g.name} (${g.detail})`);
    lines.push(`Why NOT to purchase/sell right now:`);
    for (const b of blockers.slice(0, 4)) lines.push(`• ${b}`);
    lines.push(`Tip: Want to test the approval & live P&L workflow right now? Type "Simulate buy setup".`);
  }
  lines.push("Decision support only — not financial advice.");

  return {
    reply: lines.join("\n"),
    card: {
      kind: "decision",
      symbol: sym,
      verdict: d.verdict,
      score: d.score,
      mid: q.mid,
      spread: q.spread,
      plan: d.plan,
      gates: d.gates,
    },
  };
}

function revenueSummary(snap: Snapshot): CopilotResponse {
  const st = snap.stats;
  const s = snap.state;
  const lines = [
    `${s.name} Performance Summary`,
    `Balance: $${s.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} | Equity: $${snap.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    `Net Revenue: ${st.netPnl >= 0 ? "+" : "-"}$${Math.abs(st.netPnl).toFixed(2)} (${st.netReturnPct >= 0 ? "+" : ""}${st.netReturnPct.toFixed(2)}%) across ${st.closedCount} closed trades`,
    `Win Rate: ${st.winRate.toFixed(1)}% (${st.wins}W / ${st.losses}L) · Profit Factor: ${st.profitFactor.toFixed(2)} · Sharpe: ${st.sharpeRatio.toFixed(2)} · Expectancy: $${st.expectancyUsd.toFixed(2)}/trade`,
    `Max Drawdown: ${st.maxDrawdownPct.toFixed(2)}% (limit ${s.settings.maxDrawdownPct}%) · Today: ${st.todayPnl >= 0 ? "+" : "-"}$${Math.abs(st.todayPnl).toFixed(2)}`,
  ];
  return {
    reply: lines.join("\n"),
    card: {
      kind: "revenue",
      balance: s.balance,
      equity: snap.equity,
      stats: st,
    },
  };
}

function newsSummary(snap: Snapshot): CopilotResponse {
  const now = Date.now();
  const upcoming = snap.news.filter((n) => Date.parse(n.time) >= now - 60 * 60000).slice(0, 8);
  if (!upcoming.length) {
    return { reply: "No remaining high/medium macro releases left in this week's calendar window." };
  }
  const srcNote =
    snap.newsSource === "live"
      ? "Live ForexFactory feed"
      : snap.newsSource === "cached"
        ? "Cached ForexFactory feed"
        : "Built-in weekly macro schedule (live feed rate-limited)";
  return {
    reply:
      `Upcoming Macro Releases (${srcNote}):\n` +
      upcoming
        .map(
          (n) =>
            `• ${n.time.slice(0, 16).replace("T", " ")} UTC [${n.currency} · ${n.impact}] ${n.title}${
              n.forecast ? ` (fcst ${n.forecast}, prev ${n.previous || "-"})` : ""
            }`,
        )
        .join("\n") +
      `\n\nBlackout window: ${snap.state.strategy.newsBlackoutBeforeMin}m before to ${snap.state.strategy.newsBlackoutAfterMin}m after High-Impact events.`,
  };
}

async function askClaude(question: string, s: AccountProfile, snap: Snapshot): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const context = JSON.stringify({
    account: s.name,
    symbol: snap.symbol,
    quote: snap.quote,
    watchlist: snap.watchlist.map((w) => ({ symbol: w.symbol, mid: w.mid, chgPct: w.dayChangePct, spread: w.spread })),
    decision: snap.decision,
    stats: {
      balance: s.balance,
      equity: snap.equity,
      netPnl: snap.stats.netPnl,
      winRate: snap.stats.winRate,
      profitFactor: snap.stats.profitFactor,
      maxDrawdownPct: snap.stats.maxDrawdownPct,
      todayPnl: snap.stats.todayPnl,
    },
    openPositions: s.trades.filter((t) => t.status === "open"),
    pendingProposal: s.proposal,
    settings: s.settings,
    strategy: s.strategy,
    upcomingNews: snap.news.slice(0, 10),
  });
  const res = await client.messages.create({
    model,
    max_tokens: 650,
    system: SYSTEM,
    messages: [{ role: "user", content: `Live platform telemetry:\n${context}\n\nTrader message: ${question}` }],
  });
  const text = res.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n")
    .trim();
  return text || null;
}

export async function handleChat(
  text: string,
  s: AccountProfile,
  snap: Snapshot,
  store?: PlatformStore,
): Promise<CopilotResponse> {
  const trimmed = text.trim();
  const low = trimmed.toLowerCase();
  const run = (name: ActionName, payload: Record<string, unknown> = {}) =>
    runAction(name, payload, s, snap, store);
  const pick = (re: RegExp): number | undefined => {
    const m = low.match(re);
    return m ? Number(m[1]) : undefined;
  };

  if (/^(\/)?(help|commands|what can you do)\b/.test(low) || low === "?") {
    return { reply: HELP };
  }

  // Multi-market scanner
  if (/^\/scan\b|\bscan (all|market|markets|symbols|pairs)\b|\bbest (setup|pair|market)\b|\bcompare markets\b/.test(low)) {
    const rows = await scanAllMarkets(store);
    const top = rows[0];
    return {
      reply: top
        ? `Scanned ${rows.length} live markets. Highest gate alignment: ${top.symbol} (${top.score}/100, verdict: ${top.verdict}). Click any row in the Watchlist to switch charts.`
        : "Market scan completed.",
      card: { kind: "scanner", rows },
    };
  }

  // Simulate live setup for demo walkthrough
  if (/^\/sim|\bsimulate\b|\bdemo (setup|signal|trade|proposal)\b|\btest (proposal|approval)\b/.test(low)) {
    const side = /\bsell\b|\bshort\b/.test(low) ? "SELL" : "BUY";
    const symMatch = SYMBOLS.find((sym) => low.includes(sym.toLowerCase()));
    const msg = run("simulateSetup", { side, symbol: symMatch ?? snap.symbol });
    return {
      reply: msg,
      card: s.proposal ? { kind: "proposal", proposal: s.proposal } : undefined,
    };
  }

  // Emergency & Kill Switch
  if (/\bkill switch off\b|\brelease kill\b|\bturn off (the )?kill switch\b|^\/?resume$/.test(low)) {
    return { reply: run("resume") };
  }
  if (/\bkill switch\b|\bemergency\b|\bstop everything\b|\bhalt all\b/.test(low)) {
    return { reply: run("killSwitch") };
  }
  if (/\bresume trading\b|\bunpause\b/.test(low)) {
    return { reply: run("resumeTrading") };
  }
  if (/^\/?pause\b|\bpause trading\b/.test(low)) {
    return { reply: run("pause") };
  }

  // Position controls: Break-Even, Partial Close, Flatten
  if (/\bbreak(-| )?even\b|\bmove (stop|sl) to entry\b/.test(low)) {
    return { reply: run("breakEven") };
  }
  if (/\bclose half\b|\bpartial\b|\btake half\b|\bclose 50\b/.test(low)) {
    return { reply: run("partialClose") };
  }
  if (/^\/flatten\b|\bclose (all|every)\b|\bflatten\b/.test(low)) {
    return { reply: run("closeAll") };
  }
  if (/\bclose (my )?(open )?(trade|position)\b/.test(low)) {
    return { reply: run("closeTrade") };
  }

  // Proposal approvals
  if (/\bapprove half\b|\bhalf risk\b/.test(low)) {
    return { reply: run("approveHalf") };
  }
  if (/^\/?approve\b|\bconfirm trade\b|\bexecute proposal\b/.test(low)) {
    return { reply: run("approve") };
  }
  if (/^\/?reject\b|\bdecline\b|\bcancel (the )?proposal\b/.test(low)) {
    return { reply: run("reject") };
  }

  // Strategy presets via chat
  const stratMap: Array<[RegExp, StrategyId]> = [
    [/\bkey(-| )?level\b|\bprice action\b/, "key_level_pa"],
    [/\bkill\s?zone\b|\blondon breakout\b/, "killzone_breakout"],
    [/\bprop shield\b|\bcapital shield\b/, "prop_shield"],
    [/\btrend pullback\b/, "trend_pullback"],
  ];
  for (const [re, id] of stratMap) {
    if (re.test(low) && /switch|use|strategy|preset|activate|set/.test(low)) {
      return { reply: run("setStrategyPreset", { strategyId: id }) };
    }
  }

  if (/\bprop(-| )?firm\b|\bftmo\b/.test(low) && /preset|apply|set|mode|rule/.test(low)) {
    return { reply: run("propFirm") };
  }

  // Price alerts via chat: e.g. "alert me when XAUUSD crosses 3640"
  if (/\balert\b|\bnotify\b/.test(low)) {
    const pMatch = low.match(/(?:at|above|below|crosses|reaches)\s*\$?([\d.]+)/);
    if (pMatch) {
      const symFound = SYMBOLS.find((sym) => low.includes(sym.toLowerCase())) ?? snap.symbol;
      const cond = /\bbelow\b|\bunder\b/.test(low) ? "BELOW" : /\babove\b|\bover\b/.test(low) ? "ABOVE" : undefined;
      return {
        reply: run("addAlert", {
          symbol: normalizeSymbol(symFound),
          targetPrice: Number(pMatch[1]),
          condition: cond,
          note: "Created from AI Copilot",
        }),
      };
    }
  }

  // Direction & Modes
  if (/\bbuy only\b|\bonly buy\b/.test(low)) return { reply: run("direction", { direction: "buy" }) };
  if (/\bsell only\b|\bonly sell\b/.test(low)) return { reply: run("direction", { direction: "sell" }) };
  if (/\bboth (directions|ways)\b|\ballow both\b/.test(low)) return { reply: run("direction", { direction: "both" }) };

  if (/\bsignal (only|mode)\b|\balerts only\b/.test(low)) return { reply: run("mode", { mode: "signal" }) };
  if (/\bsemi\b|\bsemi-?auto\b|\bapproval mode\b/.test(low)) return { reply: run("mode", { mode: "semi" }) };
  if (/\bfull(y)? auto\b|\bauto mode\b|\bautomatic mode\b|\bset (mode )?(to )?auto\b/.test(low)) {
    return { reply: run("mode", { mode: "auto" }) };
  }

  // Numeric risk guard updates
  const payload: Record<string, unknown> = {};
  const risk = pick(/risk[^\d]{0,25}([\d.]+)\s*%?/);
  const daily = pick(/daily[^\d]{0,25}([\d.]+)\s*%?/);
  const dd = pick(/drawdown[^\d]{0,25}([\d.]+)\s*%?/);
  const spread = pick(/spread[^\d]{0,20}([\d.]+)/);
  const open = pick(/(?:max )?open (?:trades?|positions?)[^\d]{0,20}([\d.]+)/);
  if (risk !== undefined) payload.riskPct = risk;
  if (daily !== undefined) payload.dailyLossPct = daily;
  if (dd !== undefined) payload.maxDrawdownPct = dd;
  if (spread !== undefined) payload.maxSpread = spread;
  if (open !== undefined) payload.maxOpenTrades = open;
  if (Object.keys(payload).length && /set|change|update|limit|risk|spread|drawdown|open/.test(low)) {
    return { reply: run("settings", payload) };
  }

  // Backtest + Monte Carlo via chat
  if (/backtest|monte carlo/.test(low)) {
    const tf = /15m/.test(low) ? "15m" : /1h/.test(low) ? "1h" : /4h|4 ?hour/.test(low) ? "4h" : "1d";
    const symFound = SYMBOLS.find((sym) => low.includes(sym.toLowerCase())) ?? snap.symbol;
    try {
      const r = await backtestFor({ symbol: symFound, timeframe: tf });
      return {
        reply: [
          `${r.symbol} Backtest (${r.strategyName} · ${r.timeframe.toUpperCase()} · ${r.bars} bars · ${r.trades.length} trades)`,
          `Win Rate: ${r.winRate.toFixed(1)}% | Profit Factor: ${r.profitFactor.toFixed(2)} | Net: ${r.netR >= 0 ? "+" : ""}${r.netR.toFixed(2)}R (${r.netDollars >= 0 ? "+" : "-"}$${Math.abs(r.netDollars).toFixed(2)})`,
          `Historical Max DD: ${r.maxDrawdownPct.toFixed(2)}% | Sharpe: ${r.sharpeRatio.toFixed(2)}`,
          `500-Run Monte Carlo: Median Ending $${r.monteCarlo.p50EndingBalance.toLocaleString()} | 95% Worst DD: ${r.monteCarlo.p95WorstDrawdownPct.toFixed(2)}% | Prop-Limit Breach Risk: ${r.monteCarlo.probBreachPropLimitPct.toFixed(1)}%`,
          "Open the 'Backtest & Monte Carlo' workspace for the interactive fan chart and trade replay.",
        ].join("\n"),
      };
    } catch (e) {
      return { reply: `Backtest error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  if (/\bnews\b|calendar|\bevents?\b|\bcpi\b|\bnfp\b|fomc|\bgdp\b|\bpce\b/.test(low)) {
    return newsSummary(snap);
  }

  if (/revenue|profit|p&l|pnl|earn|report|history|how much|balance|performance|win rate|my trades|drawdown|sharpe/.test(low)) {
    return revenueSummary(snap);
  }

  if (/briefing|brief|daily summary|summary of today|status/.test(low)) {
    const textBody = [
      `Executive Briefing (${new Date().toISOString().slice(0, 10)}) — ${s.name}`,
      `${snap.symbol}: ${snap.quote ? formatPrice(snap.symbol, snap.quote.mid) : "--"} · Verdict: ${snap.decision?.verdict ?? "HOLD"} (Score ${snap.decision?.score ?? 0}/100)`,
      `Governance: ${MODE_LABEL[s.settings.mode]} · Direction: ${s.settings.direction.toUpperCase()} · Kill Switch: ${s.settings.killSwitch ? "ACTIVE" : "Armed/Off"}`,
      `Account: Balance $${s.balance.toFixed(2)} · Equity $${snap.equity.toFixed(2)} · Today ${snap.stats.todayPnl >= 0 ? "+" : "-"}$${Math.abs(snap.stats.todayPnl).toFixed(2)} · Net ${snap.stats.netReturnPct >= 0 ? "+" : ""}${snap.stats.netReturnPct.toFixed(2)}%`,
    ].join("\n");
    pushMessage(s, "BRIEFING", textBody, snap.symbol);
    pushAudit(s, "briefing", "Executive briefing generated");
    return { reply: textBody };
  }

  if (/^(hi|hello|hey|salam|assalam|good (morning|afternoon|evening))\b/.test(low)) {
    const dec = decisionSummary(snap.decision, snap.quote);
    return {
      reply: `Hello! ${s.name} is active. Here is your live ${snap.symbol} assessment:\n\n${dec.reply}`,
      card: dec.card,
    };
  }

  // Why did last trade win/lose?
  if (/last trade|previous trade|why did .* (lose|win|close)/.test(low)) {
    const lastClosed = s.trades.find((t) => t.status === "closed");
    if (!lastClosed) {
      return { reply: "There are no closed trades on this account yet. Switch to '$100k Prop-Firm Showcase' in the top bar to inspect 20+ historical trades." };
    }
    return {
      reply: [
        `Last Closed Trade: ${lastClosed.symbol} ${lastClosed.side} ${lastClosed.initialLots.toFixed(2)} lots`,
        `Entry ${formatPrice(lastClosed.symbol, lastClosed.entry)} -> Exit ${formatPrice(lastClosed.symbol, lastClosed.exitPrice)} (${lastClosed.closeReason})`,
        `Net Result: ${lastClosed.pnl >= 0 ? "+" : "-"}$${Math.abs(lastClosed.pnl).toFixed(2)} (${lastClosed.rMultiple >= 0 ? "+" : ""}${lastClosed.rMultiple.toFixed(2)}R)`,
        `Setup Thesis: ${lastClosed.reason}`,
        lastClosed.notes ? `Journal Note: ${lastClosed.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // General market / decision questions -> try Claude first if key is present, otherwise return rich deterministic analysis
  try {
    const ai = await askClaude(trimmed, s, snap);
    if (ai) {
      const attachDecision = /buy|sell|entry|gold|xau|setup|now|chart/.test(low);
      return {
        reply: ai,
        card: attachDecision && snap.decision && snap.quote
          ? {
              kind: "decision",
              symbol: snap.symbol,
              verdict: snap.decision.verdict,
              score: snap.decision.score,
              mid: snap.quote.mid,
              spread: snap.quote.spread,
              plan: snap.decision.plan,
              gates: snap.decision.gates,
            }
          : undefined,
      };
    }
  } catch {
    /* fallback smoothly to deterministic analysis */
  }

  if (/should i|buy|sell|right now|analy[sz]e|analysis|decision|setup|signal|gold|xau|silver|xag|eur|gbp|jpy|btc|market|price|level|support|resistance|trend/.test(low)) {
    return decisionSummary(snap.decision, snap.quote);
  }

  return {
    reply: `Here is the live ${snap.symbol} status alongside available commands:\n\n${decisionSummary(snap.decision, snap.quote).reply}\n\nType "help" anytime to see all voice & text commands.`,
    card: decisionSummary(snap.decision, snap.quote).card,
  };
}
