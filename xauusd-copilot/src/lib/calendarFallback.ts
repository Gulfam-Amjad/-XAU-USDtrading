import type { NewsEvent } from "./types";

const GOLD_NOTES: Array<{ match: RegExp; note: string }> = [
  {
    match: /cpi|pce|inflation/i,
    note: "Key US inflation print. Higher-than-expected inflation lifts real yields and USD, often triggering $20-$45 XAU/USD spikes.",
  },
  {
    match: /fomc|fed|powell|interest rate|minutes/i,
    note: "Federal Reserve policy catalyst. Hawkish tone pressures Gold; dovish pivot typically fuels strong XAU/USD breakouts.",
  },
  {
    match: /non-farm|nfp|employment|unemployment|jobless|claims|jolts|adp/i,
    note: "US labor-market catalyst. Weak labor data increases rate-cut expectations and tends to support XAU/USD.",
  },
  {
    match: /gdp|pmi|ism|retail sales|durable|consumer confidence/i,
    note: "US growth & demand gauge. Sharp surprises drive intraday DXY and XAU/USD momentum during the NY open.",
  },
];

export function goldImpactNoteFor(title: string, currency: string): string {
  for (const g of GOLD_NOTES) {
    if (g.match.test(title)) return g.note;
  }
  if (currency === "USD") return "US macro release affecting DXY and Treasury yields; monitor XAU/USD spread around release.";
  return `${currency} macro release; affects ${currency}/USD pairs and broad FX risk sentiment.`;
}

// Builds a realistic current-week macro schedule anchored to Monday 00:00 UTC of the current week
// so if the free ForexFactory JSON feed is rate-limited (HTTP 429), the calendar and session planner stay functional.
export function buildCuratedWeeklySchedule(now = new Date()): NewsEvent[] {
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMon, 0, 0, 0));

  const slot = (dayOffset: number, hourUtc: number, minUtc: number): string => {
    const d = new Date(mon.getTime());
    d.setUTCDate(mon.getUTCDate() + dayOffset);
    d.setUTCHours(hourUtc, minUtc, 0, 0);
    return d.toISOString();
  };

  const items: Array<Omit<NewsEvent, "id" | "goldNote" | "source">> = [
    { title: "Flash Manufacturing PMI", currency: "EUR", impact: "Medium", time: slot(0, 9, 0), forecast: "46.2", previous: "45.9" },
    { title: "Flash Services PMI", currency: "GBP", impact: "Medium", time: slot(0, 9, 30), forecast: "52.0", previous: "51.8" },
    { title: "US Flash Manufacturing PMI", currency: "USD", impact: "Medium", time: slot(0, 14, 45), forecast: "54.5", previous: "56.0" },
    { title: "US Flash Services PMI", currency: "USD", impact: "High", time: slot(0, 14, 45), forecast: "55.6", previous: "57.9" },
    { title: "CB Consumer Confidence", currency: "USD", impact: "High", time: slot(1, 15, 0), forecast: "111.8", previous: "108.7" },
    { title: "Richmond Manufacturing Index", currency: "USD", impact: "Low", time: slot(1, 15, 0), forecast: "-10", previous: "-14" },
    { title: "FOMC Meeting Minutes", currency: "USD", impact: "High", time: slot(1, 19, 0), forecast: "", previous: "" },
    { title: "Prelim GDP q/q", currency: "USD", impact: "High", time: slot(2, 13, 30), forecast: "3.5%", previous: "3.4%" },
    { title: "Unemployment Claims", currency: "USD", impact: "Medium", time: slot(2, 13, 30), forecast: "201K", previous: "203K" },
    { title: "Core PCE Price Index m/m", currency: "USD", impact: "High", time: slot(2, 13, 30), forecast: "0.3%", previous: "0.3%" },
    { title: "Core Durable Goods Orders m/m", currency: "USD", impact: "Medium", time: slot(2, 13, 30), forecast: "0.5%", previous: "0.5%" },
    { title: "Pending Home Sales m/m", currency: "USD", impact: "Low", time: slot(2, 15, 0), forecast: "1.2%", previous: "2.0%" },
    { title: "Tokyo Core CPI y/y", currency: "JPY", impact: "Medium", time: slot(3, 23, 30), forecast: "2.2%", previous: "1.8%" },
    { title: "Eurozone CPI Flash Estimate y/y", currency: "EUR", impact: "High", time: slot(4, 10, 0), forecast: "2.3%", previous: "2.0%" },
    { title: "Chicago PMI", currency: "USD", impact: "Medium", time: slot(4, 14, 45), forecast: "44.8", previous: "41.6" },
  ];

  return items.map((it, idx) => ({
    ...it,
    id: `curated-${idx + 1}`,
    goldNote: goldImpactNoteFor(it.title, it.currency),
    source: "curated",
  }));
}
