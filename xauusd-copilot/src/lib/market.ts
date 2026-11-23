import fs from "node:fs";
import path from "node:path";
import { buildCuratedWeeklySchedule, goldImpactNoteFor } from "./calendarFallback";
import { SYMBOLS, SYMBOL_SPECS } from "./symbols";
import type { Bar, NewsEvent, Quote, SymbolCode, Timeframe } from "./types";

const BIQUOTE = "https://biquote.io/api";
const SWAPICH = "https://swapich.com/api/v1/market";
const GOLD_API = "https://api.gold-api.com/price";
const CALENDAR = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface BiquoteQuote {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  high: number;
  low: number;
  dayDiffPercent: number;
  timestamp: string;
  source: string;
  marketState?: string;
}

interface SwapichQuote {
  bid: number;
  ask: number;
  price: number;
  spread: number;
  ts: number;
  source: string;
}

interface BiquoteBar {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  isOpen?: boolean;
}

interface SwapichCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface GoldApiPrice {
  price: number;
  updatedAt: string;
}

interface FfEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  actual?: string;
}

const quoteCache = new Map<SymbolCode, { at: number; quote: Quote }>();
const QUOTE_TTL_MS = 4500;
const QUOTE_STALE_MS = 60000;

export async function getQuote(symbol: SymbolCode = "XAUUSD"): Promise<Quote> {
  const now = Date.now();
  const cached = quoteCache.get(symbol);
  if (cached && now - cached.at < QUOTE_TTL_MS) return cached.quote;

  try {
    const d = await getJson<BiquoteQuote>(`${BIQUOTE}/${symbol}`);
    if (!(d.bid > 0) || !(d.ask > 0)) throw new Error("invalid quote");
    const q: Quote = {
      symbol,
      bid: d.bid,
      ask: d.ask,
      mid: d.mid,
      spread: d.spread,
      high: d.high,
      low: d.low,
      dayChangePct: d.dayDiffPercent,
      timestamp: d.timestamp,
      source: d.source,
      marketState: d.marketState ?? "open",
      fallback: false,
    };
    quoteCache.set(symbol, { at: now, quote: q });
    return q;
  } catch {
    // Secondary fallback: Swapich
    try {
      const sw = await getJson<SwapichQuote>(`${SWAPICH}/quote?symbol=${symbol}`);
      const p = Number(sw.price || sw.bid);
      if (p > 0) {
        const halfSpread = SYMBOL_SPECS[symbol].pipSize;
        const bid = sw.bid > 0 && sw.ask > sw.bid ? sw.bid : p - halfSpread;
        const ask = sw.ask > sw.bid ? sw.ask : p + halfSpread;
        const q: Quote = {
          symbol,
          bid,
          ask,
          mid: (bid + ask) / 2,
          spread: ask - bid,
          high: ask,
          low: bid,
          dayChangePct: 0,
          timestamp: new Date(sw.ts || now).toISOString(),
          source: "swapich (fallback)",
          marketState: "open",
          fallback: true,
        };
        quoteCache.set(symbol, { at: now, quote: q });
        return q;
      }
    } catch {
      /* continue to tertiary fallback */
    }

    // Tertiary fallback for XAU / XAG / BTC via gold-api
    const goldApiSym = symbol === "XAUUSD" ? "XAU" : symbol === "XAGUSD" ? "XAG" : symbol === "BTCUSD" ? "BTC" : null;
    if (goldApiSym) {
      try {
        const g = await getJson<GoldApiPrice>(`${GOLD_API}/${goldApiSym}`);
        const p = Number(g.price);
        if (p > 0) {
          const half = SYMBOL_SPECS[symbol].pipSize;
          const q: Quote = {
            symbol,
            bid: p - half,
            ask: p + half,
            mid: p,
            spread: half * 2,
            high: p,
            low: p,
            dayChangePct: 0,
            timestamp: g.updatedAt,
            source: "gold-api.com (fallback)",
            marketState: "fallback",
            fallback: true,
          };
          quoteCache.set(symbol, { at: now, quote: q });
          return q;
        }
      } catch {
        /* fall through */
      }
    }

    if (cached && now - cached.at < QUOTE_STALE_MS) return cached.quote;
    throw new Error(`No live quote available for ${symbol}`);
  }
}

export async function getWatchlistQuotes(): Promise<Quote[]> {
  const settled = await Promise.allSettled(SYMBOLS.map((s) => getQuote(s)));
  const out: Quote[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}

export async function getBars(symbolOrInterval: string, intervalOrLimit?: string | number, maybeLimit?: number): Promise<Bar[]> {
  // Supports both getBars("XAUUSD", "1h", 168) and legacy getBars("1h", 168)
  let symbol: SymbolCode = "XAUUSD";
  let interval: Timeframe = "1h";
  let limit = 168;

  if (typeof intervalOrLimit === "number") {
    interval = (symbolOrInterval as Timeframe) || "1h";
    limit = intervalOrLimit;
  } else {
    symbol = (SYMBOLS as string[]).includes(symbolOrInterval) ? (symbolOrInterval as SymbolCode) : "XAUUSD";
    interval = (intervalOrLimit as Timeframe) || "1h";
    limit = maybeLimit ?? 168;
  }

  try {
    const d = await getJson<{ bars: BiquoteBar[] }>(`${BIQUOTE}/${symbol}/ohlc?interval=${interval}&limit=${limit}`);
    return d.bars
      .map((b) => ({
        time: Math.floor(Date.parse(b.openTime) / 1000),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.tickVolume ?? 0,
        isOpen: Boolean(b.isOpen),
      }))
      .sort((a, b) => a.time - b.time);
  } catch (err) {
    // Fallback to Swapich for supported intervals (1m, 5m, 15m, 1h, 1d)
    const tfMap: Partial<Record<Timeframe, string>> = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "1h": "1h",
      "1d": "1d",
    };
    const swTf = tfMap[interval];
    if (!swTf) throw err;
    const sw = await getJson<{ candles: SwapichCandle[] }>(`${SWAPICH}/candles?symbol=${symbol}&tf=${swTf}`);
    return sw.candles
      .slice(-limit)
      .map((c, idx, arr) => ({
        time: Math.floor(c.t / 1000),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v ?? 0,
        isOpen: idx === arr.length - 1,
      }))
      .sort((a, b) => a.time - b.time);
  }
}

const CAL_TTL_MS = 20 * 60000;
const CAL_STALE_MS = 12 * 60 * 60000;
const CAL_BACKOFF_MS = 15 * 60000;
const CAL_FILE = path.join(process.cwd(), "data", "calendar-cache-v2.json");

interface CalCache {
  at: number;
  events: NewsEvent[];
  nextTry?: number;
}

function readCal(): CalCache | null {
  try {
    return JSON.parse(fs.readFileSync(CAL_FILE, "utf8")) as CalCache;
  } catch {
    return null;
  }
}

function writeCal(c: CalCache): void {
  try {
    fs.mkdirSync(path.dirname(CAL_FILE), { recursive: true });
    fs.writeFileSync(CAL_FILE, JSON.stringify(c), "utf8");
  } catch {
    /* best effort */
  }
}

export async function getEconomicNews(): Promise<{
  events: NewsEvent[];
  liveOk: boolean;
  source: "live" | "cached" | "curated";
}> {
  const now = Date.now();
  const cached = readCal();

  if (cached && cached.events.length > 0 && now - cached.at < CAL_TTL_MS) {
    return { events: cached.events, liveOk: true, source: "live" };
  }

  if (cached?.nextTry && now < cached.nextTry) {
    if (cached.events.length > 0 && now - cached.at < CAL_STALE_MS) {
      return {
        events: cached.events.map((e) => ({ ...e, source: "cached" })),
        liveOk: true,
        source: "cached",
      };
    }
    return { events: buildCuratedWeeklySchedule(), liveOk: false, source: "curated" };
  }

  try {
    const all = await getJson<FfEvent[]>(CALENDAR);
    const keepCurrencies = new Set(["USD", "EUR", "GBP", "JPY"]);
    const events: NewsEvent[] = all
      .filter((e) => keepCurrencies.has(e.country))
      .map((e, idx) => ({
        id: `ff-${idx}-${e.country}`,
        title: e.title,
        currency: e.country,
        impact: e.impact,
        time: new Date(Date.parse(e.date)).toISOString(),
        forecast: e.forecast ?? "",
        previous: e.previous ?? "",
        actual: e.actual ?? "",
        goldNote: goldImpactNoteFor(e.title, e.country),
        source: "live" as const,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    if (events.length > 0) {
      writeCal({ at: now, events });
      return { events, liveOk: true, source: "live" };
    }
  } catch {
    writeCal({
      at: cached?.at ?? 0,
      events: cached?.events ?? [],
      nextTry: now + CAL_BACKOFF_MS,
    });
  }

  if (cached && cached.events.length > 0 && now - cached.at < CAL_STALE_MS) {
    return {
      events: cached.events.map((e) => ({ ...e, source: "cached" })),
      liveOk: true,
      source: "cached",
    };
  }

  return { events: buildCuratedWeeklySchedule(), liveOk: false, source: "curated" };
}

// Legacy helper alias
export async function getUsdNews(): Promise<{ events: NewsEvent[]; ok: boolean }> {
  const res = await getEconomicNews();
  return {
    events: res.events.filter((e) => e.currency === "USD"),
    ok: res.liveOk,
  };
}
