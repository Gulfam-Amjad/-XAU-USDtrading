"use client";

import { useEffect, useState } from "react";
import { STRATEGY_PRESETS } from "@/lib/seed";
import type { Snapshot, StrategyConfig, StrategyId } from "@/lib/types";

const SESSION_OPTIONS: Array<{ id: StrategyConfig["allowedSessions"][number]; label: string }> = [
  { id: "asian", label: "Asian (00-07 UTC)" },
  { id: "london", label: "London (07-12 UTC)" },
  { id: "ny_overlap", label: "London/NY Killzone (12-16 UTC)" },
  { id: "ny", label: "New York (16-21 UTC)" },
];

export default function StrategyStudio({
  snap,
  busy,
  onAct,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const strat = snap.state.strategy;
  const [form, setForm] = useState<StrategyConfig>(strat);

  useEffect(() => {
    setForm(strat);
  }, [strat]);

  const setNum = (k: keyof StrategyConfig, v: string) => {
    setForm((prev) => ({ ...prev, [k]: Number(v) }));
  };

  const toggleSession = (id: StrategyConfig["allowedSessions"][number]) => {
    setForm((prev) => {
      const exists = prev.allowedSessions.includes(id);
      const next = exists ? prev.allowedSessions.filter((x) => x !== id) : [...prev.allowedSessions, id];
      return { ...prev, allowedSessions: next.length ? next : [id] };
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div className="card-h">
          <div>
            <h2>Strategy Studio · Select Trading Blueprint</h2>
            <div className="small muted">
              Switch institutional rulebooks instantly or customize every indicator, R:R, session, and news filter below.
            </div>
          </div>
          <span className="pill gold">Active: {STRATEGY_PRESETS[strat.activeStrategy].name}</span>
        </div>

        <div className="grid-4">
          {(Object.keys(STRATEGY_PRESETS) as StrategyId[]).map((id) => {
            const p = STRATEGY_PRESETS[id];
            const active = strat.activeStrategy === id;
            return (
              <div
                key={id}
                className="card"
                style={{
                  background: active ? "rgba(212, 167, 44, 0.12)" : "var(--panel2)",
                  borderColor: active ? "var(--gold)" : "var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 13.5, color: active ? "var(--gold2)" : "var(--text)" }}>{p.name}</strong>
                    {active && <span className="pill good">Active</span>}
                  </div>
                  <div className="small gold-txt" style={{ marginBottom: 6 }}>{p.tagline}</div>
                  <div className="small muted">{p.description}</div>
                </div>
                <button
                  className={`btn ${active ? "gold" : ""}`}
                  disabled={busy}
                  onClick={() => void onAct("setStrategyPreset", { strategyId: id })}
                >
                  {active ? "Loaded Preset" : "Activate Blueprint"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Custom Rule & Parameter Tuning</h2>
          <button
            className="btn gold"
            disabled={busy}
            onClick={() => void onAct("updateStrategyConfig", form as unknown as Record<string, unknown>)}
          >
            Save & Apply to Live 8-Gate Engine
          </button>
        </div>

        <div className="grid-3">
          <div className="card" style={{ background: "var(--panel2)" }}>
            <h3 style={{ marginTop: 0, color: "var(--gold2)", fontSize: 12 }}>1. Trend & Momentum Indicators</h3>
            <div className="grid-2">
              <div className="form-row">
                <label>Fast EMA Period</label>
                <input className="inp" type="number" value={form.emaFast} onChange={(e) => setNum("emaFast", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Slow EMA Period</label>
                <input className="inp" type="number" value={form.emaSlow} onChange={(e) => setNum("emaSlow", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Macro EMA Period</label>
                <input className="inp" type="number" value={form.emaMacro} onChange={(e) => setNum("emaMacro", e.target.value)} />
              </div>
              <div className="form-row">
                <label>RSI Period (15m)</label>
                <input className="inp" type="number" value={form.rsiPeriod} onChange={(e) => setNum("rsiPeriod", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Buy RSI Min / Max</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input className="inp" type="number" value={form.rsiBuyMin} onChange={(e) => setNum("rsiBuyMin", e.target.value)} />
                  <input className="inp" type="number" value={form.rsiBuyMax} onChange={(e) => setNum("rsiBuyMax", e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <label>Sell RSI Min / Max</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input className="inp" type="number" value={form.rsiSellMin} onChange={(e) => setNum("rsiSellMin", e.target.value)} />
                  <input className="inp" type="number" value={form.rsiSellMax} onChange={(e) => setNum("rsiSellMax", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ background: "var(--panel2)" }}>
            <h3 style={{ marginTop: 0, color: "var(--gold2)", fontSize: 12 }}>2. Stop Loss, Target R:R & Exits</h3>
            <div className="grid-2">
              <div className="form-row">
                <label>Stop Buffer (x ATR)</label>
                <input className="inp" type="number" step="0.1" value={form.atrMultiplierStop} onChange={(e) => setNum("atrMultiplierStop", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Final Target (R:R)</label>
                <input className="inp" type="number" step="0.1" value={form.rewardRatio} onChange={(e) => setNum("rewardRatio", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Min Structure Room (R)</label>
                <input className="inp" type="number" step="0.1" value={form.minRoomR} onChange={(e) => setNum("minRoomR", e.target.value)} />
              </div>
              <div className="form-row">
                <label>TP1 Split Level (R)</label>
                <input className="inp" type="number" step="0.1" value={form.tp1R} onChange={(e) => setNum("tp1R", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Trailing Stop (x ATR, 0=Off)</label>
                <input className="inp" type="number" step="0.1" value={form.trailingStopAtr} onChange={(e) => setNum("trailingStopAtr", e.target.value)} />
              </div>
              <div className="form-row">
                <label>Loss-Streak Cooldown</label>
                <input className="inp" type="number" value={form.cooldownAfterLosses} onChange={(e) => setNum("cooldownAfterLosses", e.target.value)} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.partialTpEnabled}
                onChange={(e) => setForm((p) => ({ ...p, partialTpEnabled: e.target.checked }))}
              />
              <span>Enable Split TP1 (close 50% at +{form.tp1R}R & lock SL at Break-Even)</span>
            </label>
          </div>

          <div className="card" style={{ background: "var(--panel2)" }}>
            <h3 style={{ marginTop: 0, color: "var(--gold2)", fontSize: 12 }}>3. Allowed Killzones & News Policy</h3>
            <div className="form-row">
              <label>Permitted Trading Sessions</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 3 }}>
                {SESSION_OPTIONS.map((sOpt) => (
                  <label key={sOpt.id} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={form.allowedSessions.includes(sOpt.id)}
                      onChange={() => toggleSession(sOpt.id)}
                    />
                    <span>{sOpt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="form-row">
                <label>News Blackout Before (m)</label>
                <input className="inp" type="number" value={form.newsBlackoutBeforeMin} onChange={(e) => setNum("newsBlackoutBeforeMin", e.target.value)} />
              </div>
              <div className="form-row">
                <label>News Blackout After (m)</label>
                <input className="inp" type="number" value={form.newsBlackoutAfterMin} onChange={(e) => setNum("newsBlackoutAfterMin", e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label>If Live Calendar Rate-Limits (HTTP 429)</label>
              <select
                className="inp"
                value={form.newsOfflinePolicy}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    newsOfflinePolicy: e.target.value as "fail_closed" | "warn_only",
                  }))
                }
              >
                <option value="warn_only">Use Built-in Curated Macro Schedule (Recommended)</option>
                <option value="fail_closed">Strict Fail-Closed (Halt All Entries)</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
