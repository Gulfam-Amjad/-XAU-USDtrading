import { atrValue, detectCandlePattern, emaSeries, rsiSeries } from "./indicators";
import { STRATEGY_PRESETS } from "./seed";
import { SYMBOL_SPECS } from "./symbols";
import type { Bar, Side, StrategyId, SymbolCode, Timeframe } from "./types";

export interface BacktestOptions {
  symbol: SymbolCode;
  timeframe: Timeframe;
  strategyId: StrategyId;
  riskPct: number;
  startingBalance: number;
  rr: number;
  partialTp: boolean;
  spread: number;
  slippage: number;
  maxHold: number;
  propDrawdownLimitPct?: number;
}

export interface BacktestTrade {
  side: Side;
  openTime: number;
  closeTime: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  dollars: number;
  reason: string;
}

export interface MonteCarloSummary {
  runs: number;
  p5EndingBalance: number;
  p50EndingBalance: number;
  p95EndingBalance: number;
  medianMaxDrawdownPct: number;
  p95WorstDrawdownPct: number;
  probBreachPropLimitPct: number;
  worstLossStreak: number;
  bands: Array<{ step: number; p5: number; p50: number; p95: number }>;
}

export interface BacktestResult {
  symbol: SymbolCode;
  strategyId: StrategyId;
  strategyName: string;
  timeframe: Timeframe;
  bars: number;
  fromTime: number;
  toTime: number;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  sharpeRatio: number;
  netR: number;
  netDollars: number;
  netReturnPct: number;
  avgR: number;
  maxDrawdownPct: number;
  endingBalance: number;
  equity: { time: number; equity: number; drawdownPct: number }[];
  monteCarlo: MonteCarloSummary;
  assumptions: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx];
}

// Deterministic PRNG so backtests are reproducible on identical inputs
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function computeMonteCarlo(
  trades: BacktestTrade[],
  startingBalance: number,
  riskPct: number,
  propLimitPct: number,
  runs = 500,
): MonteCarloSummary {
  const m = trades.length;
  if (m === 0) {
    return {
      runs,
      p5EndingBalance: startingBalance,
      p50EndingBalance: startingBalance,
      p95EndingBalance: startingBalance,
      medianMaxDrawdownPct: 0,
      p95WorstDrawdownPct: 0,
      probBreachPropLimitPct: 0,
      worstLossStreak: 0,
      bands: [{ step: 0, p5: startingBalance, p50: startingBalance, p95: startingBalance }],
    };
  }

  const rand = mulberry32(4202026 + m);
  const riskUsd = (startingBalance * riskPct) / 100;
  const stepValues: number[][] = Array.from({ length: m + 1 }, () => []);
  const endingList: number[] = [];
  const maxDdList: number[] = [];
  let breaches = 0;
  let worstStreakOverall = 0;

  for (let run = 0; run < runs; run++) {
    let eq = startingBalance;
    let peak = startingBalance;
    let maxDd = 0;
    let curLossStreak = 0;
    stepValues[0].push(eq);

    // Bootstrap resample with replacement to test sequence variance & clustering
    for (let s = 1; s <= m; s++) {
      const picked = trades[Math.floor(rand() * m)];
      const pnl = picked.r * riskUsd;
      eq += pnl;
      peak = Math.max(peak, eq);
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
      if (picked.r < 0) {
        curLossStreak++;
        if (curLossStreak > worstStreakOverall) worstStreakOverall = curLossStreak;
      } else {
        curLossStreak = 0;
      }
      stepValues[s].push(eq);
    }

    endingList.push(eq);
    maxDdList.push(maxDd);
    if (maxDd >= propLimitPct) breaches++;
  }

  endingList.sort((a, b) => a - b);
  maxDdList.sort((a, b) => a - b);

  const bands = stepValues.map((arr, step) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      step,
      p5: r2(percentile(sorted, 5)),
      p50: r2(percentile(sorted, 50)),
      p95: r2(percentile(sorted, 95)),
    };
  });

  return {
    runs,
    p5EndingBalance: r2(percentile(endingList, 5)),
    p50EndingBalance: r2(percentile(endingList, 50)),
    p95EndingBalance: r2(percentile(endingList, 95)),
    medianMaxDrawdownPct: r2(percentile(maxDdList, 50)),
    p95WorstDrawdownPct: r2(percentile(maxDdList, 95)),
    probBreachPropLimitPct: r2((breaches / runs) * 100),
    worstLossStreak: worstStreakOverall,
    bands,
  };
}

export function runBacktest(bars: Bar[], opts: BacktestOptions): BacktestResult {
  const symbol = opts.symbol ?? "XAUUSD";
  const spec = SYMBOL_SPECS[symbol];
  const preset = STRATEGY_PRESETS[opts.strategyId] ?? STRATEGY_PRESETS.trend_pullback;
  const cfg = preset.config;
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const eFast = emaSeries(closes, cfg.emaFast);
  const eSlow = emaSeries(closes, cfg.emaSlow);
  const rsis = rsiSeries(closes, cfg.rsiPeriod);
  const riskAmount = (opts.startingBalance * opts.riskPct) / 100;
  const totalCost = (opts.spread || 0) + (opts.slippage || 0);

  const trades: BacktestTrade[] = [];
  let equity = opts.startingBalance;
  let peak = opts.startingBalance;
  const curve: { time: number; equity: number; drawdownPct: number }[] = [
    { time: bars[0]?.time ?? 0, equity, drawdownPct: 0 },
  ];

  const roundSym = (v: number) => Number(v.toFixed(spec.decimals));

  let i = Math.max(40, cfg.emaSlow + 5);
  while (i < n - 2) {
    const b = bars[i];
    const a = atrValue(bars.slice(Math.max(0, i - 14), i + 1), 14);
    if (a <= 0) {
      i++;
      continue;
    }

    const up = b.close > eFast[i] && eFast[i] > eSlow[i];
    const dn = b.close < eFast[i] && eFast[i] < eSlow[i];
    const pat = detectCandlePattern(bars.slice(Math.max(0, i - 3), i + 1));

    let side: Side | null = null;
    if (opts.strategyId === "key_level_pa") {
      if (up && (pat.bias === "BUY" || (b.low <= eFast[i] + 0.35 * a && b.close > b.open))) side = "BUY";
      else if (dn && (pat.bias === "SELL" || (b.high >= eFast[i] - 0.35 * a && b.close < b.open))) side = "SELL";
    } else if (opts.strategyId === "killzone_breakout") {
      const prevHigh = Math.max(...bars.slice(i - 6, i).map((x) => x.high));
      const prevLow = Math.min(...bars.slice(i - 6, i).map((x) => x.low));
      if (up && b.close > prevHigh && rsis[i] <= 74) side = "BUY";
      else if (dn && b.close < prevLow && rsis[i] >= 26) side = "SELL";
    } else {
      // trend_pullback & prop_shield
      const tightBand = opts.strategyId === "prop_shield" ? 0.2 : 0.3;
      if (up && b.low <= eFast[i] + tightBand * a && b.close > eFast[i] && rsis[i] >= cfg.rsiBuyMin && rsis[i] <= cfg.rsiBuyMax) {
        side = "BUY";
      } else if (dn && b.high >= eFast[i] - tightBand * a && b.close < eFast[i] && rsis[i] >= cfg.rsiSellMin && rsis[i] <= cfg.rsiSellMax) {
        side = "SELL";
      }
    }

    if (!side) {
      i++;
      continue;
    }

    const next = bars[i + 1];
    const entry = side === "BUY" ? next.open + totalCost : next.open - totalCost;
    const swing = bars.slice(Math.max(0, i - 9), i + 1);
    const stop =
      side === "BUY"
        ? Math.min(...swing.map((x) => x.low)) - cfg.atrMultiplierStop * a
        : Math.max(...swing.map((x) => x.high)) + cfg.atrMultiplierStop * a;
    const risk = side === "BUY" ? entry - stop : stop - entry;
    if (risk < 0.4 * a || risk > 4.2 * a) {
      i++;
      continue;
    }

    const tp1 = side === "BUY" ? entry + risk : entry - risk;
    const target = side === "BUY" ? entry + opts.rr * risk : entry - opts.rr * risk;

    const last = Math.min(i + opts.maxHold, n - 1);
    let currentStop = stop;
    let tp1Banked = false;
    let exit: number | null = null;
    let exitIdx = last;
    let reason = "";

    for (let j = i + 1; j <= last; j++) {
      const x = bars[j];
      if (side === "BUY") {
        // Conservative: check stop before target on same candle
        if (x.low <= currentStop) {
          exit = currentStop;
          reason = tp1Banked ? "TP1 (50%) + Break-Even" : "Stop loss";
          exitIdx = j;
          break;
        }
        if (opts.partialTp && !tp1Banked && x.high >= tp1) {
          tp1Banked = true;
          currentStop = entry; // lock break-even after 1R
        }
        if (x.high >= target) {
          exit = target;
          reason = opts.partialTp ? "TP1 (50%) + TP2 (50%)" : "Take profit";
          exitIdx = j;
          break;
        }
      } else {
        if (x.high >= currentStop) {
          exit = currentStop;
          reason = tp1Banked ? "TP1 (50%) + Break-Even" : "Stop loss";
          exitIdx = j;
          break;
        }
        if (opts.partialTp && !tp1Banked && x.low <= tp1) {
          tp1Banked = true;
          currentStop = entry;
        }
        if (x.low <= target) {
          exit = target;
          reason = opts.partialTp ? "TP1 (50%) + TP2 (50%)" : "Take profit";
          exitIdx = j;
          break;
        }
      }
    }

    const finalExit = exit ?? bars[last].close;
    if (exit === null) reason = tp1Banked ? "TP1 + Time exit" : "Time exit";

    const runnerR = (side === "BUY" ? finalExit - entry : entry - finalExit) / risk;
    const effectiveR = opts.partialTp && tp1Banked ? 0.5 * 1.0 + 0.5 * runnerR : runnerR;
    const dollars = effectiveR * riskAmount;
    equity += dollars;
    peak = Math.max(peak, equity);
    const ddPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

    trades.push({
      side,
      openTime: next.time,
      closeTime: bars[exitIdx].time,
      entry: roundSym(entry),
      stop: roundSym(stop),
      target: roundSym(target),
      exit: roundSym(finalExit),
      r: r2(effectiveR),
      dollars: r2(dollars),
      reason,
    });
    curve.push({ time: bars[exitIdx].time, equity: r2(equity), drawdownPct: r2(ddPct) });
    i = exitIdx + 1;
  }

  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const grossW = wins.reduce((a, t) => a + t.r, 0);
  const grossL = Math.abs(losses.reduce((a, t) => a + t.r, 0));
  const maxDd = curve.reduce((m, p) => Math.max(m, p.drawdownPct), 0);
  const netR = r2(trades.reduce((a, t) => a + t.r, 0));
  const netDollars = r2(trades.reduce((a, t) => a + t.dollars, 0));
  const avgR = trades.length ? r2(netR / trades.length) : 0;

  let sharpeRatio = 0;
  if (trades.length >= 3) {
    const rs = trades.map((t) => t.r);
    const mean = rs.reduce((a, x) => a + x, 0) / rs.length;
    const variance = rs.reduce((a, x) => a + (x - mean) ** 2, 0) / (rs.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) sharpeRatio = r2((mean / std) * Math.sqrt(Math.min(252, rs.length * 4)));
  }

  const propLimit = opts.propDrawdownLimitPct ?? 10;
  const monteCarlo = computeMonteCarlo(trades, opts.startingBalance, opts.riskPct, propLimit, 500);

  return {
    symbol,
    strategyId: opts.strategyId,
    strategyName: preset.name,
    timeframe: opts.timeframe,
    bars: n,
    fromTime: bars[0]?.time ?? 0,
    toTime: bars[n - 1]?.time ?? 0,
    trades,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? r2((wins.length / trades.length) * 100) : 0,
    profitFactor: grossL > 0 ? r2(grossW / grossL) : grossW > 0 ? 99 : 0,
    expectancyR: avgR,
    sharpeRatio,
    netR,
    netDollars,
    netReturnPct: opts.startingBalance > 0 ? r2((netDollars / opts.startingBalance) * 100) : 0,
    avgR,
    maxDrawdownPct: r2(maxDd),
    endingBalance: r2(equity),
    equity: curve,
    monteCarlo,
    assumptions: [
      `Costs modeled on every trade: ${opts.spread} spread + ${opts.slippage} slippage (${roundSym(totalCost)} total entry penalty).`,
      "Conservative bar replay: if Stop Loss and Take Profit are both touched inside the same bar, Stop Loss is assumed hit first.",
      opts.partialTp
        ? `Split Take-Profit ON: closes 50% at +1.0R and moves Stop Loss to Break-Even; remaining 50% targets +${opts.rr}R.`
        : `Single target exit at +${opts.rr}R (partial take-profit disabled).`,
      `Monte Carlo stress test ran 500 randomized trade-order resamples against your ${propLimit}% max drawdown guardrail.`,
    ],
  };
}
