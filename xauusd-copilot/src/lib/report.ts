import { formatPrice, pnlForLots, SYMBOL_SPECS } from "./symbols";
import type { Snapshot, Trade } from "./types";

export type ReportPeriod = "daily" | "weekly" | "monthly";

export interface ReportTradeRow {
  id: string;
  symbol: string;
  side: string;
  lots: number;
  entry: string;
  exit: string;
  pnl: number;
  r: number;
  reason: string;
  closedAt: string;
}

export interface ClientReport {
  period: ReportPeriod;
  title: string;
  rangeLabel: string;
  generatedAt: string;
  accountName: string;
  startBalance: number;
  endBalance: number;
  equity: number;
  netPnl: number;
  netPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  best: number;
  worst: number;
  avgR: number;
  blocked: number;
  savedRiskUsd: number;
  openPositions: number;
  openRiskUsd: number;
  rows: ReportTradeRow[];
  highlights: string[];
  warnings: string[];
  nextSteps: string[];
}

const DAY = 86_400_000;

export function periodStart(period: ReportPeriod, now: Date): Date {
  const d = new Date(now);
  if (period === "daily") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getTime() - (period === "weekly" ? 7 : 30) * DAY);
}

export const fmtPf = (n: number) => (n >= 99 ? "∞" : n.toFixed(2));

const fmtMoney = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildReport(snap: Snapshot, period: ReportPeriod, now = new Date()): ClientReport {
  const s = snap.state;
  const from = periodStart(period, now);
  const fromMs = from.getTime();

  const closed = s.trades.filter(
    (t): t is Trade => t.status === "closed" && t.closedAt !== null && Date.parse(t.closedAt) >= fromMs,
  );
  const open = s.trades.filter((t) => t.status === "open");

  const netPnl = closed.reduce((a, t) => a + t.pnl, 0);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const best = closed.length ? Math.max(...closed.map((t) => t.pnl)) : 0;
  const worst = closed.length ? Math.min(...closed.map((t) => t.pnl)) : 0;
  const avgR = closed.length ? closed.reduce((a, t) => a + t.rMultiple, 0) / closed.length : 0;

  const startBalance = s.balance - netPnl;
  const blocked = s.blockedSignals.filter((b) => Date.parse(b.at) >= fromMs);
  const savedRiskUsd = blocked.reduce((a, b) => a + b.savedRiskUsd, 0);
  const openRiskUsd = open.reduce((a, t) => a + (t.breakEvenMoved ? 0 : t.riskAmount), 0);

  const rows: ReportTradeRow[] = closed
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
    .slice(0, 40)
    .map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      lots: t.initialLots,
      entry: formatPrice(t.symbol, t.entry),
      exit: formatPrice(t.symbol, t.exitPrice),
      pnl: t.pnl,
      r: t.rMultiple,
      reason: t.closeReason,
      closedAt: t.closedAt ?? "",
    }));

  const highlights: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (closed.length === 0) {
    highlights.push("No positions were closed in this period — the system stayed patient and protected capital.");
  } else {
    highlights.push(
      `${closed.length} trade${closed.length === 1 ? "" : "s"} closed: ${wins.length} winner${wins.length === 1 ? "" : "s"}, ${losses.length} loser${losses.length === 1 ? "" : "s"} (${winRate.toFixed(0)}% win rate), net ${fmtMoney(netPnl)}.`,
    );
    if (profitFactor >= 1.5) highlights.push(`Profit factor ${fmtPf(profitFactor)} — winners are comfortably out-earning losers.`);
    if (best > 0) highlights.push(`Best trade ${fmtMoney(best)}; average result ${avgR.toFixed(2)}R per trade.`);
  }
  if (blocked.length > 0) {
    highlights.push(
      `Safety filters declined ${blocked.length} lower-quality setup${blocked.length === 1 ? "" : "s"}, avoiding roughly $${savedRiskUsd.toFixed(0)} of risk.`,
    );
  }

  if (snap.dailyPnlPct <= -(s.settings.dailyLossPct * 0.6)) {
    warnings.push(`Today's loss is ${Math.abs(snap.dailyPnlPct).toFixed(2)}% — close to the ${s.settings.dailyLossPct}% daily limit.`);
  }
  if (snap.drawdownPct >= s.settings.maxDrawdownPct * 0.6) {
    warnings.push(`Drawdown is ${snap.drawdownPct.toFixed(2)}% of the ${s.settings.maxDrawdownPct}% maximum.`);
  }
  if (snap.stats.currentLossStreak >= 2) {
    warnings.push(`Current losing streak: ${snap.stats.currentLossStreak}. Cool-down rules are active.`);
  }
  if (s.settings.killSwitch) warnings.push("Emergency kill switch is ON — no new trades will open.");
  if (open.length > 0) warnings.push(`${open.length} open position${open.length === 1 ? "" : "s"} carrying $${openRiskUsd.toFixed(2)} at risk.`);
  if (warnings.length === 0) warnings.push("No risk warnings. All guardrails are within comfortable range.");

  if (netPnl < 0) nextSteps.push("Review the losing trades in the Journal and consider reducing risk-per-trade until conditions improve.");
  if (open.length > 0) nextSteps.push("Monitor open positions; stops are already in place at the broker bridge.");
  nextSteps.push("Check the economic calendar for high-impact events before the next session.");
  if (s.settings.mode === "semi") nextSteps.push("Keep an eye on the proposal banner — approvals expire after 5 minutes.");

  const label = period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : "Monthly";
  return {
    period,
    title: `${label} Performance Report`,
    rangeLabel:
      period === "daily"
        ? now.toISOString().slice(0, 10)
        : `${from.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
    generatedAt: now.toISOString(),
    accountName: s.name,
    startBalance,
    endBalance: s.balance,
    equity: snap.equity,
    netPnl,
    netPct: startBalance > 0 ? (netPnl / startBalance) * 100 : 0,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor,
    best,
    worst,
    avgR,
    blocked: blocked.length,
    savedRiskUsd,
    openPositions: open.length,
    openRiskUsd,
    rows,
    highlights,
    warnings,
    nextSteps,
  };
}

export function reportToText(r: ClientReport): string {
  const lines = [
    `${r.title} · ${r.rangeLabel}`,
    `Account: ${r.accountName}`,
    `Net P&L: ${fmtMoney(r.netPnl)} (${r.netPct >= 0 ? "+" : ""}${r.netPct.toFixed(2)}%)`,
    `Balance: $${r.endBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} · Equity: $${r.equity.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    `Trades: ${r.trades} (${r.wins}W/${r.losses}L, ${r.winRate.toFixed(0)}% win) · PF ${fmtPf(r.profitFactor)}`,
    `Blocked setups: ${r.blocked} (~$${r.savedRiskUsd.toFixed(0)} risk avoided)`,
    `Open: ${r.openPositions} position(s), $${r.openRiskUsd.toFixed(2)} at risk`,
    "",
    "Highlights:",
    ...r.highlights.map((h) => `• ${h}`),
    "",
    "Watch-outs:",
    ...r.warnings.map((w) => `• ${w}`),
  ];
  return lines.join("\n");
}

export function reportToMarkdown(r: ClientReport): string {
  const table = r.rows.length
    ? [
        "| Closed | Symbol | Side | Lots | Entry | Exit | P&L | R | Reason |",
        "|---|---|---|---:|---:|---:|---:|---:|---|",
        ...r.rows.map(
          (x) =>
            `| ${x.closedAt.slice(0, 16).replace("T", " ")} | ${x.symbol} | ${x.side} | ${x.lots.toFixed(2)} | ${x.entry} | ${x.exit} | ${fmtMoney(x.pnl)} | ${x.r.toFixed(2)} | ${x.reason} |`,
        ),
      ].join("\n")
    : "_No closed trades in this period._";
  return [
    `# ${r.title}`,
    `**${r.accountName}** · ${r.rangeLabel} · generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    "## Summary",
    `- Net P&L: **${fmtMoney(r.netPnl)}** (${r.netPct.toFixed(2)}%)`,
    `- Balance: $${r.endBalance.toFixed(2)} · Equity: $${r.equity.toFixed(2)}`,
    `- Trades: ${r.trades} (${r.wins}W / ${r.losses}L) · Win rate ${r.winRate.toFixed(1)}% · Profit factor ${fmtPf(r.profitFactor)}`,
    `- Best ${fmtMoney(r.best)} · Worst ${fmtMoney(r.worst)} · Avg ${r.avgR.toFixed(2)}R`,
    `- Setups declined by safety filters: ${r.blocked} (~$${r.savedRiskUsd.toFixed(0)} risk avoided)`,
    "",
    "## Highlights",
    ...r.highlights.map((h) => `- ${h}`),
    "",
    "## Risk watch-outs",
    ...r.warnings.map((w) => `- ${w}`),
    "",
    "## Recommended next steps",
    ...r.nextSteps.map((n) => `- ${n}`),
    "",
    "## Trades",
    table,
    "",
    "_Trading involves risk. Past performance does not guarantee future results._",
  ].join("\n");
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Standalone, print-ready HTML (open → Print → Save as PDF, or email as attachment). */
export function reportToHtml(r: ClientReport): string {
  const cls = (n: number) => (n >= 0 ? "#15803d" : "#b91c1c");
  const kpi = (k: string, v: string, color = "#111") =>
    `<div class="kpi"><div class="k">${esc(k)}</div><div class="v" style="color:${color}">${esc(v)}</div></div>`;
  const rows = r.rows
    .map(
      (x) =>
        `<tr><td>${esc(x.closedAt.slice(0, 16).replace("T", " "))}</td><td>${esc(x.symbol)}</td><td>${esc(x.side)}</td><td class="n">${x.lots.toFixed(2)}</td><td class="n">${esc(x.entry)}</td><td class="n">${esc(x.exit)}</td><td class="n" style="color:${cls(x.pnl)}">${esc(fmtMoney(x.pnl))}</td><td class="n">${x.r.toFixed(2)}</td><td>${esc(x.reason)}</td></tr>`,
    )
    .join("");
  const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)} — ${esc(r.rangeLabel)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 18px}
h1{margin:0;font-size:24px}.sub{color:#555;font-size:13px;margin:4px 0 18px}
.brand{color:#a67c00;font-weight:800;letter-spacing:1px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.kpi{border:1px solid #ddd;border-radius:8px;padding:10px}.k{font-size:11px;color:#666;text-transform:uppercase}.v{font-size:18px;font-weight:800;margin-top:3px}
h2{font-size:15px;border-bottom:2px solid #a67c00;padding-bottom:4px;margin-top:22px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e5e5e5;padding:5px 6px;text-align:left}.n{text-align:right}
li{margin:3px 0;font-size:13px}.foot{margin-top:26px;font-size:11px;color:#777}
@media print{body{margin:0}}
</style></head><body>
<div class="brand">AURUMDESK PRO</div>
<h1>${esc(r.title)}</h1>
<div class="sub">${esc(r.accountName)} · ${esc(r.rangeLabel)} · generated ${esc(r.generatedAt.slice(0, 16).replace("T", " "))} UTC</div>
<div class="grid">
${kpi("Net P&L", fmtMoney(r.netPnl), cls(r.netPnl))}
${kpi("Return", `${r.netPct >= 0 ? "+" : ""}${r.netPct.toFixed(2)}%`, cls(r.netPct))}
${kpi("Balance", `$${r.endBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)}
${kpi("Live equity", `$${r.equity.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)}
${kpi("Trades", `${r.trades} (${r.wins}W/${r.losses}L)`)}
${kpi("Win rate", `${r.winRate.toFixed(1)}%`)}
${kpi("Profit factor", fmtPf(r.profitFactor))}
${kpi("Risk avoided", `$${r.savedRiskUsd.toFixed(0)} (${r.blocked})`)}
</div>
<h2>Highlights</h2>${ul(r.highlights)}
<h2>Risk watch-outs</h2>${ul(r.warnings)}
<h2>Recommended next steps</h2>${ul(r.nextSteps)}
<h2>Closed trades</h2>
${r.rows.length ? `<table><thead><tr><th>Closed (UTC)</th><th>Symbol</th><th>Side</th><th class="n">Lots</th><th class="n">Entry</th><th class="n">Exit</th><th class="n">P&amp;L</th><th class="n">R</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No closed trades in this period.</p>"}
<div class="foot">Trading leveraged instruments involves substantial risk of loss. Past performance is not indicative of future results. This report is informational and not financial advice.</div>
</body></html>`;
}

// ---------- Risk radar ----------

export interface RiskRadar {
  heatUsd: number;
  heatPct: number;
  worstCaseUsd: number; // P&L if every open position hits its current stop-loss
  bestCaseUsd: number; // P&L if every open position hits take-profit
  floatingUsd: number;
  byExposure: Array<{ symbol: string; label: string; side: string; lots: number; riskUsd: number; sharePct: number }>;
  usdLongBias: number; // net USD directional exposure heuristic (-1..1)
  marginLevelPct: number;
}

export function buildRiskRadar(snap: Snapshot): RiskRadar {
  const s = snap.state;
  const open = s.trades.filter((t) => t.status === "open");
  let worst = 0;
  let best = 0;
  const rows = open.map((t) => {
    const atSl = pnlForLots(t.symbol, t.side, t.entry, t.stopLoss, t.lots) + t.realizedPartialPnl;
    const atTp = pnlForLots(t.symbol, t.side, t.entry, t.takeProfit, t.lots) + t.realizedPartialPnl;
    worst += atSl;
    best += atTp;
    return {
      symbol: t.symbol,
      label: SYMBOL_SPECS[t.symbol].shortName,
      side: t.side,
      lots: t.lots,
      riskUsd: t.breakEvenMoved ? 0 : t.riskAmount,
    };
  });
  const heatUsd = rows.reduce((a, r) => a + r.riskUsd, 0);

  // Heuristic USD bias: BUY XAU/EUR/GBP/BTC ≈ short USD, BUY USDJPY ≈ long USD.
  let usd = 0;
  let notional = 0;
  for (const t of open) {
    const dir = t.side === "BUY" ? 1 : -1;
    const w = t.lots;
    notional += w;
    usd += (t.symbol === "USDJPY" ? dir : -dir) * w;
  }

  return {
    heatUsd,
    heatPct: s.balance > 0 ? (heatUsd / s.balance) * 100 : 0,
    worstCaseUsd: worst,
    bestCaseUsd: best,
    floatingUsd: snap.stats.openFloating,
    byExposure: rows.map((r) => ({ ...r, sharePct: heatUsd > 0 ? (r.riskUsd / heatUsd) * 100 : 0 })),
    usdLongBias: notional > 0 ? usd / notional : 0,
    marginLevelPct: snap.stats.marginLevelPct,
  };
}

// ---------- Account health ----------

export interface HealthReport {
  score: number;
  label: "Healthy" | "Caution" | "At Risk" | "Halted";
  color: string;
  factors: Array<{ name: string; penalty: number; note: string }>;
  plain: string;
}

export function buildHealth(snap: Snapshot): HealthReport {
  const s = snap.state;
  const radar = buildRiskRadar(snap);
  const factors: HealthReport["factors"] = [];
  const add = (name: string, penalty: number, note: string) => {
    if (penalty > 0) factors.push({ name, penalty: Math.round(penalty), note });
  };

  const dailyUsed = Math.max(0, -snap.dailyPnlPct) / Math.max(0.5, s.settings.dailyLossPct);
  add("Daily loss limit", dailyUsed * 35, `${(dailyUsed * 100).toFixed(0)}% of today's loss allowance used`);
  const ddUsed = snap.drawdownPct / Math.max(1, s.settings.maxDrawdownPct);
  add("Drawdown", ddUsed * 30, `${snap.drawdownPct.toFixed(2)}% drawdown vs ${s.settings.maxDrawdownPct}% limit`);
  add("Losing streak", Math.min(20, snap.stats.currentLossStreak * 6), `${snap.stats.currentLossStreak} consecutive losses`);
  const heatCap = Math.max(0.1, s.policy.maxOpenRiskPct);
  add("Open risk (portfolio heat)", Math.min(20, (radar.heatPct / heatCap) * 12), `${radar.heatPct.toFixed(2)}% of balance at risk (cap ${heatCap}%)`);
  if (snap.error) add("Data feed", 10, "Market data degraded — trading held safe");
  if (snap.stats.marginLevelPct > 0 && snap.stats.marginLevelPct < 300) add("Margin", 10, `Margin level ${snap.stats.marginLevelPct.toFixed(0)}%`);

  const penalty = factors.reduce((a, f) => a + f.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const halted = s.settings.killSwitch;
  const label: HealthReport["label"] = halted ? "Halted" : score >= 80 ? "Healthy" : score >= 55 ? "Caution" : "At Risk";
  const color = halted ? "#94a3b8" : label === "Healthy" ? "var(--green)" : label === "Caution" ? "var(--amber)" : "var(--red)";

  const plain = halted
    ? "Trading is halted by the emergency kill switch. Nothing new will open until you release it."
    : label === "Healthy"
      ? "Everything looks normal. Risk is well inside your limits and the system is operating as designed."
      : label === "Caution"
        ? "Still within limits, but one or more safety margins are shrinking. The system will keep protecting the account."
        : "Risk is elevated. Consider pausing, reducing risk per trade, or letting the daily limit lock new entries.";
  return { score, label, color, factors, plain };
}
