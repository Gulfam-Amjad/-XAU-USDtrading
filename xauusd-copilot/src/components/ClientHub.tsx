"use client";

import { useEffect, useMemo, useState } from "react";
import { evaluatePolicy, inTradingWindow, normalizePolicy, openRiskUsd, tradesOpenedToday } from "@/lib/policy";
import {
  buildHealth,
  buildReport,
  buildRiskRadar,
  fmtPf,
  reportToHtml,
  reportToMarkdown,
  reportToText,
  type ReportPeriod,
} from "@/lib/report";
import { SYMBOLS, SYMBOL_SPECS } from "@/lib/symbols";
import type { Snapshot, SymbolCode, TradingPolicy } from "@/lib/types";

type Tab = "overview" | "reports" | "mandate" | "goals";

const money = (n: number) =>
  `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function download(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ClientHub({
  snap,
  busy,
  onAct,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="btn-row no-print">
        {(
          [
            ["overview", "Health & Risk Radar"],
            ["reports", "Client Reports"],
            ["mandate", "Trading Mandate"],
            ["goals", "Income Goals"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview snap={snap} />}
      {tab === "reports" && <Reports snap={snap} busy={busy} onAct={onAct} />}
      {tab === "mandate" && <Mandate snap={snap} busy={busy} onAct={onAct} />}
      {tab === "goals" && <Goals snap={snap} />}
    </div>
  );
}

/* ---------------- Overview: health score + risk radar ---------------- */

function Overview({ snap }: { snap: Snapshot }) {
  const health = useMemo(() => buildHealth(snap), [snap]);
  const radar = useMemo(() => buildRiskRadar(snap), [snap]);
  const s = snap.state;
  const heatCap = s.policy.maxOpenRiskPct;
  const heatUsed = Math.min(100, (radar.heatPct / Math.max(0.1, heatCap)) * 100);
  const usdBias = radar.usdLongBias;

  return (
    <>
      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <div>
              <h2>Account Health Score</h2>
              <div className="small muted">One number for non-traders — combines loss limits, drawdown, streaks, open risk and data feed</div>
            </div>
            <span className="pill" style={{ color: health.color, borderColor: health.color }}>{health.label}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div
              style={{
                width: 118,
                height: 118,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: `conic-gradient(${health.color} ${health.score * 3.6}deg, var(--panel3) 0)`,
              }}
            >
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: "50%",
                  background: "var(--panel)",
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: health.color, lineHeight: 1 }}>{health.score}</div>
                  <div className="small muted">/ 100</div>
                </div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{health.plain}</div>
              {health.factors.length === 0 ? (
                <div className="small pos">No penalties — all safety margins are full.</div>
              ) : (
                health.factors.map((f) => (
                  <div key={f.name} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span>
                      <strong>{f.name}</strong> <span className="muted">· {f.note}</span>
                    </span>
                    <span className="neg">-{f.penalty}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <div>
              <h2>Risk Radar · Worst-Case Scenarios</h2>
              <div className="small muted">What happens if every open position hits its stop or target</div>
            </div>
            <span className={`pill ${radar.heatPct > heatCap ? "bad" : "gold"}`}>
              Heat {radar.heatPct.toFixed(2)}% / {heatCap}%
            </span>
          </div>
          <div className="kv-grid">
            <div className="kv"><div className="k">If all stops hit</div><div className={`v ${radar.worstCaseUsd >= 0 ? "pos" : "neg"}`}>{money(radar.worstCaseUsd)}</div></div>
            <div className="kv"><div className="k">If all targets hit</div><div className={`v ${radar.bestCaseUsd >= 0 ? "pos" : "neg"}`}>{money(radar.bestCaseUsd)}</div></div>
            <div className="kv"><div className="k">Floating now</div><div className={`v ${radar.floatingUsd >= 0 ? "pos" : "neg"}`}>{money(radar.floatingUsd)}</div></div>
            <div className="kv"><div className="k">Margin level</div><div className="v">{radar.marginLevelPct > 0 ? `${radar.marginLevelPct.toFixed(0)}%` : "—"}</div></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>Portfolio heat vs client cap</div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${heatUsed}%`, background: heatUsed > 85 ? "var(--red)" : heatUsed > 60 ? "var(--amber)" : "var(--green)" }} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>
              USD directional bias:{" "}
              <strong>{Math.abs(usdBias) < 0.15 ? "Balanced" : usdBias > 0 ? "Net long USD" : "Net short USD"}</strong>
              {radar.byExposure.length === 0 ? " (no open positions)" : ""}
            </div>
            <div className="prog-track" style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--line-bright)" }} />
              <div
                className="prog-fill"
                style={{
                  position: "absolute",
                  left: usdBias >= 0 ? "50%" : `${50 + usdBias * 50}%`,
                  width: `${Math.abs(usdBias) * 50}%`,
                  background: "var(--gold2)",
                }}
              />
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-h">
          <h2>Open Exposure Breakdown</h2>
          <span className="small muted">{radar.byExposure.length} open position(s)</span>
        </div>
        {radar.byExposure.length === 0 ? (
          <div className="muted small">Flat — no capital currently at risk.</div>
        ) : (
          <div className="scroll-x">
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr className="muted" style={{ textAlign: "left" }}>
                  <th>Instrument</th><th>Side</th><th>Lots</th><th>$ at risk</th><th style={{ width: "40%" }}>Share of total risk</th>
                </tr>
              </thead>
              <tbody>
                {radar.byExposure.map((e, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 0", fontWeight: 700 }}>{e.symbol} <span className="muted">{e.label}</span></td>
                    <td className={e.side === "BUY" ? "pos" : "neg"}>{e.side}</td>
                    <td>{e.lots.toFixed(2)}</td>
                    <td>${e.riskUsd.toFixed(2)}</td>
                    <td>
                      <div className="prog-track"><div className="prog-fill" style={{ width: `${e.sharePct}%`, background: "var(--gold)" }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------- Reports ---------------- */

function Reports({
  snap,
  busy,
  onAct,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("daily");
  const report = useMemo(() => buildReport(snap, period), [snap, period]);
  const stamp = report.rangeLabel.replace(/[^0-9]+/g, "-").replace(/^-|-$/g, "");

  const openPrintable = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(reportToHtml(report));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const emailDraft = () => {
    const subject = encodeURIComponent(`${report.title} · ${report.rangeLabel}`);
    const body = encodeURIComponent(reportToText(report));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <section className="card">
      <div className="card-h">
        <div>
          <h2>Client Performance Reports</h2>
          <div className="small muted">Auto-generated from the live ledger — share with the client daily, weekly or monthly</div>
        </div>
        <div className="btn-row">
          {(["daily", "weekly", "monthly"] as const).map((p) => (
            <button key={p} className={`btn xs ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn gold" onClick={openPrintable}>Print / Save as PDF</button>
        <button className="btn" onClick={() => download(`AurumDesk_${period}_${stamp}.html`, "text/html", reportToHtml(report))}>Download HTML</button>
        <button className="btn" onClick={() => download(`AurumDesk_${period}_${stamp}.md`, "text/markdown", reportToMarkdown(report))}>Download Markdown</button>
        <button className="btn" onClick={emailDraft}>Email Draft</button>
        <button className="btn green" disabled={busy} onClick={() => void onAct("sendReport", { text: reportToText(report) })}>
          Send to Telegram
        </button>
      </div>

      <div className="kv-grid">
        <div className="kv"><div className="k">{report.title}</div><div className="v" style={{ fontSize: 13 }}>{report.rangeLabel}</div></div>
        <div className="kv"><div className="k">Net P&amp;L</div><div className={`v ${report.netPnl >= 0 ? "pos" : "neg"}`}>{money(report.netPnl)}</div></div>
        <div className="kv"><div className="k">Return</div><div className={`v ${report.netPct >= 0 ? "pos" : "neg"}`}>{report.netPct >= 0 ? "+" : ""}{report.netPct.toFixed(2)}%</div></div>
        <div className="kv"><div className="k">Trades ({report.wins}W/{report.losses}L)</div><div className="v">{report.trades}</div></div>
        <div className="kv"><div className="k">Win rate</div><div className="v">{report.winRate.toFixed(1)}%</div></div>
        <div className="kv"><div className="k">Profit factor</div><div className="v gold-txt">{fmtPf(report.profitFactor)}</div></div>
        <div className="kv"><div className="k">Best / Worst</div><div className="v" style={{ fontSize: 13 }}><span className="pos">{money(report.best)}</span> / <span className="neg">{money(report.worst)}</span></div></div>
        <div className="kv"><div className="k">Risk avoided ({report.blocked} blocked)</div><div className="v gold-txt">${report.savedRiskUsd.toFixed(0)}</div></div>
      </div>

      <div className="grid-3" style={{ marginTop: 12 }}>
        <ReportList title="Highlights" items={report.highlights} color="var(--green)" />
        <ReportList title="Risk watch-outs" items={report.warnings} color="var(--amber)" />
        <ReportList title="Recommended next steps" items={report.nextSteps} color="var(--blue)" />
      </div>

      <h3 style={{ fontSize: 11.5, color: "var(--gold2)", textTransform: "uppercase", margin: "14px 0 6px" }}>Closed trades in period</h3>
      {report.rows.length === 0 ? (
        <div className="muted small">No closed trades in this period.</div>
      ) : (
        <div className="scroll-y scroll-x">
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr className="muted" style={{ textAlign: "left" }}>
                <th>Closed (UTC)</th><th>Symbol</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px 0" }}>{r.closedAt.slice(0, 16).replace("T", " ")}</td>
                  <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                  <td className={r.side === "BUY" ? "pos" : "neg"}>{r.side}</td>
                  <td>{r.lots.toFixed(2)}</td>
                  <td>{r.entry}</td>
                  <td>{r.exit}</td>
                  <td className={r.pnl >= 0 ? "pos" : "neg"}>{money(r.pnl)}</td>
                  <td>{r.r.toFixed(2)}</td>
                  <td className="muted">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className="card" style={{ background: "var(--panel2)", borderLeft: `3px solid ${color}` }}>
      <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((i, n) => (
          <li key={n} className="small" style={{ marginBottom: 4 }}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Mandate ---------------- */

function Mandate({
  snap,
  busy,
  onAct,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const s = snap.state;
  const [draft, setDraft] = useState<TradingPolicy>(() => normalizePolicy(s.policy));
  useEffect(() => setDraft(normalizePolicy(s.policy)), [s.policy, s.id]);

  const now = new Date();
  const live = normalizePolicy(s.policy);
  const dirty = JSON.stringify(draft) !== JSON.stringify(live);
  const today = tradesOpenedToday(s, now);
  const heatUsd = openRiskUsd(s);
  const heatCapUsd = (s.balance * live.maxOpenRiskPct) / 100;
  const windowOpen = inTradingWindow(live, now);

  const plan = snap.decision?.plan ?? null;
  const preview = plan ? evaluatePolicy(s, plan, now) : null;

  const num = (k: keyof TradingPolicy, v: string) => setDraft((p) => ({ ...p, [k]: v === "" ? 0 : Number(v) }));
  const toggleSymbol = (sym: SymbolCode) =>
    setDraft((p) => ({
      ...p,
      allowedSymbols: p.allowedSymbols.includes(sym) ? p.allowedSymbols.filter((x) => x !== sym) : [...p.allowedSymbols, sym],
    }));

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-h">
          <div>
            <h2>Client Trading Mandate</h2>
            <div className="small muted">
              Authority granted to the AI. Enforced in server code on every automated entry — the bot physically cannot exceed it.
            </div>
          </div>
          <span className={`pill ${s.settings.mode === "signal" ? "warn" : "good"}`}>Mode: {s.settings.mode.toUpperCase()}</span>
        </div>

        <div className="form-row">
          <label>Approved instruments</label>
          <div className="btn-row">
            {SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                className={`btn xs ${draft.allowedSymbols.includes(sym) ? "active" : ""}`}
                onClick={() => toggleSymbol(sym)}
              >
                {SYMBOL_SPECS[sym].shortName}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-3">
          <div className="form-row">
            <label>Max lots per trade</label>
            <input className="inp" type="number" step="0.01" value={draft.maxLotsPerTrade} onChange={(e) => num("maxLotsPerTrade", e.target.value)} />
          </div>
          <div className="form-row">
            <label>Max automated trades / day</label>
            <input className="inp" type="number" value={draft.maxTradesPerDay} onChange={(e) => num("maxTradesPerDay", e.target.value)} />
          </div>
          <div className="form-row">
            <label>Max total open risk (%)</label>
            <input className="inp" type="number" step="0.1" value={draft.maxOpenRiskPct} onChange={(e) => num("maxOpenRiskPct", e.target.value)} />
          </div>
          <div className="form-row">
            <label>Human approval above ($ risk, 0 = off)</label>
            <input className="inp" type="number" value={draft.autoApprovalMaxRiskUsd} onChange={(e) => num("autoApprovalMaxRiskUsd", e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <label>
            <input
              type="checkbox"
              checked={draft.tradingWindowEnabled}
              onChange={(e) => setDraft((p) => ({ ...p, tradingWindowEnabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Restrict automation to a daily time window (UTC)
          </label>
          <div className="btn-row">
            <input className="inp" style={{ width: 80 }} type="number" min={0} max={23} disabled={!draft.tradingWindowEnabled} value={draft.windowStartUtc} onChange={(e) => num("windowStartUtc", e.target.value)} />
            <span className="muted">to</span>
            <input className="inp" style={{ width: 80 }} type="number" min={0} max={23} disabled={!draft.tradingWindowEnabled} value={draft.windowEndUtc} onChange={(e) => num("windowEndUtc", e.target.value)} />
            <span className="small muted">e.g. 7 → 20 covers London + New York</span>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn gold" disabled={busy || !dirty} onClick={() => void onAct("updatePolicy", { ...draft })}>
            Save Mandate
          </button>
          <button className="btn" disabled={!dirty} onClick={() => setDraft(live)}>Discard changes</button>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Mandate Live Status</h2>
          <span className={`pill ${windowOpen ? "good" : "warn"}`}>{windowOpen ? "Window open" : "Outside window"}</span>
        </div>
        <Meter label={`Automated trades today (${today}/${live.maxTradesPerDay})`} value={today} max={live.maxTradesPerDay} />
        <Meter label={`Open risk $${heatUsd.toFixed(0)} of $${heatCapUsd.toFixed(0)} cap`} value={heatUsd} max={Math.max(1, heatCapUsd)} />
        <div className="small muted" style={{ margin: "10px 0 6px" }}>Would the current AI plan be allowed?</div>
        {!plan ? (
          <div className="small">No active trade plan right now — the AI is waiting for a setup.</div>
        ) : preview?.allowed ? (
          <div className="small pos">
            Yes — {plan.symbol} {plan.side}{preview.clamped ? ` (lots trimmed to ${preview.plan?.lots})` : ""} fits inside the mandate.
          </div>
        ) : (
          <div className="small neg">Blocked: {preview?.reason}</div>
        )}
        <div className="small muted" style={{ marginTop: 12 }}>
          Related hard limits (risk per trade, daily loss, drawdown, kill switch) live in <strong>MT5/Risk → Governance</strong>. Every change here is written to the audit trail.
        </div>
      </section>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / Math.max(0.0001, max)) * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="small muted" style={{ marginBottom: 3 }}>{label}</div>
      <div className="prog-track">
        <div className="prog-fill" style={{ width: `${pct}%`, background: pct > 85 ? "var(--red)" : pct > 60 ? "var(--amber)" : "var(--green)" }} />
      </div>
    </div>
  );
}

/* ---------------- Goals ---------------- */

function Goals({ snap }: { snap: Snapshot }) {
  const s = snap.state;
  const key = `aurum.goal.${s.id}`;
  const [goal, setGoal] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(key) ?? String(Math.round(s.settings.startingBalance * 0.05));
  });
  useEffect(() => {
    setGoal(window.localStorage.getItem(key) ?? String(Math.round(s.settings.startingBalance * 0.05)));
  }, [key, s.settings.startingBalance]);

  const target = Math.max(0, Number(goal) || 0);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = now.getUTCDate();
  const monthStart = Date.UTC(y, m, 1);

  const mtd = s.trades
    .filter((t) => t.status === "closed" && t.closedAt && Date.parse(t.closedAt) >= monthStart)
    .reduce((a, t) => a + t.pnl, 0);
  const projected = (mtd / Math.max(1, day)) * daysInMonth;
  const remaining = Math.max(0, target - mtd);
  const daysLeft = Math.max(1, daysInMonth - day);
  const perDay = remaining / daysLeft;
  const pct = target > 0 ? Math.min(100, Math.max(0, (mtd / target) * 100)) : 0;
  const onTrack = projected >= target && target > 0;

  return (
    <section className="card" style={{ maxWidth: 760 }}>
      <div className="card-h">
        <div>
          <h2>Monthly Income Goal Tracker</h2>
          <div className="small muted">Set the monthly profit the client wants and see if the current pace gets there</div>
        </div>
        <span className={`pill ${onTrack ? "good" : "warn"}`}>{target === 0 ? "No goal set" : onTrack ? "On pace" : "Behind pace"}</span>
      </div>

      <div className="form-row" style={{ maxWidth: 260 }}>
        <label>Monthly profit goal (USD)</label>
        <input
          className="inp"
          type="number"
          value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            window.localStorage.setItem(key, e.target.value);
          }}
        />
      </div>

      <div className="prog-track" style={{ height: 14 }}>
        <div className="prog-fill" style={{ width: `${pct}%`, background: onTrack ? "var(--green)" : "var(--gold)" }} />
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>{pct.toFixed(0)}% of goal reached · day {day} of {daysInMonth}</div>

      <div className="kv-grid" style={{ marginTop: 12 }}>
        <div className="kv"><div className="k">Month-to-date</div><div className={`v ${mtd >= 0 ? "pos" : "neg"}`}>{money(mtd)}</div></div>
        <div className="kv"><div className="k">Projected month-end</div><div className={`v ${projected >= 0 ? "pos" : "neg"}`}>{money(projected)}</div></div>
        <div className="kv"><div className="k">Still needed</div><div className="v">${remaining.toFixed(2)}</div></div>
        <div className="kv"><div className="k">Required per remaining day</div><div className="v gold-txt">${perDay.toFixed(2)}</div></div>
      </div>

      <div className="small muted" style={{ marginTop: 12 }}>
        Projection extrapolates this month&apos;s results linearly and is only an estimate. The AI never increases risk to chase a goal — position sizing stays inside the mandate and guardrails.
      </div>
    </section>
  );
}
