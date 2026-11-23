import {
  atrValue,
  bollingerSeries,
  clusterLevels,
  detectCandlePattern,
  emaSeries,
  pivots,
  rsiSeries,
  sessionFor,
} from "./indicators";
import { defaultStrategy, STRATEGY_PRESETS } from "./seed";
import { formatPrice, marginRequiredUsd, SYMBOL_SPECS, usdPerPriceUnit } from "./symbols";
import type {
  Bar,
  Decision,
  GateResult,
  NewsEvent,
  Quote,
  Settings,
  Side,
  StrategyConfig,
  SymbolCode,
  TradePlan,
} from "./types";

export interface EngineInput {
  symbol?: SymbolCode;
  d1: Bar[];
  h4: Bar[];
  h1: Bar[];
  m15: Bar[];
  quote: Quote;
  news: NewsEvent[];
  newsOk: boolean;
  settings: Settings;
  strategy?: StrategyConfig;
  balance: number;
  openTrades: number;
  currentLossStreak?: number;
  dailyPnlPct: number;
  drawdownPct: number;
  now: Date;
}

export function sizePosition(
  entry: number,
  stop: number,
  balance: number,
  riskPct: number,
  symbol: SymbolCode = "XAUUSD",
): { lots: number; riskAmount: number } {
  const spec = SYMBOL_SPECS[symbol];
  const risk = Math.abs(entry - stop);
  const riskAmount = Math.round(balance * riskPct) / 100;
  const unitVal = usdPerPriceUnit(symbol, entry);
  const raw = risk > 0 ? riskAmount / (risk * unitVal) : 0;
  const clamped = Math.min(spec.maxLot, Math.max(spec.minLot, Math.floor(raw * 100) / 100));
  return { lots: clamped, riskAmount };
}

function trendOf(
  bars: Bar[],
  fastPeriod: number,
  slowPeriod: number,
): { dir: Side | null; emaFast: number; emaSlow: number; close: number } {
  if (!bars.length) return { dir: null, emaFast: 0, emaSlow: 0, close: 0 };
  const closes = bars.map((b) => b.close);
  const eF = emaSeries(closes, fastPeriod);
  const eS = emaSeries(closes, slowPeriod);
  const last = closes.length - 1;
  const close = closes[last];
  const a = eF[last];
  const b = eS[last];
  let dir: Side | null = null;
  if (close > a && a > b) dir = "BUY";
  else if (close < a && a < b) dir = "SELL";
  return { dir, emaFast: a, emaSlow: b, close };
}

// 8-Gate configurable signal & risk engine. Deterministic and inspectable.
export function evaluate(inp: EngineInput): Decision {
  const symbol: SymbolCode = inp.symbol ?? inp.quote.symbol ?? "XAUUSD";
  const spec = SYMBOL_SPECS[symbol];
  const q = inp.quote;
  const st = inp.settings;
  const strat = inp.strategy ?? defaultStrategy("trend_pullback");
  const presetMeta = STRATEGY_PRESETS[strat.activeStrategy] ?? STRATEGY_PRESETS.trend_pullback;
  const gates: GateResult[] = [];
  const bullCase: string[] = [];
  const bearCase: string[] = [];

  // Gate 1: Higher-Timeframe Bias (Daily + 4H)
  const dT = trendOf(inp.d1, strat.emaFast, strat.emaSlow);
  const hT = trendOf(inp.h4, strat.emaFast, strat.emaSlow);
  const h1Closes = inp.h1.map((b) => b.close);
  const ema20Arr = emaSeries(h1Closes, 20);
  const ema50Arr = emaSeries(h1Closes, 50);
  const ema200Arr = emaSeries(h1Closes, strat.emaMacro || 200);
  const bb = bollingerSeries(h1Closes, 20, 2);

  let side: Side | null = dT.dir !== null && dT.dir === hT.dir ? dT.dir : null;
  // In Key-Level PA mode, if Daily is neutral/mixed, allow 4H strong trend to lead
  if (!side && strat.activeStrategy === "key_level_pa" && hT.dir !== null) {
    side = hT.dir;
  }

  if (dT.dir === "BUY") bullCase.push(`Daily close (${formatPrice(symbol, dT.close)}) holds above EMA${strat.emaFast}/EMA${strat.emaSlow}`);
  if (dT.dir === "SELL") bearCase.push(`Daily close (${formatPrice(symbol, dT.close)}) trades below EMA${strat.emaFast}/EMA${strat.emaSlow}`);
  if (hT.dir === "BUY") bullCase.push("4H market structure is bullish");
  if (hT.dir === "SELL") bearCase.push("4H market structure is bearish");

  gates.push({
    id: 1,
    name: "HTF Trend Bias (Daily + 4H)",
    pass: side !== null,
    weight: 18,
    detail: side
      ? `Aligned ${side === "BUY" ? "BULLISH" : "BEARISH"} (Daily ${dT.dir ?? "neutral"}, 4H ${hT.dir ?? "neutral"})`
      : `Daily is ${dT.dir ?? "mixed"} while 4H is ${hT.dir ?? "mixed"} — waiting for alignment`,
  });

  // Gate 2: Entry Momentum & Candlestick Confirmation (15m)
  const rsis = rsiSeries(
    inp.m15.map((b) => b.close),
    strat.rsiPeriod,
  );
  const rNow = rsis[rsis.length - 1] ?? 50;
  const rPrev = rsis[rsis.length - 2] ?? rNow;
  const pattern = detectCandlePattern(inp.m15);
  let momPass = false;
  if (side === "BUY") {
    const rsiOk = rNow >= strat.rsiBuyMin && rNow <= strat.rsiBuyMax && rNow >= rPrev - 0.8;
    const patOk = strat.activeStrategy === "key_level_pa" ? pattern.bias !== "SELL" : true;
    momPass = rsiOk && patOk;
  } else if (side === "SELL") {
    const rsiOk = rNow >= strat.rsiSellMin && rNow <= strat.rsiSellMax && rNow <= rPrev + 0.8;
    const patOk = strat.activeStrategy === "key_level_pa" ? pattern.bias !== "BUY" : true;
    momPass = rsiOk && patOk;
  }
  if (pattern.name) {
    if (pattern.bias === "BUY") bullCase.push(`15m printed ${pattern.name}`);
    else if (pattern.bias === "SELL") bearCase.push(`15m printed ${pattern.name}`);
  }
  gates.push({
    id: 2,
    name: "Momentum & Candle Trigger (15m)",
    pass: momPass,
    weight: 15,
    detail: `15m RSI(${strat.rsiPeriod}) = ${rNow.toFixed(1)} (${rNow >= rPrev ? "rising" : "falling"})${
      pattern.name ? ` · Pattern: ${pattern.name}` : ""
    }`,
  });

  // Gate 3: Key-Level Structure, PDH/PDL & Minimum R:R Room (1H)
  const atr = atrValue(inp.h1, 14);
  const prevDay = inp.d1.length >= 2 ? inp.d1[inp.d1.length - 1] : null;
  const pdh = prevDay ? prevDay.high : null;
  const pdl = prevDay ? prevDay.low : null;
  const piv = pivots(inp.h1.slice(-120), 2, 2);
  const supportLevels = clusterLevels(
    piv.lows.filter((l) => l < q.mid),
    Math.max(spec.pipSize * 5, atr * 0.35),
    3,
  );
  const resistanceLevels = clusterLevels(
    piv.highs.filter((h) => h > q.mid),
    Math.max(spec.pipSize * 5, atr * 0.35),
    3,
  );
  const overhead = piv.highs.filter((h) => h > q.mid).sort((a, b) => a - b)[0];
  const underneath = piv.lows.filter((l) => l < q.mid).sort((a, b) => b - a)[0];

  const recent = inp.h1.slice(-10);
  let plan: TradePlan | null = null;
  let structPass = false;
  let structDetail = "Awaiting trend bias before computing structure stop and R:R room";

  if (side && recent.length > 0 && atr > 0) {
    const entry = side === "BUY" ? q.ask : q.bid;
    const lowest = Math.min(...recent.map((b) => b.low));
    const highest = Math.max(...recent.map((b) => b.high));
    const stop = side === "BUY" ? lowest - strat.atrMultiplierStop * atr : highest + strat.atrMultiplierStop * atr;
    const risk = side === "BUY" ? entry - stop : stop - entry;
    const rr = strat.rewardRatio;
    const tp1 = strat.partialTpEnabled
      ? side === "BUY"
        ? entry + strat.tp1R * risk
        : entry - strat.tp1R * risk
      : null;
    const target = side === "BUY" ? entry + rr * risk : entry - rr * risk;
    const opposingLevel = side === "BUY" ? overhead : underneath;
    const room = opposingLevel === undefined ? Infinity : Math.abs(opposingLevel - entry);
    const sane = risk >= 0.4 * atr && risk <= 4.2 * atr;
    const roomOk = room >= strat.minRoomR * risk;
    structPass = sane && roomOk;

    const levelText =
      opposingLevel === undefined
        ? "Clear air to target"
        : `Nearest ${side === "BUY" ? "resistance" : "support"} ${formatPrice(symbol, opposingLevel)} (${formatPrice(symbol, room)} room vs ${formatPrice(symbol, strat.minRoomR * risk)} needed)`;
    structDetail = `SL ${formatPrice(symbol, stop)}, risk ${formatPrice(symbol, risk)} (1H ATR ${formatPrice(symbol, atr)}). ${levelText}`;

    const sized = sizePosition(entry, stop, inp.balance, st.riskPct, symbol);
    plan = {
      symbol,
      side,
      entry,
      stopLoss: stop,
      tp1Price: tp1,
      takeProfit: target,
      riskDistance: risk,
      rewardRatio: rr,
      lots: sized.lots,
      riskAmount: sized.riskAmount,
      marginRequired: marginRequiredUsd(symbol, sized.lots, entry),
      trailingDistance: strat.trailingStopAtr > 0 ? Number((atr * strat.trailingStopAtr).toFixed(spec.decimals)) : null,
    };
  }
  gates.push({
    id: 3,
    name: "Key-Level Structure & R:R Room",
    pass: structPass,
    weight: 16,
    detail: structDetail,
  });

  // Gate 4: Volatility Regime (1H ATR vs recent range — blocks dead chop and freak spike bars)
  const lastH1 = inp.h1[inp.h1.length - 1];
  const lastRange = lastH1 ? lastH1.high - lastH1.low : 0;
  const volHealthy = atr > 0 && lastRange <= atr * 2.8;
  gates.push({
    id: 4,
    name: "Volatility Regime (ATR Filter)",
    pass: volHealthy,
    weight: 10,
    detail: volHealthy
      ? `1H ATR ${formatPrice(symbol, atr)} normal (last bar range ${formatPrice(symbol, lastRange)})`
      : `Abnormal volatility spike or missing ATR (bar range ${formatPrice(symbol, lastRange)} vs ATR ${formatPrice(symbol, atr)})`,
  });

  // Gate 5: Session & Killzone Liquidity
  const hour = inp.now.getUTCHours();
  const sess = sessionFor(hour);
  const sessAllowed =
    sess.id !== "rollover" && strat.allowedSessions.includes(sess.id as "asian" | "london" | "ny_overlap" | "ny");
  gates.push({
    id: 5,
    name: "Session & Killzone Liquidity",
    pass: sessAllowed,
    weight: 11,
    detail: `${sess.name} (${String(hour).padStart(2, "0")}:00 UTC) · Allowed: ${strat.allowedSessions.join(", ")}`,
  });

  // Gate 6: Broker Spread Collar
  const effectiveMaxSpread = symbol === "XAUUSD" ? st.maxSpread : spec.defaultMaxSpread;
  const spreadOk = q.spread <= effectiveMaxSpread;
  gates.push({
    id: 6,
    name: "Broker Spread Collar",
    pass: spreadOk,
    weight: 10,
    detail: `Live spread ${formatPrice(symbol, q.spread)} vs collar ${formatPrice(symbol, effectiveMaxSpread)}`,
  });

  // Gate 7: High-Impact Macro News Filter
  const nowMs = inp.now.getTime();
  const relevantCurrencies = new Set(["USD", symbol.slice(0, 3), symbol.slice(3, 6)]);
  const highEvents = inp.news
    .filter((n) => relevantCurrencies.has(n.currency) && n.impact === "High")
    .map((n) => ({ ...n, t: Date.parse(n.time) }))
    .filter((n) => !Number.isNaN(n.t))
    .sort((a, b) => a.t - b.t);
  const beforeMs = strat.newsBlackoutBeforeMin * 60000;
  const afterMs = strat.newsBlackoutAfterMin * 60000;
  const blocking = highEvents.find((n) => n.t >= nowMs - afterMs && n.t <= nowMs + beforeMs);
  const next = highEvents.find((n) => n.t > nowMs);

  let newsPass = !blocking;
  let newsDetail = "";
  if (!inp.newsOk && strat.newsOfflinePolicy === "fail_closed") {
    newsPass = false;
    newsDetail = "Live calendar feed rate-limited & policy is Strict Fail-Closed (switch to Warn-Only in Strategy Studio to use curated schedule)";
  } else if (blocking) {
    newsPass = false;
    newsDetail = `Blackout active around ${blocking.currency} ${blocking.title} (${strat.newsBlackoutBeforeMin}m before / ${strat.newsBlackoutAfterMin}m after)`;
  } else if (next) {
    const minsAway = Math.round((next.t - nowMs) / 60000);
    const hrs = Math.floor(minsAway / 60);
    newsDetail = `Clear. Next High-Impact: ${next.currency} ${next.title} in ${hrs > 0 ? `${hrs}h ${minsAway % 60}m` : `${minsAway}m`}${!inp.newsOk ? " (curated schedule)" : ""}`;
  } else {
    newsDetail = "Clear. No remaining High-Impact releases in window";
  }
  gates.push({
    id: 7,
    name: "High-Impact Macro News Filter",
    pass: newsPass,
    weight: 10,
    detail: newsDetail,
  });

  // Gate 8: Personal & Prop-Firm Risk Guard
  const issues: string[] = [];
  if (st.killSwitch) issues.push("Kill Switch is ON");
  if (st.direction === "paused") issues.push("Trading is PAUSED");
  if (side === "BUY" && st.direction === "sell") issues.push("Direction locked to SELL only");
  if (side === "SELL" && st.direction === "buy") issues.push("Direction locked to BUY only");
  if (inp.openTrades >= st.maxOpenTrades) issues.push(`Max open positions (${inp.openTrades}/${st.maxOpenTrades})`);
  if (inp.dailyPnlPct <= -st.dailyLossPct) issues.push(`Daily loss cap hit (${inp.dailyPnlPct.toFixed(2)}%)`);
  if (inp.drawdownPct >= st.maxDrawdownPct) issues.push(`Max drawdown cap hit (${inp.drawdownPct.toFixed(2)}%)`);
  if ((inp.currentLossStreak ?? 0) >= strat.cooldownAfterLosses) {
    issues.push(`Loss-streak cooldown (${inp.currentLossStreak} losses in a row)`);
  }
  gates.push({
    id: 8,
    name: "Personal & Prop-Firm Risk Guard",
    pass: issues.length === 0,
    weight: 10,
    detail: issues.length ? issues.join("; ") : `All guardrails clear (${st.riskPct}% risk, ${inp.openTrades}/${st.maxOpenTrades} open)`,
  });

  const earnedWeight = gates.filter((g) => g.pass).reduce((a, g) => a + g.weight, 0);
  const totalWeight = gates.reduce((a, g) => a + g.weight, 0) || 100;
  const score = Math.round((earnedWeight / totalWeight) * 100);
  const allPass = gates.every((g) => g.pass);
  const verdict: Decision["verdict"] = side !== null && allPass && plan ? side : "DO NOT TRADE";

  if (!bullCase.length && rNow > 50) bullCase.push(`15m RSI above midline (${rNow.toFixed(1)})`);
  if (!bearCase.length && rNow <= 50) bearCase.push(`15m RSI below midline (${rNow.toFixed(1)})`);
  if (overhead) bearCase.push(`Overhead resistance near ${formatPrice(symbol, overhead)}`);
  if (underneath) bullCase.push(`Underlying support near ${formatPrice(symbol, underneath)}`);

  return {
    symbol,
    strategyId: strat.activeStrategy,
    strategyName: presetMeta.name,
    verdict,
    score,
    gates,
    plan: verdict === "DO NOT TRADE" ? null : plan,
    bullCase,
    bearCase,
    reasons: gates.filter((g) => !g.pass).map((g) => `${g.name}: ${g.detail}`),
    generatedAt: inp.now.toISOString(),
    trendDirection: side,
    nearestSupport: underneath ?? null,
    nearestResistance: overhead ?? null,
    atr,
    rsi: rNow,
    sessionId: sess.id,
    sessionName: sess.name,
    indicators: {
      pdh,
      pdl,
      supportLevels,
      resistanceLevels,
      ema20: ema20Arr[ema20Arr.length - 1] ?? null,
      ema50: ema50Arr[ema50Arr.length - 1] ?? null,
      ema200: ema200Arr[ema200Arr.length - 1] ?? null,
      bbUpper: bb.upper[bb.upper.length - 1] ?? null,
      bbLower: bb.lower[bb.lower.length - 1] ?? null,
      candlePattern: pattern.name,
    },
  };
}
