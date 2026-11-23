"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/symbols";
import type { Snapshot, Trade } from "@/lib/types";

const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PRESET_TAGS = ["Followed Plan", "A+ Setup", "Key Level", "Killzone", "Partial TP", "Break-Even", "Early Entry", "News"];

export default function AnalyticsJournal({
  snap,
  busy,
  onAct,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const s = snap.state;
  const st = snap.stats;
  const closed = useMemo(
    () =>
      s.trades
        .filter((t) => t.status === "closed")
        .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    [s.trades],
  );

  const [selectedId, setSelectedId] = useState<string | null>(closed[0]?.id ?? null);
  const selectedTrade: Trade | undefined = closed.find((t) => t.id === selectedId) ?? closed[0];
  const [notesDraft, setNotesDraft] = useState(selectedTrade?.notes ?? "");
  const [tagsDraft, setTagsDraft] = useState<string[]>(selectedTrade?.tags ?? []);

  const selectTrade = (t: Trade) => {
    setSelectedId(t.id);
    setNotesDraft(t.notes);
    setTagsDraft(t.tags);
  };

  const toggleTag = (tag: string) => {
    setTagsDraft((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  };

  // Equity series
  const equitySeries = useMemo(() => {
    const asc = [...closed].reverse();
    let cur = s.settings.startingBalance;
    return [cur, ...asc.map((t) => (cur += t.pnl))];
  }, [closed, s.settings.startingBalance]);

  // Last 28 calendar days heatmap
  const calendarDays = useMemo(() => {
    const map = new Map(st.dailyCalendar.map((c) => [c.date, c]));
    const cells: Array<{ date: string; label: string; pnl: number; trades: number }> = [];
    const now = new Date();
    for (let d = 27; d >= 0; d--) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
      const key = dt.toISOString().slice(0, 10);
      const hit = map.get(key);
      cells.push({
        date: key,
        label: dt.toLocaleDateString([], { month: "short", day: "numeric" }),
        pnl: hit?.pnl ?? 0,
        trades: hit?.trades ?? 0,
      });
    }
    return cells;
  }, [st.dailyCalendar]);

  const targetProgress = Math.min(100, Math.max(0, (st.netReturnPct / Math.max(1, s.settings.profitTargetPct)) * 100));
  const dailyUsedPct = Math.min(100, (Math.max(0, -snap.dailyPnlPct) / Math.max(0.5, s.settings.dailyLossPct)) * 100);
  const ddUsedPct = Math.min(100, (snap.drawdownPct / Math.max(1, s.settings.maxDrawdownPct)) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div className="card-h">
          <div>
            <h2>Executive Performance, Prop-Firm Objectives & Revenue Ledger</h2>
            <div className="small muted">
              Account: <strong>{s.name}</strong> · Starting Capital: ${s.settings.startingBalance.toLocaleString()}
            </div>
          </div>
          <div className="btn-row no-print">
            <button className="btn gold" onClick={() => window.print()}>
              Print / Save PDF Client Report
            </button>
          </div>
        </div>

        {/* Prop-Firm Challenge Progress Gauges */}
        <div className="grid-4" style={{ marginBottom: 12 }}>
          <div className="card" style={{ background: "var(--panel2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span className="small muted">Profit Target (+{s.settings.profitTargetPct}%)</span>
              <strong className="pos">{st.netReturnPct >= 0 ? "+" : ""}{st.netReturnPct.toFixed(2)}%</strong>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${targetProgress}%`, background: "var(--green)" }} />
            </div>
          </div>

          <div className="card" style={{ background: "var(--panel2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span className="small muted">Daily Loss Used (Cap {s.settings.dailyLossPct}%)</span>
              <strong>{Math.max(0, -snap.dailyPnlPct).toFixed(2)}%</strong>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${dailyUsedPct}%`, background: dailyUsedPct > 70 ? "var(--red)" : "var(--gold)" }} />
            </div>
          </div>

          <div className="card" style={{ background: "var(--panel2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span className="small muted">Max Drawdown Buffer (Cap {s.settings.maxDrawdownPct}%)</span>
              <strong>{st.maxDrawdownPct.toFixed(2)}% peak DD</strong>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${ddUsedPct}%`, background: ddUsedPct > 70 ? "var(--red)" : "var(--blue)" }} />
            </div>
          </div>

          <div className="card" style={{ background: "var(--panel2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span className="small muted">Active Trading Days</span>
              <strong className="gold-txt">{st.tradingDays} days</strong>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${Math.min(100, st.tradingDays * 10)}%`, background: "var(--gold2)" }} />
            </div>
          </div>
        </div>

        {/* 12 Core Institutional Metrics */}
        <div className="kv-grid">
          <div className="kv"><div className="k">Balance</div><div className="v">${s.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          <div className="kv"><div className="k">Live Equity</div><div className="v">${snap.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          <div className="kv"><div className="k">All-Time Net Revenue</div><div className={`v ${st.netPnl >= 0 ? "pos" : "neg"}`}>{money(st.netPnl)}</div></div>
          <div className="kv"><div className="k">Today&apos;s Revenue</div><div className={`v ${st.todayPnl >= 0 ? "pos" : "neg"}`}>{money(st.todayPnl)}</div></div>
          <div className="kv"><div className="k">Last 7 Days</div><div className={`v ${st.pnl7d >= 0 ? "pos" : "neg"}`}>{money(st.pnl7d)}</div></div>
          <div className="kv"><div className="k">Last 30 Days</div><div className={`v ${st.pnl30d >= 0 ? "pos" : "neg"}`}>{money(st.pnl30d)}</div></div>
          <div className="kv"><div className="k">Win Rate ({st.wins}W/{st.losses}L)</div><div className="v">{st.winRate.toFixed(1)}%</div></div>
          <div className="kv"><div className="k">Profit Factor</div><div className="v gold-txt">{st.profitFactor.toFixed(2)}</div></div>
          <div className="kv"><div className="k">Sharpe Ratio</div><div className="v">{st.sharpeRatio.toFixed(2)}</div></div>
          <div className="kv"><div className="k">Expectancy / Trade</div><div className={`v ${st.expectancyUsd >= 0 ? "pos" : "neg"}`}>{money(st.expectancyUsd)}</div></div>
          <div className="kv"><div className="k">Avg Win / Avg Loss</div><div className="v" style={{ fontSize: 13 }}><span className="pos">+${st.avgWinUsd.toFixed(0)}</span> / <span className="neg">-${Math.abs(st.avgLossUsd).toFixed(0)}</span></div></div>
          <div className="kv"><div className="k">Long vs Short Win %</div><div className="v" style={{ fontSize: 13 }}>{st.longWinRate.toFixed(0)}% L · {st.shortWinRate.toFixed(0)}% S</div></div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <h2>Cumulative Account Equity Curve</h2>
            <span className="small muted">{st.closedCount} Closed Positions</span>
          </div>
          <CurveSvg series={equitySeries} />
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 11.5, color: "var(--gold2)", textTransform: "uppercase" }}>Performance by Market Session</h3>
            {st.sessionBreakdown.length === 0 ? (
              <div className="muted small">No session breakdown yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {st.sessionBreakdown.map((sb) => (
                  <div key={sb.session} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel2)", padding: "6px 10px", borderRadius: 7 }}>
                    <span>
                      <strong>{sb.session}</strong> <span className="muted small">({sb.trades} trades · {sb.winRate.toFixed(0)}% win)</span>
                    </span>
                    <strong className={sb.pnl >= 0 ? "pos" : "neg"}>{money(sb.pnl)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>28-Day Daily Revenue Calendar Heatmap</h2>
            <span className="small muted">Green = Profitable Day · Red = Net Loss Day</span>
          </div>
          <div className="heatmap-grid">
            {calendarDays.map((c) => (
              <div key={c.date} className={`heat-cell ${c.pnl > 0 ? "win" : c.pnl < 0 ? "loss" : ""}`}>
                <div className="small muted" style={{ fontSize: 10 }}>{c.label}</div>
                <div style={{ fontWeight: 800, fontSize: 11.5 }} className={c.pnl > 0 ? "pos" : c.pnl < 0 ? "neg" : "muted"}>
                  {c.trades > 0 ? (c.pnl >= 0 ? `+$${c.pnl.toFixed(0)}` : `-$${Math.abs(c.pnl).toFixed(0)}`) : "—"}
                </div>
                <div className="small muted" style={{ fontSize: 9.5 }}>
                  {c.trades > 0 ? `${c.trades} trade${c.trades > 1 ? "s" : ""}` : "Flat"}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Interactive Trade Journal */}
      <section className="card">
        <div className="card-h">
          <h2>Interactive Trade Journal & Post-Trade Review</h2>
          <span className="small muted">Click any closed trade on the left to tag setups & record review notes</span>
        </div>

        {closed.length === 0 ? (
          <div className="muted">No closed trades yet on this account. Switch to the $100k Prop-Firm Showcase account in the top bar to explore a populated journal.</div>
        ) : (
          <div className="grid-2">
            <div className="scroll-y">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Net</th>
                    <th>R</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((t) => (
                    <tr
                      key={t.id}
                      style={{
                        cursor: "pointer",
                        background: selectedTrade?.id === t.id ? "rgba(212,167,44,0.14)" : undefined,
                      }}
                      onClick={() => selectTrade(t)}
                    >
                      <td className="muted">{(t.closedAt ?? t.openedAt).slice(0, 10)}</td>
                      <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                      <td className={t.side === "BUY" ? "pos" : "neg"}>{t.side}</td>
                      <td className={t.pnl >= 0 ? "pos" : "neg"} style={{ fontWeight: 700 }}>{money(t.pnl)}</td>
                      <td>{t.rMultiple.toFixed(2)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedTrade && (
              <div className="card" style={{ background: "var(--panel2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong>
                    {selectedTrade.symbol} {selectedTrade.side} · {selectedTrade.initialLots.toFixed(2)} Lots
                  </strong>
                  <span className={selectedTrade.pnl >= 0 ? "pill good" : "pill bad"}>
                    {money(selectedTrade.pnl)} ({selectedTrade.rMultiple.toFixed(2)}R)
                  </span>
                </div>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  Entry {formatPrice(selectedTrade.symbol, selectedTrade.entry)} → Exit {formatPrice(selectedTrade.symbol, selectedTrade.exitPrice)} ·{" "}
                  {selectedTrade.closeReason}
                  <br />
                  Thesis: {selectedTrade.reason}
                </div>

                <div className="form-row">
                  <label>Setup & Discipline Tags</label>
                  <div className="btn-row">
                    {PRESET_TAGS.map((tg) => (
                      <button
                        key={tg}
                        type="button"
                        className={`btn xs ${tagsDraft.includes(tg) ? "active" : ""}`}
                        onClick={() => toggleTag(tg)}
                      >
                        {tg}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <label>Trader Review Notes</label>
                  <textarea
                    className="inp"
                    rows={3}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Write execution notes, lessons learned, or client commentary..."
                  />
                </div>

                <button
                  className="btn gold"
                  disabled={busy}
                  onClick={() =>
                    void onAct("updateJournal", {
                      tradeId: selectedTrade.id,
                      tags: tagsDraft,
                      notes: notesDraft,
                    })
                  }
                >
                  Save Journal Entry
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CurveSvg({ series }: { series: number[] }) {
  if (series.length < 2) return <div className="muted">Curve appears after first closed trade.</div>;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const poly = series
    .map((v, i) => `${(i / (series.length - 1)) * 500},${140 - ((v - min) / span) * 120 - 10}`)
    .join(" ");
  return (
    <svg viewBox="0 0 500 150" style={{ width: "100%", height: 165, background: "#0c1017", borderRadius: 8 }}>
      <polyline points={poly} fill="none" stroke="#22c55e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
