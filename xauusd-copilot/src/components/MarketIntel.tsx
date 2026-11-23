"use client";

import { useMemo, useState } from "react";
import { worldSessionsSnapshot } from "@/lib/indicators";
import { formatPrice, SYMBOL_SPECS } from "@/lib/symbols";
import type { Snapshot, SymbolCode } from "@/lib/types";

export default function MarketIntel({
  snap,
  onSelectSymbol,
}: {
  snap: Snapshot;
  onSelectSymbol: (sym: SymbolCode) => void;
}) {
  const [impactFilter, setImpactFilter] = useState<"ALL" | "High" | "Medium">("ALL");
  const [curFilter, setCurFilter] = useState<string>("ALL");

  const sessions = useMemo(() => worldSessionsSnapshot(new Date()), [snap.generatedAt]);

  const goldQuote = snap.watchlist.find((w) => w.symbol === "XAUUSD");
  const silverQuote = snap.watchlist.find((w) => w.symbol === "XAGUSD");
  const goldSilverRatio =
    goldQuote && silverQuote && silverQuote.mid > 0 ? (goldQuote.mid / silverQuote.mid).toFixed(2) : "--";

  const filteredNews = useMemo(() => {
    return snap.news.filter((n) => {
      if (impactFilter !== "ALL" && n.impact !== impactFilter) return false;
      if (curFilter !== "ALL" && n.currency !== curFilter) return false;
      return true;
    });
  }, [snap.news, impactFilter, curFilter]);

  const nextHighUsd = useMemo(() => {
    const now = Date.now();
    return snap.news.find((n) => n.currency === "USD" && n.impact === "High" && Date.parse(n.time) > now);
  }, [snap.news]);

  const countdown = useMemo(() => {
    if (!nextHighUsd) return "No remaining High-Impact USD release this week";
    const diffMin = Math.max(0, Math.round((Date.parse(nextHighUsd.time) - Date.now()) / 60000));
    const d = Math.floor(diffMin / 1440);
    const h = Math.floor((diffMin % 1440) / 60);
    const m = diffMin % 60;
    return `${nextHighUsd.title} in ${d > 0 ? `${d}d ` : ""}${h}h ${m}m`;
  }, [nextHighUsd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Global Session Clock */}
      <section className="card">
        <div className="card-h">
          <div>
            <h2>24-Hour Global Liquidity & Killzone Clock (UTC)</h2>
            <div className="small muted">
              Current Server UTC: {new Date(snap.generatedAt).toISOString().slice(11, 16)} UTC · Gold moves cleanest during London & London/NY Overlap
            </div>
          </div>
          <span className="pill gold">Gold / Silver Ratio: {goldSilverRatio}</span>
        </div>

        <div className="grid-3">
          {sessions.map((s) => (
            <div
              key={s.name}
              className="card"
              style={{
                background: s.active ? "rgba(34, 197, 94, 0.1)" : "var(--panel2)",
                borderColor: s.active ? "rgba(34, 197, 94, 0.45)" : "var(--line)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <strong>{s.name}</strong>
                <span className={`pill ${s.active ? "good" : ""}`}>{s.active ? "OPEN NOW" : "Closed"}</span>
              </div>
              <div className="small gold-txt">{s.windowUtc}</div>
              <div className="small muted" style={{ marginTop: 4 }}>{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Cross-Asset Correlation Matrix */}
      <section className="card">
        <div className="card-h">
          <h2>Cross-Asset Gold Drivers & Live Feed Matrix</h2>
          <span className="small muted">Click any market to load its chart in the Trading Terminal</span>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Asset Class</th>
                <th>Bid / Ask</th>
                <th>Spread</th>
                <th>24h Change</th>
                <th>Day Low / High</th>
                <th>Gold Correlation Role</th>
              </tr>
            </thead>
            <tbody>
              {snap.watchlist.map((w) => {
                const spec = SYMBOL_SPECS[w.symbol];
                const role =
                  w.symbol === "XAUUSD"
                    ? "Primary Benchmark Metal"
                    : w.symbol === "XAGUSD"
                      ? "High-Beta Precious Metal Confirmation"
                      : w.symbol === "EURUSD" || w.symbol === "GBPUSD"
                        ? "Inverse DXY / USD Dollar Strength Gauge"
                        : w.symbol === "USDJPY"
                          ? "US 10Y Treasury Yield Proxy (Inverse to Gold)"
                          : "Global Liquidity & Risk-Appetite Thermometer";
                return (
                  <tr key={w.symbol} style={{ cursor: "pointer" }} onClick={() => onSelectSymbol(w.symbol)}>
                    <td style={{ fontWeight: 800 }} className="gold-txt">{w.symbol}</td>
                    <td>{spec.category}</td>
                    <td>
                      {formatPrice(w.symbol, w.bid)} / {formatPrice(w.symbol, w.ask)}
                    </td>
                    <td>{formatPrice(w.symbol, w.spread)}</td>
                    <td className={w.dayChangePct >= 0 ? "pos" : "neg"} style={{ fontWeight: 700 }}>
                      {w.dayChangePct >= 0 ? "+" : ""}
                      {w.dayChangePct.toFixed(2)}%
                    </td>
                    <td className="muted">
                      {formatPrice(w.symbol, w.low)} – {formatPrice(w.symbol, w.high)}
                    </td>
                    <td className="muted">{role}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Resilient Economic Calendar */}
      <section className="card">
        <div className="card-h">
          <div>
            <h2>Macro Economic Calendar & XAU/USD Volatility Guide</h2>
            <div className="small muted">
              Next High-Impact USD Catalyst: <strong className="gold-txt">{countdown}</strong>
            </div>
          </div>
          <div className="btn-row">
            <span className={`pill ${snap.newsSource === "live" ? "good" : "warn"}`}>
              Source: {snap.newsSource === "live" ? "Live ForexFactory" : snap.newsSource === "cached" ? "Cached Feed" : "Built-in Resilient Schedule"}
            </span>
            {(["ALL", "High", "Medium"] as const).map((imp) => (
              <button
                key={imp}
                className={`btn xs ${impactFilter === imp ? "active" : ""}`}
                onClick={() => setImpactFilter(imp)}
              >
                {imp}
              </button>
            ))}
            {["ALL", "USD", "EUR", "GBP", "JPY"].map((c) => (
              <button
                key={c}
                className={`btn xs ${curFilter === c ? "active" : ""}`}
                onClick={() => setCurFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Currency</th>
                <th>Impact</th>
                <th>Event</th>
                <th>Forecast</th>
                <th>Previous</th>
                <th>Gold / Market Impact Note</th>
              </tr>
            </thead>
            <tbody>
              {filteredNews.map((n) => {
                const isPast = Date.parse(n.time) < Date.now();
                return (
                  <tr key={n.id} style={{ opacity: isPast ? 0.58 : 1 }}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {n.time.slice(0, 16).replace("T", " ")} {isPast ? "(Done)" : ""}
                    </td>
                    <td style={{ fontWeight: 800 }}>{n.currency}</td>
                    <td>
                      <span
                        className={`pill ${
                          n.impact === "High" ? "bad" : n.impact === "Medium" ? "warn" : ""
                        }`}
                      >
                        {n.impact}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{n.title}</td>
                    <td>{n.forecast || "—"}</td>
                    <td className="muted">{n.previous || "—"}</td>
                    <td className="muted small">{n.goldNote}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
