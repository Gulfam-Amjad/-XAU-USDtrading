import { SYMBOL_SPECS, SYMBOLS } from "./symbols";
import type { AccountProfile, SymbolCode, TradePlan, TradingPolicy } from "./types";

/** Pure (client + server safe) helpers for the client-controlled trading mandate. */

export const DEFAULT_POLICY: TradingPolicy = {
  allowedSymbols: [...SYMBOLS],
  maxLotsPerTrade: 5,
  maxTradesPerDay: 6,
  maxOpenRiskPct: 3,
  tradingWindowEnabled: false,
  windowStartUtc: 7,
  windowEndUtc: 20,
  autoApprovalMaxRiskUsd: 0,
};

export function normalizePolicy(raw: Partial<TradingPolicy> | undefined | null): TradingPolicy {
  const p = { ...DEFAULT_POLICY, ...(raw ?? {}) };
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const symbols = Array.isArray(p.allowedSymbols)
    ? p.allowedSymbols.filter((x): x is SymbolCode => (SYMBOLS as string[]).includes(String(x)))
    : [...SYMBOLS];
  return {
    allowedSymbols: symbols,
    maxLotsPerTrade: clamp(p.maxLotsPerTrade, 0.01, 100, DEFAULT_POLICY.maxLotsPerTrade),
    maxTradesPerDay: Math.round(clamp(p.maxTradesPerDay, 1, 50, DEFAULT_POLICY.maxTradesPerDay)),
    maxOpenRiskPct: clamp(p.maxOpenRiskPct, 0.1, 25, DEFAULT_POLICY.maxOpenRiskPct),
    tradingWindowEnabled: Boolean(p.tradingWindowEnabled),
    windowStartUtc: Math.round(clamp(p.windowStartUtc, 0, 23, DEFAULT_POLICY.windowStartUtc)),
    windowEndUtc: Math.round(clamp(p.windowEndUtc, 0, 23, DEFAULT_POLICY.windowEndUtc)),
    autoApprovalMaxRiskUsd: clamp(p.autoApprovalMaxRiskUsd, 0, 1_000_000, 0),
  };
}

export function inTradingWindow(policy: TradingPolicy, now: Date): boolean {
  if (!policy.tradingWindowEnabled) return true;
  const h = now.getUTCHours();
  const { windowStartUtc: a, windowEndUtc: b } = policy;
  if (a === b) return true;
  return a < b ? h >= a && h < b : h >= a || h < b;
}

export function tradesOpenedToday(s: Pick<AccountProfile, "trades">, now: Date): number {
  const day = now.toISOString().slice(0, 10);
  return s.trades.filter((t) => t.openedAt.slice(0, 10) === day && t.approvedBy !== "simulated").length;
}

export function openRiskUsd(s: Pick<AccountProfile, "trades">): number {
  return s.trades.filter((t) => t.status === "open" && !t.breakEvenMoved).reduce((a, t) => a + t.riskAmount, 0);
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string | null;
  /** Plan with lots clamped to the mandate (only set when allowed). */
  plan: TradePlan | null;
  clamped: boolean;
}

/** Evaluate an automated plan against the client's mandate. Deterministic; AI cannot override. */
export function evaluatePolicy(
  s: Pick<AccountProfile, "trades" | "balance" | "policy">,
  plan: TradePlan,
  now: Date,
): PolicyVerdict {
  const p = normalizePolicy(s.policy);
  if (!p.allowedSymbols.includes(plan.symbol)) {
    return { allowed: false, reason: `${plan.symbol} is not in the client's approved instrument list`, plan: null, clamped: false };
  }
  if (!inTradingWindow(p, now)) {
    return {
      allowed: false,
      reason: `Outside the client's approved trading window (${String(p.windowStartUtc).padStart(2, "0")}:00–${String(p.windowEndUtc).padStart(2, "0")}:00 UTC)`,
      plan: null,
      clamped: false,
    };
  }
  const today = tradesOpenedToday(s, now);
  if (today >= p.maxTradesPerDay) {
    return { allowed: false, reason: `Daily trade cap reached (${today}/${p.maxTradesPerDay})`, plan: null, clamped: false };
  }

  const spec = SYMBOL_SPECS[plan.symbol];
  let lots = plan.lots;
  let risk = plan.riskAmount;
  let clamped = false;
  if (lots > p.maxLotsPerTrade) {
    const f = p.maxLotsPerTrade / lots;
    lots = Math.max(spec.minLot, Math.floor(p.maxLotsPerTrade * 100) / 100);
    risk = Math.round(plan.riskAmount * f * 100) / 100;
    clamped = true;
  }

  const heatCapUsd = (s.balance * p.maxOpenRiskPct) / 100;
  const heat = openRiskUsd(s) + risk;
  if (heat > heatCapUsd + 0.01) {
    return {
      allowed: false,
      reason: `Total open risk would be $${heat.toFixed(0)} which exceeds the ${p.maxOpenRiskPct}% portfolio cap ($${heatCapUsd.toFixed(0)})`,
      plan: null,
      clamped: false,
    };
  }

  return { allowed: true, reason: null, plan: { ...plan, lots, riskAmount: risk }, clamped };
}
