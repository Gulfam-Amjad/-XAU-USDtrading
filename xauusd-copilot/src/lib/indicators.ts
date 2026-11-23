import type { Bar, SessionId, Side } from "./types";

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const p = Math.max(2, Math.round(period));
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = values[0];
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function bollingerSeries(
  closes: number[],
  period = 20,
  mult = 2,
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = closes.slice(start, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + mult * std);
    lower.push(mean - mult * std);
  }
  return { middle, upper, lower };
}

// Wilder RSI
export function rsiSeries(closes: number[], period = 14): number[] {
  const p = Math.max(2, Math.round(period));
  const out: number[] = new Array(closes.length).fill(50);
  if (closes.length <= p) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= p;
  loss /= p;
  out[p] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (p - 1) + Math.max(d, 0)) / p;
    loss = (loss * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atrValue(bars: Bar[], period = 14): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export interface Pivots {
  highs: number[];
  lows: number[];
}

export function pivots(bars: Bar[], left = 2, right = 2): Pivots {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) highs.push(bars[i].high);
    if (isLow) lows.push(bars[i].low);
  }
  return { highs, lows };
}

export function clusterLevels(levels: number[], tolerance: number, maxCount = 3): number[] {
  if (!levels.length) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const lv of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(lv - last[last.length - 1]) <= tolerance) {
      last.push(lv);
    } else {
      clusters.push([lv]);
    }
  }
  return clusters
    .sort((a, b) => b.length - a.length)
    .slice(0, maxCount)
    .map((c) => c.reduce((x, y) => x + y, 0) / c.length);
}

export function detectCandlePattern(bars: Bar[]): { name: string | null; bias: Side | null } {
  if (bars.length < 2) return { name: null, bias: null };
  const cur = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const range = Math.max(1e-9, cur.high - cur.low);
  const body = Math.abs(cur.close - cur.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;

  // Bullish Engulfing
  if (cur.close > cur.open && prev.close < prev.open && cur.close >= prev.open && cur.open <= prev.close && body > prevBody * 0.9) {
    return { name: "Bullish Engulfing", bias: "BUY" };
  }
  // Bearish Engulfing
  if (cur.close < cur.open && prev.close > prev.open && cur.open >= prev.close && cur.close <= prev.open && body > prevBody * 0.9) {
    return { name: "Bearish Engulfing", bias: "SELL" };
  }
  // Bullish Pin Bar / Hammer
  if (lowerWick >= range * 0.58 && upperWick <= range * 0.22) {
    return { name: "Bullish Pin Bar (Rejection Wick)", bias: "BUY" };
  }
  // Bearish Shooting Star / Pin Bar
  if (upperWick >= range * 0.58 && lowerWick <= range * 0.22) {
    return { name: "Bearish Pin Bar (Shooting Star)", bias: "SELL" };
  }
  // Inside Bar
  if (cur.high <= prev.high && cur.low >= prev.low) {
    return { name: "Inside Bar Compression", bias: null };
  }
  return { name: null, bias: null };
}

export function sessionFor(hourUtc: number): { id: SessionId; name: string; liquid: boolean } {
  if (hourUtc >= 12 && hourUtc < 16) return { id: "ny_overlap", name: "London / New York overlap", liquid: true };
  if (hourUtc >= 7 && hourUtc < 12) return { id: "london", name: "London session", liquid: true };
  if (hourUtc >= 16 && hourUtc < 21) return { id: "ny", name: "New York session", liquid: true };
  if (hourUtc >= 21 && hourUtc < 23) return { id: "rollover", name: "Rollover (wide spreads)", liquid: false };
  return { id: "asian", name: "Asian session", liquid: false };
}

export interface WorldSessionInfo {
  name: string;
  city: string;
  windowUtc: string;
  active: boolean;
  note: string;
}

export function worldSessionsSnapshot(now = new Date()): WorldSessionInfo[] {
  const h = now.getUTCHours();
  return [
    {
      name: "Sydney / Pacific",
      city: "Sydney",
      windowUtc: "22:00 - 06:00 UTC",
      active: h >= 22 || h < 6,
      note: "Early week open & quiet range building",
    },
    {
      name: "Asian / Tokyo",
      city: "Tokyo",
      windowUtc: "00:00 - 08:00 UTC",
      active: h >= 0 && h < 8,
      note: "Sets Asian High/Low liquidity range for London sweep",
    },
    {
      name: "London Session",
      city: "London",
      windowUtc: "07:00 - 16:00 UTC",
      active: h >= 7 && h < 16,
      note: "Primary European gold & FX institutional volume",
    },
    {
      name: "London / NY Killzone",
      city: "LDN + NY",
      windowUtc: "12:00 - 16:00 UTC",
      active: h >= 12 && h < 16,
      note: "Peak XAU/USD liquidity + US macro release window",
    },
    {
      name: "New York Session",
      city: "New York",
      windowUtc: "13:00 - 21:00 UTC",
      active: h >= 13 && h < 21,
      note: "COMEX futures flow, US yields, and afternoon continuation",
    },
    {
      name: "Daily Rollover",
      city: "Settlement",
      windowUtc: "21:00 - 23:00 UTC",
      active: h >= 21 && h < 23,
      note: "Spreads widen sharply; Risk Guard blocks new entries",
    },
  ];
}
