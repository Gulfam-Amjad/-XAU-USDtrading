import { runBacktest, type BacktestOptions, type BacktestResult } from "./backtest";
import { evaluate, sizePosition } from "./engine";
import { evaluatePolicy, normalizePolicy } from "./policy";
import { getBars, getEconomicNews, getQuote, getWatchlistQuotes } from "./market";
import { buildCleanPaperAccount, buildShowcaseAccount, defaultStrategy, STRATEGY_PRESETS } from "./seed";
import {
  closeAll,
  closeTrade,
  computeStats,
  createSimulatedProposal,
  forwardTelegramIfEnabled,
  getActiveAccount,
  loadPlatformStore,
  managePositionsMulti,
  modifyTradeProtection,
  moveTradeBreakEven,
  nowIso,
  openTrade,
  partialCloseTrade,
  placePendingOrder,
  pushAudit,
  pushMessage,
  queueMt5Command,
  riskFrom,
  round2,
  roundPrice,
  savePlatformStore,
  uid,
} from "./store";
import { formatPrice, marginRequiredUsd, normalizeSymbol, SYMBOLS, SYMBOL_SPECS } from "./symbols";
import type {
  AccountProfile,
  Bar,
  Decision,
  DirectionLock,
  MarketScanRow,
  Mode,
  NewsEvent,
  OrderType,
  PlatformStore,
  Quote,
  Settings,
  Side,
  Snapshot,
  StrategyConfig,
  StrategyId,
  SymbolCode,
  Timeframe,
} from "./types";

export type Tf = Timeframe;
export const TFS: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

export function normalizeTf(x: unknown): Timeframe {
  return TFS.includes(x as Timeframe) ? (x as Timeframe) : "1h";
}

const CHART_LIMIT: Record<Timeframe, number> = {
  "1m": 240,
  "5m": 240,
  "15m": 192,
  "30m": 192,
  "1h": 168,
  "4h": 180,
  "1d": 500,
};

const TTL_MS = 8000;
const STALE_OK_MS = 120000;
const cache = new Map<string, { at: number; bars: Bar[] }>();

export async function cachedBars(symbol: SymbolCode, interval: Timeframe, limit: number): Promise<Bar[]> {
  const key = `${symbol}:${interval}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bars;
  try {
    const bars = await getBars(symbol, interval, limit);
    cache.set(key, { at: Date.now(), bars });
    return bars;
  } catch (e) {
    if (hit && Date.now() - hit.at < STALE_OK_MS) return hit.bars;
    throw e;
  }
}

const closed = (bars: Bar[]): Bar[] => bars.filter((b) => !b.isOpen);

function applyDecision(store: PlatformStore, s: AccountProfile, d: Decision): void {
  const sigKey = d.verdict === "DO NOT TRADE" ? "" : `${d.symbol}:${d.verdict}`;
  const prev = s.lastSignalKey;

  // Expire or withdraw non-simulated proposals if setup invalidates
  if (s.proposal) {
    if (Date.parse(s.proposal.expiresAt) < Date.now()) {
      pushAudit(s, "proposal.expired", `${s.proposal.symbol} ${s.proposal.plan.side} proposal expired`);
      pushMessage(s, "INFO", `Proposal on ${s.proposal.symbol} expired without approval. No trade was taken.`, s.proposal.symbol);
      s.proposal = null;
    } else if (!s.proposal.simulated && s.proposal.symbol === d.symbol && d.verdict !== s.proposal.plan.side) {
      pushAudit(s, "proposal.withdrawn", `${d.symbol} setup invalidated`);
      pushMessage(s, "INFO", `Pending ${d.symbol} proposal withdrawn because live gates changed.`, d.symbol);
      s.proposal = null;
    }
  }

  if (sigKey && d.plan) {
    s.lastBlockKey = "";
    if (sigKey !== prev) {
      const p = d.plan;
      const alertText = `${d.symbol} ${d.verdict} setup (${d.strategyName}): Entry ${formatPrice(d.symbol, p.entry)}, SL ${formatPrice(d.symbol, p.stopLoss)}${p.tp1Price ? `, TP1 ${formatPrice(d.symbol, p.tp1Price)}` : ""}, TP ${formatPrice(d.symbol, p.takeProfit)} (${p.rewardRatio}R). Risk $${p.riskAmount.toFixed(2)} (${s.settings.riskPct}%), ${p.lots.toFixed(2)} lots. All 8 gates passed.`;
      pushMessage(s, d.verdict === "BUY" ? "BUY_ALERT" : "SELL_ALERT", alertText, d.symbol);
      if (store.telegram.forwardSignals) void forwardTelegramIfEnabled(store, alertText);

      const automated = s.settings.mode === "auto" || s.settings.mode === "semi";
      const verdict = automated && !s.settings.killSwitch ? evaluatePolicy(s, p, new Date()) : null;
      if (verdict && !verdict.allowed) {
        const text = `Client mandate blocked ${d.symbol} ${d.verdict}: ${verdict.reason}. No trade or proposal created.`;
        pushMessage(s, "RISK_GUARD", text, d.symbol);
        pushAudit(s, "policy.blocked", `${d.symbol} ${d.verdict}: ${verdict.reason}`);
        if (store.telegram.forwardSignals) void forwardTelegramIfEnabled(store, text);
      }

      if (!s.settings.killSwitch && (!verdict || verdict.allowed)) {
        const plan = verdict?.plan ?? p;
        if (verdict?.clamped) {
          pushAudit(s, "policy.clamped", `${d.symbol} lots reduced to client cap ${plan.lots}`);
        }
        const openCount = s.trades.filter((t) => t.status === "open").length;
        const needsHuman =
          s.settings.mode === "auto" &&
          s.policy.autoApprovalMaxRiskUsd > 0 &&
          plan.riskAmount > s.policy.autoApprovalMaxRiskUsd;
        if (needsHuman) {
          pushMessage(
            s,
            "INFO",
            `${d.symbol} ${d.verdict} risks $${plan.riskAmount.toFixed(2)} (> $${s.policy.autoApprovalMaxRiskUsd} auto-approval limit) — your approval is required.`,
            d.symbol,
          );
        }
        if (s.settings.mode === "auto" && !needsHuman && openCount < s.settings.maxOpenTrades) {
          openTrade(s, plan, `All 8 gates passed (${d.strategyName})`, "auto", {
            strategyId: d.strategyId,
            session: d.sessionName,
            store,
          });
        } else if (
          (s.settings.mode === "semi" || needsHuman) &&
          openCount < s.settings.maxOpenTrades &&
          !s.proposal
        ) {
          const now = Date.now();
          s.proposal = {
            id: uid(),
            symbol: d.symbol,
            plan,
            strategyId: d.strategyId,
            strategyName: d.strategyName,
            score: d.score,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 5 * 60000).toISOString(),
            reason: `All 8 gates passed (${d.strategyName})`,
            gatesSummary: d.gates.map((g) => g.name),
          };
          pushAudit(s, "proposal.created", `${d.symbol} ${d.verdict} ${p.lots} lots @ ${formatPrice(d.symbol, p.entry)}`);
        }
      }
    }
  } else {
    const failed = d.gates.filter((g) => !g.pass);
    const key = `${d.symbol}:${failed.map((g) => g.id).join(",")}`;
    if (key !== s.lastBlockKey && d.trendDirection) {
      s.lastBlockKey = key;
      const riskUsd = round2((s.balance * s.settings.riskPct) / 100);
      s.blockedSignals.unshift({
        id: uid(),
        at: nowIso(),
        symbol: d.symbol,
        intendedSide: d.trendDirection,
        price: d.plan?.entry ?? 0,
        score: d.score,
        blockingGates: failed.map((g) => g.name),
        savedRiskUsd: riskUsd,
        summary: `Trend ${d.trendDirection}, blocked by ${failed.map((g) => g.name).join(", ")}`,
      });
      s.blockedSignals = s.blockedSignals.slice(0, 80);
    }
  }
  s.lastSignalKey = sigKey;
}

export async function refresh(tf: Timeframe = "1h", symbol: SymbolCode = "XAUUSD"): Promise<Snapshot> {
  let store = loadPlatformStore();
  let s = getActiveAccount(store);
  let quote: Quote | null = null;
  let watchlist: Quote[] = [];
  let decision: Decision | null = null;
  let chartBars: Bar[] = [];
  let news: NewsEvent[] = [];
  let newsSource: "live" | "cached" | "curated" = "curated";
  let error: string | null = null;
  let reloaded = false;

  try {
    const [wl, d1, h4, h1, m15, chart, cal] = await Promise.all([
      getWatchlistQuotes(),
      cachedBars(symbol, "1d", 220),
      cachedBars(symbol, "4h", 140),
      cachedBars(symbol, "1h", 220),
      cachedBars(symbol, "15m", 192),
      cachedBars(symbol, tf, CHART_LIMIT[tf]),
      getEconomicNews(),
    ]);

    watchlist = wl;
    quote = wl.find((x) => x.symbol === symbol) ?? (await getQuote(symbol));
    if (!watchlist.some((x) => x.symbol === symbol) && quote) watchlist.unshift(quote);

    // All network awaits are done. Re-read the store NOW so the synchronous
    // load -> mutate -> save section below is atomic. Otherwise a slow poll would
    // overwrite actions (account switch, approvals, settings) made while it waited.
    store = loadPlatformStore();
    s = getActiveAccount(store);
    reloaded = true;

    chartBars = chart;
    news = cal.events;
    newsSource = cal.source;

    const quotesMap = new Map<SymbolCode, Quote>(watchlist.map((q) => [q.symbol, q]));
    quotesMap.set(symbol, quote);

    managePositionsMulti(s, quotesMap, store);
    const stats = computeStats(s, quotesMap);
    const risk = riskFrom(s, stats);

    decision = evaluate({
      symbol,
      d1: closed(d1),
      h4: closed(h4),
      h1: closed(h1),
      m15: closed(m15),
      quote,
      news: cal.events,
      newsOk: cal.liveOk,
      settings: s.settings,
      strategy: s.strategy,
      balance: s.balance,
      openTrades: s.trades.filter((t) => t.status === "open").length,
      currentLossStreak: stats.currentLossStreak,
      dailyPnlPct: risk.dailyPnlPct,
      drawdownPct: risk.drawdownPct,
      now: new Date(),
    });
    if (quote.mid > 0 && s.blockedSignals[0]?.price === 0) {
      s.blockedSignals[0].price = quote.mid;
    }
    applyDecision(store, s, decision);
  } catch (e) {
    error = `Market data degraded, trading held safe: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (reloaded) {
    savePlatformStore(store);
  } else {
    // Feed failed before the atomic section: never persist the stale copy, just read fresh state.
    store = loadPlatformStore();
    s = getActiveAccount(store);
  }
  const quotesMap = new Map<SymbolCode, Quote>(watchlist.map((q) => [q.symbol, q]));
  if (quote) quotesMap.set(symbol, quote);
  const stats = computeStats(s, quotesMap.size ? quotesMap : quote?.mid ?? 0);
  const risk = riskFrom(s, stats);

  return {
    symbol,
    quote,
    watchlist,
    decision,
    chartBars,
    chartTf: tf,
    news,
    newsSource,
    error,
    state: s,
    accounts: store.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      badge: a.badge,
      balance: a.balance,
      startingBalance: a.settings.startingBalance,
      propFirm: a.settings.propFirm,
    })),
    mt5Bridge: store.mt5Bridge,
    telegram: {
      chatId: store.telegram.chatId,
      enabled: store.telegram.enabled,
      forwardSignals: store.telegram.forwardSignals,
      forwardTrades: store.telegram.forwardTrades,
      lastSentAt: store.telegram.lastSentAt,
      hasBotToken: Boolean(store.telegram.botToken),
    },
    stats,
    equity: round2(s.balance + stats.openFloating),
    dailyPnlPct: risk.dailyPnlPct,
    drawdownPct: risk.drawdownPct,
    claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    generatedAt: nowIso(),
  };
}

export async function scanAllMarkets(store?: PlatformStore): Promise<MarketScanRow[]> {
  const st = store ?? loadPlatformStore();
  const acc = getActiveAccount(st);
  const [wl, cal] = await Promise.all([getWatchlistQuotes(), getEconomicNews()]);
  const quotesMap = new Map<SymbolCode, Quote>(wl.map((q) => [q.symbol, q]));
  const stats = computeStats(acc, quotesMap);
  const risk = riskFrom(acc, stats);

  const rows = await Promise.all(
    SYMBOLS.map(async (sym): Promise<MarketScanRow | null> => {
      try {
        const q = quotesMap.get(sym) ?? (await getQuote(sym));
        const [d1, h4, h1, m15] = await Promise.all([
          cachedBars(sym, "1d", 120),
          cachedBars(sym, "4h", 120),
          cachedBars(sym, "1h", 140),
          cachedBars(sym, "15m", 120),
        ]);
        const dec = evaluate({
          symbol: sym,
          d1: closed(d1),
          h4: closed(h4),
          h1: closed(h1),
          m15: closed(m15),
          quote: q,
          news: cal.events,
          newsOk: cal.liveOk,
          settings: acc.settings,
          strategy: acc.strategy,
          balance: acc.balance,
          openTrades: acc.trades.filter((t) => t.status === "open").length,
          currentLossStreak: stats.currentLossStreak,
          dailyPnlPct: risk.dailyPnlPct,
          drawdownPct: risk.drawdownPct,
          now: new Date(),
        });
        const firstFail = dec.gates.find((g) => !g.pass);
        return {
          symbol: sym,
          shortName: SYMBOL_SPECS[sym].shortName,
          mid: q.mid,
          dayChangePct: q.dayChangePct,
          spread: q.spread,
          verdict: dec.verdict,
          score: dec.score,
          trend: dec.trendDirection ?? "MIXED",
          rsi: round2(dec.rsi),
          topBlocker: firstFail ? firstFail.name : "All 8 gates clear",
        };
      } catch {
        return null;
      }
    }),
  );

  return rows.filter((r): r is MarketScanRow => r !== null).sort((a, b) => b.score - a.score);
}

export const MODE_LABEL: Record<Mode, string> = {
  signal: "Signal only (advisory alerts)",
  semi: "Semi-auto (human approval required)",
  auto: "Auto within hard limits",
};

export type ActionName =
  | "approve"
  | "approveHalf"
  | "reject"
  | "simulateSetup"
  | "placeOrder"
  | "closeTrade"
  | "partialClose"
  | "breakEven"
  | "modifyTrade"
  | "cancelPending"
  | "addAlert"
  | "deleteAlert"
  | "switchAccount"
  | "createAccount"
  | "resetAccount"
  | "setStrategyPreset"
  | "updateStrategyConfig"
  | "updateJournal"
  | "mode"
  | "direction"
  | "settings"
  | "pause"
  | "resumeTrading"
  | "killSwitch"
  | "resume"
  | "closeAll"
  | "propFirm"
  | "updateBridge"
  | "updateTelegram"
  | "testTelegram"
  | "updatePolicy"
  | "sendReport";

type NumKey = "riskPct" | "dailyLossPct" | "maxDrawdownPct" | "profitTargetPct" | "maxOpenTrades" | "maxSpread";
const NUM_RULES: Array<{ key: NumKey; min: number; max: number; label: string }> = [
  { key: "riskPct", min: 0.1, max: 5, label: "Risk per trade %" },
  { key: "dailyLossPct", min: 0.5, max: 15, label: "Daily loss limit %" },
  { key: "maxDrawdownPct", min: 2, max: 35, label: "Max drawdown %" },
  { key: "profitTargetPct", min: 2, max: 50, label: "Profit target %" },
  { key: "maxOpenTrades", min: 1, max: 10, label: "Max open trades" },
  { key: "maxSpread", min: 0.05, max: 5, label: "Max gold spread $" },
];

export function runAction(
  name: ActionName,
  payload: Record<string, unknown>,
  s: AccountProfile,
  snap: Snapshot,
  store?: PlatformStore,
): string {
  const q = snap.quote;
  const d = snap.decision;
  const quotesMap = new Map<SymbolCode, Quote>(snap.watchlist.map((w) => [w.symbol, w]));
  if (q) quotesMap.set(q.symbol, q);

  switch (name) {
    case "approve":
    case "approveHalf": {
      if (!s.proposal) return "There is no pending trade proposal to approve. Click 'Simulate Setup' in the top bar to test one live.";
      if (s.settings.killSwitch) return "Kill Switch is ON. Release the Kill Switch before approving trades.";
      const prop = s.proposal;
      const liveQuote = quotesMap.get(prop.symbol) ?? q;
      if (!prop.simulated && (!d || !d.plan || d.verdict !== prop.plan.side)) {
        pushAudit(s, "proposal.stale", "Approval refused: live gates changed");
        s.proposal = null;
        return "Setup changed since proposal creation, so it was safely withdrawn.";
      }
      const basePlan = !prop.simulated && d?.plan ? d.plan : {
        ...prop.plan,
        entry: liveQuote ? (prop.plan.side === "BUY" ? liveQuote.ask : liveQuote.bid) : prop.plan.entry,
      };
      const factor = name === "approveHalf" ? 0.5 : 1;
      const finalLots = Math.max(0.01, Math.floor(basePlan.lots * factor * 100) / 100);
      const finalPlan = {
        ...basePlan,
        lots: finalLots,
        riskAmount: round2(basePlan.riskAmount * factor),
        marginRequired: marginRequiredUsd(basePlan.symbol, finalLots, basePlan.entry),
      };
      s.proposal = null;
      openTrade(
        s,
        finalPlan,
        prop.reason,
        prop.simulated ? "simulated" : "you",
        { strategyId: prop.strategyId, session: d?.sessionName ?? "Active session", store },
      );
      return `Approved${factor === 0.5 ? " (Half Risk)" : ""}: ${finalPlan.symbol} ${finalPlan.side} ${finalPlan.lots.toFixed(2)} lots opened at ${formatPrice(finalPlan.symbol, finalPlan.entry)}.`;
    }

    case "reject": {
      if (!s.proposal) return "No pending proposal to reject.";
      const sym = s.proposal.symbol;
      pushAudit(s, "proposal.rejected", `${sym} ${s.proposal.plan.side} rejected by user`);
      pushMessage(s, "INFO", `Rejected ${sym} ${s.proposal.plan.side} proposal. Capital untouched.`, sym);
      s.proposal = null;
      return "Proposal rejected. No trade opened.";
    }

    case "simulateSetup": {
      const targetSym = normalizeSymbol(payload.symbol ?? snap.symbol);
      const sq = quotesMap.get(targetSym) ?? q;
      if (!sq) return "Live price not ready yet; wait a second and try again.";
      const side: Side = payload.side === "SELL" ? "SELL" : payload.side === "BUY" ? "BUY" : (d?.trendDirection ?? "BUY");
      const prop = createSimulatedProposal(s, sq, side, d?.atr ?? 12);
      return `Live Demo Proposal created: ${prop.symbol} ${prop.plan.side} ${prop.plan.lots.toFixed(2)} lots @ ${formatPrice(prop.symbol, prop.plan.entry)}. Review & click Approve!`;
    }

    case "placeOrder": {
      if (s.settings.killSwitch) return "Kill Switch is ON — disable Kill Switch before placing orders.";
      const sym = normalizeSymbol(payload.symbol ?? snap.symbol);
      const lq = quotesMap.get(sym) ?? (q?.symbol === sym ? q : null);
      if (!lq) return `Live quote for ${sym} unavailable right now.`;

      const orderType = String(payload.orderType ?? "MARKET") as OrderType;
      const side: Side =
        orderType === "MARKET"
          ? payload.side === "SELL"
            ? "SELL"
            : "BUY"
          : orderType.startsWith("BUY")
            ? "BUY"
            : "SELL";

      const entryPrice =
        orderType === "MARKET"
          ? side === "BUY"
            ? lq.ask
            : lq.bid
          : Number(payload.triggerPrice ?? 0);

      const stopLoss = Number(payload.stopLoss ?? 0);
      const takeProfit = Number(payload.takeProfit ?? 0);
      if (!(entryPrice > 0) || !(stopLoss > 0) || !(takeProfit > 0)) {
        return "Entry, Stop Loss, and Take Profit must all be valid positive prices.";
      }
      if (side === "BUY" && !(stopLoss < entryPrice && takeProfit > entryPrice)) {
        return "For a BUY order, Stop Loss must be below Entry and Take Profit must be above Entry.";
      }
      if (side === "SELL" && !(stopLoss > entryPrice && takeProfit < entryPrice)) {
        return "For a SELL order, Stop Loss must be above Entry and Take Profit must be below Entry.";
      }

      const riskPct = Number(payload.riskPct ?? s.settings.riskPct);
      const manualLots = Number(payload.lots ?? 0);
      const sized = sizePosition(entryPrice, stopLoss, s.balance, riskPct, sym);
      const lots = manualLots > 0 ? Math.min(SYMBOL_SPECS[sym].maxLot, Math.max(0.01, round2(manualLots))) : sized.lots;
      const riskAmount =
        manualLots > 0
          ? round2(Math.abs(entryPrice - stopLoss) * lots * (SYMBOL_SPECS[sym].quoteCurrency === "JPY" ? 100000 / entryPrice : SYMBOL_SPECS[sym].contractSize))
          : sized.riskAmount;

      const partialTp = Boolean(payload.partialTp ?? s.strategy.partialTpEnabled);
      const riskDist = Math.abs(entryPrice - stopLoss);
      const tp1Price = partialTp
        ? roundPrice(sym, side === "BUY" ? entryPrice + riskDist * s.strategy.tp1R : entryPrice - riskDist * s.strategy.tp1R)
        : null;
      const trailing = payload.trailingDistance ? Number(payload.trailingDistance) : null;

      if (orderType === "MARKET") {
        const openCount = s.trades.filter((t) => t.status === "open").length;
        if (openCount >= s.settings.maxOpenTrades) {
          return `Max open positions reached (${openCount}/${s.settings.maxOpenTrades}). Close a trade or raise the limit in Governance.`;
        }
        openTrade(
          s,
          {
            symbol: sym,
            side,
            entry: entryPrice,
            stopLoss,
            tp1Price,
            takeProfit,
            riskDistance: riskDist,
            rewardRatio: round2(Math.abs(takeProfit - entryPrice) / riskDist),
            lots,
            riskAmount,
            marginRequired: marginRequiredUsd(sym, lots, entryPrice),
            trailingDistance: trailing && trailing > 0 ? trailing : null,
          },
          String(payload.reason ?? "Manual Order Ticket"),
          "manual",
          { session: d?.sessionName ?? "Manual", store },
        );
        return `Market ${side} executed: ${sym} ${lots.toFixed(2)} lots @ ${formatPrice(sym, entryPrice)}.`;
      } else {
        placePendingOrder(s, {
          symbol: sym,
          orderType,
          triggerPrice: entryPrice,
          stopLoss,
          tp1Price,
          takeProfit,
          lots,
          riskAmount,
          trailingDistance: trailing && trailing > 0 ? trailing : null,
          reason: String(payload.reason ?? "Manual Pending Order"),
          source: "manual",
        });
        return `Pending ${orderType.replace("_", " ")} placed on ${sym} @ ${formatPrice(sym, entryPrice)}.`;
      }
    }

    case "closeTrade": {
      const id = String(payload.tradeId ?? "");
      const t = id
        ? s.trades.find((x) => x.id === id && x.status === "open")
        : s.trades.find((x) => x.status === "open");
      if (!t) return "No matching open position found.";
      const lq = quotesMap.get(t.symbol) ?? q;
      if (!lq) return "Live price unavailable; try again in a moment.";
      const exit = t.side === "BUY" ? lq.bid : lq.ask;
      closeTrade(s, t, exit, "Manual close", store);
      return `Closed ${t.symbol} ${t.side} at ${formatPrice(t.symbol, exit)} (${t.pnl >= 0 ? "+" : "-"}$${Math.abs(t.pnl).toFixed(2)}).`;
    }

    case "partialClose": {
      const id = String(payload.tradeId ?? "");
      const t = id
        ? s.trades.find((x) => x.id === id && x.status === "open")
        : s.trades.find((x) => x.status === "open");
      if (!t) return "No open position available for partial close.";
      const lq = quotesMap.get(t.symbol) ?? q;
      if (!lq) return "Live price unavailable.";
      return partialCloseTrade(s, t.id, lq, 0.5);
    }

    case "breakEven": {
      const id = String(payload.tradeId ?? "");
      const t = id
        ? s.trades.find((x) => x.id === id && x.status === "open")
        : s.trades.find((x) => x.status === "open");
      if (!t) return "No open position found.";
      const lq = quotesMap.get(t.symbol) ?? q;
      if (!lq) return "Live price unavailable.";
      return moveTradeBreakEven(s, t.id, lq);
    }

    case "modifyTrade": {
      const id = String(payload.tradeId ?? "");
      const sl = Number(payload.stopLoss ?? 0);
      const tp = Number(payload.takeProfit ?? 0);
      const tr = payload.trailingDistance !== undefined && payload.trailingDistance !== "" ? Number(payload.trailingDistance) : null;
      return modifyTradeProtection(s, id, sl, tp, tr);
    }

    case "cancelPending": {
      const id = String(payload.orderId ?? "");
      const before = s.pendingOrders.length;
      s.pendingOrders = s.pendingOrders.filter((o) => o.id !== id);
      if (s.pendingOrders.length === before) return "Pending order not found.";
      pushAudit(s, "order.cancelled", `Cancelled pending order ${id}`);
      return "Pending order cancelled.";
    }

    case "addAlert": {
      const sym = normalizeSymbol(payload.symbol ?? snap.symbol);
      const targetPrice = Number(payload.targetPrice ?? 0);
      if (!(targetPrice > 0)) return "Enter a valid target price for the alert.";
      const lq = quotesMap.get(sym) ?? q;
      const cond: "ABOVE" | "BELOW" =
        payload.condition === "BELOW" || (payload.condition !== "ABOVE" && lq && targetPrice < lq.mid)
          ? "BELOW"
          : "ABOVE";
      s.priceAlerts.unshift({
        id: uid(),
        symbol: sym,
        condition: cond,
        targetPrice: roundPrice(sym, targetPrice),
        note: String(payload.note ?? `${sym} price alert`).slice(0, 120),
        active: true,
        triggeredAt: null,
        createdAt: nowIso(),
      });
      pushAudit(s, "alert.created", `${sym} ${cond} ${formatPrice(sym, targetPrice)}`);
      return `Alert set: notify when ${sym} crosses ${cond} ${formatPrice(sym, targetPrice)}.`;
    }

    case "deleteAlert": {
      const id = String(payload.alertId ?? "");
      s.priceAlerts = s.priceAlerts.filter((a) => a.id !== id);
      return "Alert removed.";
    }

    case "switchAccount": {
      if (!store) return "Store unavailable.";
      const targetId = String(payload.accountId ?? "");
      const found = store.accounts.find((a) => a.id === targetId);
      if (!found) return "Account not found.";
      store.activeAccountId = found.id;
      return `Switched active workspace to ${found.name} ($${found.balance.toLocaleString()}).`;
    }

    case "createAccount": {
      if (!store) return "Store unavailable.";
      const nameStr = String(payload.name ?? "Custom Account").trim().slice(0, 40) || "Custom Account";
      const bal = Math.min(2000000, Math.max(1000, Number(payload.startingBalance ?? 50000)));
      const prop = Boolean(payload.propFirm ?? true);
      const acc = buildCleanPaperAccount(`acc-${uid()}`, nameStr, bal, prop, "Custom");
      store.accounts.push(acc);
      store.activeAccountId = acc.id;
      return `Created and switched to ${acc.name} ($${bal.toLocaleString()}).`;
    }

    case "resetAccount": {
      if (!store) return "Store unavailable.";
      const idx = store.accounts.findIndex((a) => a.id === s.id);
      if (idx < 0) return "Account not found.";
      store.accounts[idx] =
        s.id === "showcase-100k"
          ? buildShowcaseAccount()
          : buildCleanPaperAccount(s.id, s.name, s.settings.startingBalance, s.settings.propFirm, s.badge);
      return `${s.name} has been reset to its initial state.`;
    }

    case "setStrategyPreset": {
      const id = String(payload.strategyId ?? "") as StrategyId;
      if (!STRATEGY_PRESETS[id]) return "Unknown strategy preset.";
      s.strategy = defaultStrategy(id);
      pushAudit(s, "strategy.preset", `Switched strategy to ${STRATEGY_PRESETS[id].name}`);
      return `Active strategy switched to ${STRATEGY_PRESETS[id].name}.`;
    }

    case "updateStrategyConfig": {
      const next: StrategyConfig = { ...s.strategy };
      const numFields: Array<[keyof StrategyConfig, number, number]> = [
        ["emaFast", 5, 100],
        ["emaSlow", 15, 250],
        ["emaMacro", 50, 400],
        ["rsiPeriod", 5, 30],
        ["rsiBuyMin", 20, 65],
        ["rsiBuyMax", 45, 85],
        ["rsiSellMin", 15, 55],
        ["rsiSellMax", 35, 80],
        ["atrMultiplierStop", 0.2, 3],
        ["rewardRatio", 1.1, 6],
        ["minRoomR", 0.5, 4],
        ["tp1R", 0.5, 3],
        ["trailingStopAtr", 0, 4],
        ["newsBlackoutBeforeMin", 0, 120],
        ["newsBlackoutAfterMin", 0, 180],
        ["cooldownAfterLosses", 1, 10],
      ];
      for (const [k, min, max] of numFields) {
        if (payload[k] !== undefined) {
          const v = Number(payload[k]);
          if (Number.isFinite(v)) (next[k] as number) = Math.min(max, Math.max(min, v));
        }
      }
      if (typeof payload.partialTpEnabled === "boolean") next.partialTpEnabled = payload.partialTpEnabled;
      if (payload.newsOfflinePolicy === "fail_closed" || payload.newsOfflinePolicy === "warn_only") {
        next.newsOfflinePolicy = payload.newsOfflinePolicy;
      }
      if (Array.isArray(payload.allowedSessions) && payload.allowedSessions.length > 0) {
        next.allowedSessions = payload.allowedSessions.filter((x): x is StrategyConfig["allowedSessions"][number] =>
          ["asian", "london", "ny_overlap", "ny"].includes(String(x)),
        );
      }
      s.strategy = next;
      pushAudit(s, "strategy.custom", `Updated parameters on ${STRATEGY_PRESETS[next.activeStrategy].name}`);
      return "Strategy parameters saved and active on live 8-gate evaluations.";
    }

    case "updateJournal": {
      const id = String(payload.tradeId ?? "");
      const t = s.trades.find((x) => x.id === id);
      if (!t) return "Trade not found.";
      if (typeof payload.notes === "string") t.notes = payload.notes.slice(0, 600);
      if (Array.isArray(payload.tags)) {
        t.tags = payload.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
      }
      pushAudit(s, "journal.saved", `Updated journal entry on ${t.symbol} trade`);
      return "Trade journal notes & tags saved.";
    }

    case "mode": {
      const mode = payload.mode;
      if (mode !== "signal" && mode !== "semi" && mode !== "auto") return "Unknown mode.";
      s.settings.mode = mode;
      if (mode === "signal") s.proposal = null;
      pushAudit(s, "settings.mode", `Mode set to ${mode}`);
      return `Operating mode set to ${MODE_LABEL[mode]}.`;
    }

    case "direction": {
      const dir = String(payload.direction);
      if (!["both", "buy", "sell", "paused"].includes(dir)) return "Unknown direction.";
      s.settings.direction = dir as DirectionLock;
      if (dir === "paused") s.proposal = null;
      pushAudit(s, "settings.direction", `Direction set to ${dir}`);
      return `Direction lock set to ${dir === "both" ? "BOTH directions" : dir === "paused" ? "PAUSED" : dir.toUpperCase() + " only"}.`;
    }

    case "pause": {
      s.settings.direction = "paused";
      s.proposal = null;
      pushAudit(s, "settings.pause", "Trading paused");
      return "Trading paused. No new automated or semi-auto setups will trigger until resumed.";
    }

    case "resumeTrading": {
      if (s.settings.direction === "paused") s.settings.direction = "both";
      pushAudit(s, "settings.resume", "Trading resumed");
      return "Trading resumed (both directions active).";
    }

    case "settings": {
      const errors: string[] = [];
      const updates: Array<{ rule: (typeof NUM_RULES)[number]; value: number }> = [];
      for (const rule of NUM_RULES) {
        if (payload[rule.key] === undefined) continue;
        const v = Number(payload[rule.key]);
        if (!Number.isFinite(v) || v < rule.min || v > rule.max) {
          errors.push(`${rule.label} must be between ${rule.min} and ${rule.max}`);
        } else {
          updates.push({ rule, value: v });
        }
      }
      if (errors.length) return errors.join(". ") + ". Nothing changed.";
      if (!updates.length) return "No valid setting values provided.";
      for (const u of updates) s.settings[u.rule.key] = u.value;
      const text = updates.map((u) => `${u.rule.label}: ${u.value}`).join(", ");
      pushAudit(s, "settings.update", text);
      return `Risk guard updated (${text}).`;
    }

    case "killSwitch": {
      s.settings.killSwitch = true;
      s.proposal = null;
      const pendingCount = s.pendingOrders.length;
      s.pendingOrders = [];
      const n = quotesMap.size ? closeAll(s, quotesMap, "Emergency Kill Switch", store) : 0;
      if (store) queueMt5Command(store, { type: "CLOSE_ALL", symbol: snap.symbol, comment: "KillSwitch" });
      pushMessage(
        s,
        "RISK_GUARD",
        `EMERGENCY KILL SWITCH ACTIVATED. New orders blocked, ${n} open position(s) flattened, ${pendingCount} pending order(s) cancelled.`,
      );
      pushAudit(s, "killswitch.on", `Flattened ${n} open, cancelled ${pendingCount} pending`);
      return `KILL SWITCH ON. ${n} open trade(s) flattened and ${pendingCount} pending order(s) cancelled. Manual release required to trade again.`;
    }

    case "resume": {
      if (!s.settings.killSwitch) return "Kill Switch is already off.";
      s.settings.killSwitch = false;
      pushAudit(s, "killswitch.off", "Kill Switch manually released");
      return "Kill Switch released. Risk guard limits remain active.";
    }

    case "closeAll": {
      if (!quotesMap.size) return "Live quotes unavailable; cannot mark exit prices safely.";
      const n = closeAll(s, quotesMap, "Flatten All by User", store);
      if (store) queueMt5Command(store, { type: "CLOSE_ALL", symbol: snap.symbol, comment: "FlattenAll" });
      return n ? `Flattened ${n} open position(s) at live market Bid/Ask.` : "No open positions to close.";
    }

    case "propFirm": {
      s.settings.propFirm = true;
      s.settings.riskPct = 0.5;
      s.settings.dailyLossPct = 5;
      s.settings.maxDrawdownPct = 10;
      s.settings.profitTargetPct = 10;
      s.settings.maxOpenTrades = 2;
      pushAudit(s, "settings.propfirm", "FTMO-style Prop-Firm preset applied");
      return "FTMO Prop-Firm rules applied: 0.5% risk/trade, 5% max daily loss, 10% max overall loss, 10% profit target.";
    }

    case "updateBridge": {
      if (!store) return "Store unavailable.";
      if (typeof payload.enabled === "boolean") store.mt5Bridge.enabled = payload.enabled;
      if (typeof payload.autoForwardApproved === "boolean") store.mt5Bridge.autoForwardApproved = payload.autoForwardApproved;
      if (payload.regenerateToken === true) store.mt5Bridge.token = "aurum_" + uid() + uid();
      pushAudit(s, "mt5.config", `MT5 bridge enabled=${store.mt5Bridge.enabled}`);
      return "MT5 Broker Bridge settings updated.";
    }

    case "updateTelegram": {
      if (!store) return "Store unavailable.";
      if (typeof payload.botToken === "string" && payload.botToken.trim()) {
        store.telegram.botToken = payload.botToken.trim();
      }
      if (typeof payload.chatId === "string") store.telegram.chatId = payload.chatId.trim();
      if (typeof payload.enabled === "boolean") store.telegram.enabled = payload.enabled;
      if (typeof payload.forwardSignals === "boolean") store.telegram.forwardSignals = payload.forwardSignals;
      if (typeof payload.forwardTrades === "boolean") store.telegram.forwardTrades = payload.forwardTrades;
      pushAudit(s, "telegram.config", `Telegram alerts enabled=${store.telegram.enabled}`);
      return "Telegram alert configuration saved.";
    }

    case "testTelegram": {
      return "Use /api/telegram/test for live delivery verification.";
    }

    case "updatePolicy": {
      const before = s.policy;
      s.policy = normalizePolicy({ ...before, ...(payload as object) });
      if (s.policy.allowedSymbols.length === 0) {
        s.policy = { ...s.policy, allowedSymbols: before.allowedSymbols };
        return "At least one instrument must stay approved. Nothing changed.";
      }
      pushAudit(
        s,
        "policy.update",
        `Mandate: ${s.policy.allowedSymbols.join("/")} · max ${s.policy.maxLotsPerTrade}L · ${s.policy.maxTradesPerDay}/day · heat ${s.policy.maxOpenRiskPct}% · window ${s.policy.tradingWindowEnabled ? `${s.policy.windowStartUtc}-${s.policy.windowEndUtc} UTC` : "24h"}`,
      );
      return "Client mandate saved. Automation will respect these limits on the next signal.";
    }

    case "sendReport": {
      if (!store) return "Store unavailable.";
      const text = String(payload.text ?? "").slice(0, 3800);
      if (!text) return "Report is empty.";
      if (!store.telegram.enabled || !store.telegram.botToken || !store.telegram.chatId) {
        return "Telegram is not configured yet. Add the bot token and chat ID in MT5/Risk → Telegram, then resend.";
      }
      void forwardTelegramIfEnabled(store, text);
      pushAudit(s, "report.sent", "Performance report forwarded to Telegram");
      return "Report sent to the client's Telegram chat.";
    }
  }
}

export async function backtestFor(
  opts: Partial<BacktestOptions> & { timeframe?: Timeframe; symbol?: SymbolCode },
): Promise<BacktestResult> {
  const store = loadPlatformStore();
  const s = getActiveAccount(store);
  const symbol = normalizeSymbol(opts.symbol ?? "XAUUSD");
  const tf: Timeframe = normalizeTf(opts.timeframe ?? "1d");
  const limit = tf === "1d" ? 500 : 220;
  const bars = closed(await cachedBars(symbol, tf, limit));
  return runBacktest(bars, {
    symbol,
    timeframe: tf,
    strategyId: opts.strategyId ?? s.strategy.activeStrategy,
    riskPct: opts.riskPct ?? s.settings.riskPct,
    startingBalance: opts.startingBalance ?? s.settings.startingBalance,
    rr: opts.rr ?? s.strategy.rewardRatio,
    partialTp: opts.partialTp ?? s.strategy.partialTpEnabled,
    spread: opts.spread ?? SYMBOL_SPECS[symbol].defaultMaxSpread * 0.65,
    slippage: opts.slippage ?? SYMBOL_SPECS[symbol].pipSize * 0.5,
    maxHold: opts.maxHold ?? 24,
    propDrawdownLimitPct: s.settings.maxDrawdownPct,
  });
}

export type { Settings };
