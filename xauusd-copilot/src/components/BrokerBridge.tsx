"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";

const MODE_LABELS = {
  signal: "Signal Only (Advisory)",
  semi: "Semi-Auto (Human Approval)",
  auto: "Auto (Within Hard Limits)",
} as const;

export default function BrokerBridge({
  snap,
  busy,
  onAct,
  onRefresh,
  onToast,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const st = snap.state.settings;
  const br = snap.mt5Bridge;

  const [riskForm, setRiskForm] = useState({
    riskPct: String(st.riskPct),
    dailyLossPct: String(st.dailyLossPct),
    maxDrawdownPct: String(st.maxDrawdownPct),
    profitTargetPct: String(st.profitTargetPct),
    maxOpenTrades: String(st.maxOpenTrades),
    maxSpread: String(st.maxSpread),
  });

  const [newAccName, setNewAccName] = useState("$50k Funded Evaluation");
  const [newAccBal, setNewAccBal] = useState("50000");
  const [newAccProp, setNewAccProp] = useState(true);

  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState(snap.telegram.chatId);
  const [tgBusy, setTgBusy] = useState(false);

  useEffect(() => {
    setRiskForm({
      riskPct: String(st.riskPct),
      dailyLossPct: String(st.dailyLossPct),
      maxDrawdownPct: String(st.maxDrawdownPct),
      profitTargetPct: String(st.profitTargetPct),
      maxOpenTrades: String(st.maxOpenTrades),
      maxSpread: String(st.maxSpread),
    });
  }, [st]);

  const simulateMt5Ping = async () => {
    try {
      const r = await fetch("/api/mt5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: br.token,
          brokerName: "IC Markets / FTMO Demo Server",
          accountLogin: "50892411",
          accountServer: "ICMarketsSC-Demo04",
          terminalBuild: "4620",
          balance: snap.state.balance,
          equity: snap.equity,
        }),
      });
      if (r.ok) {
        onToast("Simulated MT5 Expert Advisor heartbeat received! Status is now CONNECTED.");
        await onRefresh();
      }
    } catch {
      onToast("Could not simulate MT5 ping.");
    }
  };

  const sendTelegramTest = async () => {
    setTgBusy(true);
    try {
      const r = await fetch("/api/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: tgToken, chatId: tgChatId }),
      });
      const data = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      onToast(data.message ?? data.error ?? "Done");
      await onRefresh();
    } finally {
      setTgBusy(false);
    }
  };

  const mt5Online =
    br.lastHeartbeatAt !== null && Date.now() - Date.parse(br.lastHeartbeatAt) < 10 * 60 * 1000;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="grid-2">
        {/* Governance & Risk Guard */}
        <section className="card">
          <div className="card-h">
            <div>
              <h2>Governance, Autonomy & Hard Risk Guardrails</h2>
              <div className="small muted">Enforced server-side in deterministic code — AI can never override these caps</div>
            </div>
            <button className="btn xs gold" disabled={busy} onClick={() => void onAct("propFirm")}>
              Apply FTMO Prop Preset
            </button>
          </div>

          <div className="form-row">
            <label>Autonomy Permission Level</label>
            <div className="btn-row">
              {(["signal", "semi", "auto"] as const).map((m) => (
                <button
                  key={m}
                  className={`btn ${st.mode === m ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => void onAct("mode", { mode: m })}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row" style={{ marginTop: 8 }}>
            <label>Directional Mandate</label>
            <div className="btn-row">
              {(["both", "buy", "sell", "paused"] as const).map((d) => (
                <button
                  key={d}
                  className={`btn ${st.direction === d ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => void onAct("direction", { direction: d })}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid-3" style={{ marginTop: 10 }}>
            <div className="form-row">
              <label>Risk per Trade (%)</label>
              <input className="inp" value={riskForm.riskPct} onChange={(e) => setRiskForm({ ...riskForm, riskPct: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Max Daily Loss (%)</label>
              <input className="inp" value={riskForm.dailyLossPct} onChange={(e) => setRiskForm({ ...riskForm, dailyLossPct: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Max Overall Drawdown (%)</label>
              <input className="inp" value={riskForm.maxDrawdownPct} onChange={(e) => setRiskForm({ ...riskForm, maxDrawdownPct: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Profit Target (%)</label>
              <input className="inp" value={riskForm.profitTargetPct} onChange={(e) => setRiskForm({ ...riskForm, profitTargetPct: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Max Open Positions</label>
              <input className="inp" value={riskForm.maxOpenTrades} onChange={(e) => setRiskForm({ ...riskForm, maxOpenTrades: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Max XAU Spread ($)</label>
              <input className="inp" value={riskForm.maxSpread} onChange={(e) => setRiskForm({ ...riskForm, maxSpread: e.target.value })} />
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              className="btn gold"
              disabled={busy}
              onClick={() =>
                void onAct("settings", {
                  riskPct: Number(riskForm.riskPct),
                  dailyLossPct: Number(riskForm.dailyLossPct),
                  maxDrawdownPct: Number(riskForm.maxDrawdownPct),
                  profitTargetPct: Number(riskForm.profitTargetPct),
                  maxOpenTrades: Number(riskForm.maxOpenTrades),
                  maxSpread: Number(riskForm.maxSpread),
                })
              }
            >
              Save Risk Guardrails
            </button>
            {st.killSwitch ? (
              <button className="btn green" disabled={busy} onClick={() => void onAct("resume")}>
                Release Emergency Kill Switch
              </button>
            ) : (
              <button className="btn red" disabled={busy} onClick={() => void onAct("killSwitch")}>
                Trigger Emergency Kill Switch
              </button>
            )}
          </div>
        </section>

        {/* Account Manager */}
        <section className="card">
          <div className="card-h">
            <h2>Multi-Account Portfolio & Sandbox Manager</h2>
            <button
              className="btn xs red"
              disabled={busy}
              onClick={() => void onAct("resetAccount")}
            >
              Reset Current Account
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {snap.accounts.map((acc) => {
              const isCurrent = acc.id === snap.state.id;
              return (
                <div
                  key={acc.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: isCurrent ? "var(--gold-dim)" : "var(--panel2)",
                    border: `1px solid ${isCurrent ? "var(--gold)" : "var(--line)"}`,
                  }}
                >
                  <div>
                    <strong>{acc.name}</strong> <span className="pill">{acc.badge}</span>
                    <div className="small muted">
                      Balance: ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Start ${acc.startingBalance.toLocaleString()})
                    </div>
                  </div>
                  <button
                    className={`btn xs ${isCurrent ? "gold" : ""}`}
                    disabled={busy || isCurrent}
                    onClick={() => void onAct("switchAccount", { accountId: acc.id })}
                  >
                    {isCurrent ? "Active" : "Switch"}
                  </button>
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: 11.5, color: "var(--gold2)", textTransform: "uppercase" }}>Create New Trading Account</h3>
          <div className="grid-2">
            <div className="form-row">
              <label>Account Label</label>
              <input className="inp" value={newAccName} onChange={(e) => setNewAccName(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Starting Capital ($)</label>
              <select className="inp" value={newAccBal} onChange={(e) => setNewAccBal(e.target.value)}>
                <option value="5000">$5,000</option>
                <option value="10000">$10,000</option>
                <option value="25000">$25,000</option>
                <option value="50000">$50,000</option>
                <option value="100000">$100,000</option>
                <option value="200000">$200,000</option>
              </select>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={newAccProp} onChange={(e) => setNewAccProp(e.target.checked)} />
            <span>Apply Prop-Firm Drawdown Rules (5% daily / 10% max DD)</span>
          </label>
          <button
            className="btn gold"
            disabled={busy}
            onClick={() =>
              void onAct("createAccount", {
                name: newAccName,
                startingBalance: Number(newAccBal),
                propFirm: newAccProp,
              })
            }
          >
            + Create & Open Account
          </button>
        </section>
      </div>

      {/* MetaTrader 5 Execution Bridge + Telegram */}
      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <div>
              <h2>MetaTrader 5 (MT5) Broker Execution Bridge</h2>
              <div className="small muted">
                Connects AurumDesk approvals to the client&apos;s own regulated MT5 terminal — funds never leave the client&apos;s broker
              </div>
            </div>
            <span className={`pill ${mt5Online ? "good" : "warn"}`}>
              {mt5Online ? "MT5 Connected" : "Awaiting MT5 EA"}
            </span>
          </div>

          <div className="kv-grid" style={{ marginBottom: 10 }}>
            <div className="kv">
              <div className="k">Bridge Endpoint</div>
              <div className="v" style={{ fontSize: 12 }}>POST /api/mt5</div>
            </div>
            <div className="kv">
              <div className="k">Broker / Server</div>
              <div className="v" style={{ fontSize: 12 }}>{br.brokerName || "Not connected yet"}</div>
            </div>
            <div className="kv">
              <div className="k">MT5 Login</div>
              <div className="v" style={{ fontSize: 12 }}>{br.accountLogin || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Queued Commands</div>
              <div className="v gold-txt" style={{ fontSize: 13 }}>
                {br.queuedCommands.filter((c) => !c.delivered).length} pending
              </div>
            </div>
          </div>

          <div className="form-row">
            <label>Private Bridge API Token (paste into AurumDesk_Bridge.mq5)</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="inp" readOnly value={br.token} />
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(br.token);
                  onToast("Bridge token copied to clipboard.");
                }}
              >
                Copy
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => void onAct("updateBridge", { regenerateToken: true })}
              >
                Rotate
              </button>
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 10 }}>
            <a className="btn gold" href="/mt5/AurumDesk_Bridge.mq5" download="AurumDesk_Bridge.mq5" style={{ textDecoration: "none" }}>
              Download AurumDesk_Bridge.mq5 (MT5 EA)
            </a>
            <button className="btn green" onClick={() => void simulateMt5Ping()}>
              Simulate MT5 Terminal Heartbeat
            </button>
          </div>

          <ol className="small muted" style={{ paddingLeft: 18, marginTop: 10 }}>
            <li>Open MetaTrader 5 → <strong>File → Open Data Folder → MQL5 → Experts</strong> and drop <code>AurumDesk_Bridge.mq5</code>.</li>
            <li>In MT5 <strong>Tools → Options → Expert Advisors</strong>, tick <em>Allow WebRequest for listed URL</em> and add your AurumDesk URL.</li>
            <li>Attach the EA to an <code>XAUUSD</code> chart and paste your Bridge Token above. Approved trades sync automatically.</li>
          </ol>
        </section>

        {/* Telegram & Immutable Audit Log */}
        <section className="card">
          <div className="card-h">
            <h2>Telegram Mobile Alerts & Audit Trail</h2>
            <span className={`pill ${snap.telegram.enabled ? "good" : ""}`}>
              {snap.telegram.enabled ? "Telegram Enabled" : "Optional"}
            </span>
          </div>

          <div className="grid-2">
            <div className="form-row">
              <label>Telegram Bot Token (@BotFather)</label>
              <input
                className="inp"
                type="password"
                placeholder={snap.telegram.hasBotToken ? "•••••••• (Saved)" : "123456:ABC-DEF..."}
                value={tgToken}
                onChange={(e) => setTgToken(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Telegram Chat ID</label>
              <input className="inp" placeholder="e.g. 987654321" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} />
            </div>
          </div>

          <div className="btn-row" style={{ marginBottom: 14 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void onAct("updateTelegram", {
                  botToken: tgToken || undefined,
                  chatId: tgChatId,
                  enabled: true,
                })
              }
            >
              Save Telegram Settings
            </button>
            <button className="btn gold" disabled={tgBusy} onClick={() => void sendTelegramTest()}>
              {tgBusy ? "Sending..." : "Send Live Test Alert"}
            </button>
          </div>

          <h3 style={{ fontSize: 11.5, color: "var(--gold2)", textTransform: "uppercase" }}>Immutable Governance Audit Log</h3>
          <div className="scroll-y" style={{ maxHeight: 195 }}>
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {snap.state.audit.slice(0, 30).map((a, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td style={{ fontWeight: 700 }}>{a.action}</td>
                    <td className="muted">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
