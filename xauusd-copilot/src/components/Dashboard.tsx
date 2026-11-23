"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnalyticsJournal from "./AnalyticsJournal";
import BacktestLab from "./BacktestLab";
import Blotter from "./Blotter";
import BrokerBridge from "./BrokerBridge";
import ClientHub from "./ClientHub";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import CopilotPanel from "./CopilotPanel";
import MarketIntel from "./MarketIntel";
import OrderTicket from "./OrderTicket";
import PriceChart, { type Level, type OverlayState } from "./PriceChart";
import StrategyStudio from "./StrategyStudio";
import { formatPrice, SYMBOL_SPECS } from "@/lib/symbols";
import type {
  Decision,
  GateResult,
  Message,
  Snapshot,
  SymbolCode,
  Timeframe,
  WorkspaceId,
} from "@/lib/types";

const TFS: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

const NAV_ITEMS: Array<{ id: WorkspaceId; short: string; icon: string }> = [
  { id: "terminal", short: "Terminal", icon: "◈" },
  { id: "copilot", short: "AI Desk", icon: "✦" },
  { id: "strategy", short: "Strategy", icon: "⚙" },
  { id: "backtest", short: "Backtest", icon: "◫" },
  { id: "analytics", short: "Revenue", icon: "▤" },
  { id: "intel", short: "News/FX", icon: "🌐" },
  { id: "hub", short: "Client Hub", icon: "◉" },
  { id: "bridge", short: "MT5/Risk", icon: "⚡" },
];

const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Dashboard() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("terminal");
  const [symbol, setSymbol] = useState<SymbolCode>("XAUUSD");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [overlays, setOverlays] = useState<OverlayState>({
    ema20: true,
    ema50: true,
    ema200: false,
    bollinger: false,
    srLevels: true,
    volume: true,
    rsiPane: true,
  });

  const load = useCallback(async (sym: SymbolCode, interval: Timeframe) => {
    try {
      const r = await fetch(`/api/snapshot?symbol=${sym}&tf=${interval}`, { cache: "no-store" });
      if (r.ok) setSnap((await r.json()) as Snapshot);
    } catch {
      /* retain last snapshot */
    }
  }, []);

  useEffect(() => {
    void load(symbol, tf);
    const id = window.setInterval(() => void load(symbol, tf), 8000);
    return () => window.clearInterval(id);
  }, [symbol, tf, load]);

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, tf, symbol }),
      });
      const data = (await r.json()) as { snapshot?: Snapshot; message?: string; error?: string };
      if (data.snapshot) setSnap(data.snapshot);
      if (data.message || data.error) setToast(data.message ?? data.error ?? "");
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, tf, symbol }),
      });
      const data = (await r.json()) as { snapshot?: Snapshot; error?: string };
      if (data.snapshot) setSnap(data.snapshot);
      if (data.error) setToast(data.error);
    } finally {
      setBusy(false);
    }
  };

  // ---- Desktop alerts (opt-in): new signals, risk guard events, fills, price alerts ----
  const [alertsOn, setAlertsOn] = useState(false);
  const seen = useRef<{ acct: string; msgId: string; propId: string } | null>(null);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && window.localStorage.getItem("aurum.alerts") === "1") {
      setAlertsOn(true);
    }
  }, []);

  const toggleAlerts = async () => {
    if (alertsOn) {
      setAlertsOn(false);
      window.localStorage.setItem("aurum.alerts", "0");
      setToast("Desktop alerts turned off.");
      return;
    }
    if (typeof Notification === "undefined") {
      setToast("This browser does not support desktop notifications.");
      return;
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") {
      setAlertsOn(true);
      window.localStorage.setItem("aurum.alerts", "1");
      setToast("Desktop alerts on — you'll be notified of signals, fills and risk events.");
    } else {
      setToast("Notification permission was not granted.");
    }
  };

  useEffect(() => {
    if (!snap) return;
    const acct = snap.state.id;
    const msgs = snap.state.messages;
    const propId = snap.state.proposal?.id ?? "";
    const prev = seen.current;
    seen.current = { acct, msgId: msgs[0]?.id ?? "", propId };
    if (!alertsOn || !prev || prev.acct !== acct || typeof Notification === "undefined" || Notification.permission !== "granted") return;

    const notable = new Set(["BUY_ALERT", "SELL_ALERT", "RISK_GUARD", "TRADE_OPENED", "TRADE_CLOSED", "PRICE_ALERT"]);
    const fresh: Message[] = [];
    for (const m of msgs) {
      if (m.id === prev.msgId) break;
      if (notable.has(m.kind)) fresh.push(m);
    }
    for (const m of fresh.slice(0, 3).reverse()) {
      new Notification(`AurumDesk · ${m.kind.replace(/_/g, " ")}`, { body: m.text.slice(0, 180) });
    }
    if (propId && propId !== prev.propId) {
      new Notification("AurumDesk · Approval needed", { body: "A trade proposal is waiting for your decision (expires in 5 min)." });
    }
    if (fresh.length || (propId && propId !== prev.propId)) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } catch {
        /* audio blocked until user gesture */
      }
    }
  }, [snap, alertsOn]);

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const cmds: PaletteCommand[] = NAV_ITEMS.map((n) => ({
      id: `go-${n.id}`,
      label: `Go to ${n.short}`,
      hint: "workspace",
      run: () => setWorkspace(n.id),
    }));
    for (const sym of Object.keys(SYMBOL_SPECS) as SymbolCode[]) {
      cmds.push({ id: `sym-${sym}`, label: `Chart ${sym} (${SYMBOL_SPECS[sym].shortName})`, hint: "symbol", run: () => { setSymbol(sym); setWorkspace("terminal"); } });
    }
    for (const t of TFS) cmds.push({ id: `tf-${t}`, label: `Timeframe ${t.toUpperCase()}`, hint: "chart", run: () => setTf(t) });
    cmds.push(
      { id: "act-sim-buy", label: "Simulate BUY setup", hint: "demo", run: () => void act("simulateSetup", { symbol, side: "BUY" }) },
      { id: "act-sim-sell", label: "Simulate SELL setup", hint: "demo", run: () => void act("simulateSetup", { symbol, side: "SELL" }) },
      { id: "act-mode-signal", label: "Mode: Signal only", hint: "autonomy", run: () => void act("mode", { mode: "signal" }) },
      { id: "act-mode-semi", label: "Mode: Semi-auto (approval)", hint: "autonomy", run: () => void act("mode", { mode: "semi" }) },
      { id: "act-mode-auto", label: "Mode: Auto within limits", hint: "autonomy", run: () => void act("mode", { mode: "auto" }) },
      { id: "act-pause", label: "Pause trading", hint: "safety", run: () => void act("pause") },
      { id: "act-resume-trading", label: "Resume trading", hint: "safety", run: () => void act("resumeTrading") },
      { id: "act-kill", label: "EMERGENCY KILL SWITCH", hint: "safety", run: () => void act("killSwitch") },
      { id: "act-alerts", label: alertsOn ? "Turn desktop alerts off" : "Turn desktop alerts on", hint: "notifications", run: () => void toggleAlerts() },
    );
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, alertsOn, busy, tf]);

  const selectSymbol = (sym: SymbolCode) => {
    setSymbol(sym);
    if (workspace !== "terminal") setWorkspace("terminal");
  };

  const tradeAndPlanLevels: Level[] = useMemo(() => {
    if (!snap) return [];
    const out: Level[] = [];
    for (const t of snap.state.trades) {
      if (t.status !== "open" || t.symbol !== symbol) continue;
      out.push({ price: t.entry, color: "#f8fafc", title: `${t.side} ${t.lots}L` });
      out.push({ price: t.stopLoss, color: "#ef4444", title: t.breakEvenMoved ? "SL (BE)" : "SL" });
      if (t.tp1Price && !t.tp1Hit) out.push({ price: t.tp1Price, color: "#38bdf8", title: "TP1 (50%)", dashed: true });
      out.push({ price: t.takeProfit, color: "#22c55e", title: "TP" });
    }
    for (const po of snap.state.pendingOrders) {
      if (po.symbol !== symbol) continue;
      out.push({ price: po.triggerPrice, color: "#f59e0b", title: po.orderType.replace("_", " "), dashed: true });
    }
    const prop = snap.state.proposal;
    if (prop && prop.symbol === symbol) {
      out.push({ price: prop.plan.entry, color: "#f3ca62", title: `Proposal ${prop.plan.side}`, dashed: true });
      out.push({ price: prop.plan.stopLoss, color: "#ef4444", title: "Prop SL", dashed: true });
      out.push({ price: prop.plan.takeProfit, color: "#22c55e", title: "Prop TP", dashed: true });
    } else if (snap.decision?.plan && snap.decision.symbol === symbol) {
      const p = snap.decision.plan;
      out.push({ price: p.entry, color: "#d4a72c", title: `Plan ${p.side}`, dashed: true });
      out.push({ price: p.stopLoss, color: "#b91c1c", title: "Plan SL", dashed: true });
      out.push({ price: p.takeProfit, color: "#15803d", title: "Plan TP", dashed: true });
    }
    return out;
  }, [snap, symbol]);

  const srLevels: Level[] = useMemo(() => {
    const ind = snap?.decision?.indicators;
    if (!ind) return [];
    const out: Level[] = [];
    if (ind.pdh) out.push({ price: ind.pdh, color: "rgba(245, 158, 11, 0.7)", title: "PDH", dashed: true });
    if (ind.pdl) out.push({ price: ind.pdl, color: "rgba(245, 158, 11, 0.7)", title: "PDL", dashed: true });
    for (const s of ind.supportLevels.slice(0, 2)) {
      out.push({ price: s, color: "rgba(34, 197, 94, 0.45)", title: "Support", dashed: true });
    }
    for (const r of ind.resistanceLevels.slice(0, 2)) {
      out.push({ price: r, color: "rgba(239, 68, 68, 0.45)", title: "Resistance", dashed: true });
    }
    return out;
  }, [snap?.decision?.indicators]);

  if (!snap) {
    return (
      <div className="loading-screen">
        <div className="logo-badge">Au</div>
        <div style={{ fontWeight: 700, color: "var(--gold2)" }}>Initializing AurumDesk Pro Terminal...</div>
        <div className="small muted">Connecting multi-symbol MT5 feeds, 8-gate risk engine & AI copilot</div>
      </div>
    );
  }

  const q = snap.quote;
  const d = snap.decision;
  const s = snap.state;
  const st = s.settings;
  const openCount = s.trades.filter((t) => t.status === "open").length;
  const showSideCopilot = drawerOpen && workspace !== "copilot";

  return (
    <div className="shell">
      <CommandPalette commands={paletteCommands} />
      {/* Left Navigation Rail */}
      <nav className="rail">
        <div className="logo-badge" title="AurumDesk Pro">Au</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-btn ${workspace === item.id ? "active" : ""}`}
            onClick={() => setWorkspace(item.id)}
          >
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            <span>{item.short}</span>
          </button>
        ))}
      </nav>

      <div className="main-wrap">
        {/* Global Top Command Header */}
        <header className="cmdbar">
          <div className="cmd-left">
            <div className="ticker-hero">
              <span className="ticker-sym">{symbol}</span>
              <span className="ticker-price">{q ? formatPrice(symbol, q.mid) : "--"}</span>
              {q && (
                <span className="ticker-meta">
                  <span className={q.dayChangePct >= 0 ? "pos" : "neg"} style={{ fontWeight: 700 }}>
                    {q.dayChangePct >= 0 ? "+" : ""}
                    {q.dayChangePct.toFixed(2)}%
                  </span>{" "}
                  · Sprd {formatPrice(symbol, q.spread)}
                </span>
              )}
            </div>

            <select
              className="acct-select"
              value={s.id}
              onChange={(e) => void act("switchAccount", { accountId: e.target.value })}
              title="Switch active account"
            >
              {snap.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (${a.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                </option>
              ))}
            </select>

            <div className="kpi-strip">
              <div className="kpi-mini">
                <div className="lbl">Equity</div>
                <div className="val">${snap.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="kpi-mini">
                <div className="lbl">Open P&L</div>
                <div className={`val ${snap.stats.openFloating >= 0 ? "pos" : "neg"}`}>
                  {money(snap.stats.openFloating)}
                </div>
              </div>
              <div className="kpi-mini">
                <div className="lbl">Net Revenue</div>
                <div className={`val ${snap.stats.netPnl >= 0 ? "pos" : "neg"}`}>
                  {money(snap.stats.netPnl)}
                </div>
              </div>
              <div className="kpi-mini">
                <div className="lbl">Win Rate</div>
                <div className="val gold-txt">{snap.stats.winRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          <div className="cmd-right">
            <button
              type="button"
              className="btn amber"
              disabled={busy}
              title="Generate a realistic live BUY proposal at current price to demonstrate approval & live execution"
              onClick={() => void act("simulateSetup", { symbol, side: "BUY" })}
            >
              Simulate Buy Setup
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              title="Generate a realistic live SELL proposal at current price"
              onClick={() => void act("simulateSetup", { symbol, side: "SELL" })}
            >
              Simulate Sell
            </button>

            <button
              type="button"
              className={`btn ${alertsOn ? "active" : ""}`}
              title="Desktop notifications + sound for signals, fills and risk events (Ctrl+K opens the command palette)"
              onClick={() => void toggleAlerts()}
            >
              {alertsOn ? "🔔 Alerts On" : "🔕 Alerts"}
            </button>

            <span className="pill">{st.mode.toUpperCase()}</span>
            <span className={`pill ${st.direction === "paused" ? "warn" : "good"}`}>
              {st.direction === "both" ? "BOTH" : st.direction.toUpperCase()}
            </span>

            {st.killSwitch ? (
              <button className="btn green" disabled={busy} onClick={() => void act("resume")}>
                Release Kill Switch
              </button>
            ) : (
              <button className="btn red" disabled={busy} onClick={() => void act("killSwitch")}>
                Kill Switch
              </button>
            )}

            {workspace !== "copilot" && (
              <button
                type="button"
                className={`btn ${drawerOpen ? "active" : ""}`}
                onClick={() => setDrawerOpen((v) => !v)}
              >
                {drawerOpen ? "Hide AI Drawer" : "Open AI Copilot"}
              </button>
            )}
          </div>
        </header>

        {snap.error && <div className="banner">{snap.error}</div>}
        {toast && (
          <div className="toast-bar" onClick={() => setToast("")}>
            <span>{toast}</span>
            <span className="small muted">Click to dismiss ✕</span>
          </div>
        )}

        <div className={`workspace-area ${showSideCopilot ? "" : "drawer-closed"}`}>
          <main style={{ minWidth: 0 }}>
            {workspace === "terminal" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Pending Approval Banner right at top of Terminal when active */}
                {s.proposal && (
                  <div className="proposal-banner">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: "var(--gold2)" }}>
                          ACTIONABLE PROPOSAL READY · {s.proposal.symbol} {s.proposal.plan.side} {s.proposal.plan.lots.toFixed(2)} Lots @{" "}
                          {formatPrice(s.proposal.symbol, s.proposal.plan.entry)}
                        </div>
                        <div className="small muted" style={{ marginTop: 2 }}>
                          SL {formatPrice(s.proposal.symbol, s.proposal.plan.stopLoss)} ·{" "}
                          {s.proposal.plan.tp1Price ? `TP1 ${formatPrice(s.proposal.symbol, s.proposal.plan.tp1Price)} (50% + BE) · ` : ""}
                          TP {formatPrice(s.proposal.symbol, s.proposal.plan.takeProfit)} ({s.proposal.plan.rewardRatio}R) · Max Risk $
                          {s.proposal.plan.riskAmount.toFixed(2)} ({st.riskPct}%) · {s.proposal.reason}
                        </div>
                      </div>
                      <div className="btn-row">
                        <button className="btn green" disabled={busy} onClick={() => void act("approve")}>
                          Approve & Execute ({s.proposal.plan.lots.toFixed(2)}L)
                        </button>
                        <button className="btn amber" disabled={busy} onClick={() => void act("approveHalf")}>
                          Approve Half Risk
                        </button>
                        <button className="btn red" disabled={busy} onClick={() => void act("reject")}>
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="desk-grid">
                  {/* Left Column: Live Multi-Symbol Watchlist + Live Alerts Feed */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <section className="card">
                      <div className="card-h">
                        <h2>Market Watchlist</h2>
                        <span className="small muted">Live MT5 Feeds</span>
                      </div>
                      <div className="wl-list">
                        {snap.watchlist.map((w) => {
                          const active = w.symbol === symbol;
                          return (
                            <div
                              key={w.symbol}
                              className={`wl-item ${active ? "active" : ""}`}
                              onClick={() => setSymbol(w.symbol)}
                            >
                              <div>
                                <div style={{ fontWeight: 800 }}>{w.symbol}</div>
                                <div className="small muted">{SYMBOL_SPECS[w.symbol].shortName}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontWeight: 800, color: active ? "var(--gold2)" : "var(--text)" }}>
                                  {formatPrice(w.symbol, w.mid)}
                                </div>
                                <div className={`small ${w.dayChangePct >= 0 ? "pos" : "neg"}`}>
                                  {w.dayChangePct >= 0 ? "+" : ""}
                                  {w.dayChangePct.toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <FeedCard messages={s.messages} />
                  </div>

                  {/* Center Column: Pro Chart + Overlays + 8-Gate Decision Engine */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <section className="card">
                      <div className="card-h">
                        <div className="btn-row">
                          <h2>{symbol} · {SYMBOL_SPECS[symbol].name}</h2>
                          {TFS.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`btn xs ${tf === t ? "active" : ""}`}
                              onClick={() => setTf(t)}
                            >
                              {t.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <div className="btn-row">
                          {(
                            [
                              ["ema20", "EMA20"],
                              ["ema50", "EMA50"],
                              ["ema200", "EMA200"],
                              ["bollinger", "BB"],
                              ["srLevels", "S/R & PDH"],
                              ["rsiPane", "RSI"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              className={`btn xs ${overlays[key] ? "active" : ""}`}
                              onClick={() => setOverlays((p) => ({ ...p, [key]: !p[key] }))}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <PriceChart
                        key={`${symbol}:${tf}`}
                        bars={snap.chartBars}
                        levels={tradeAndPlanLevels}
                        srLevels={srLevels}
                        overlays={overlays}
                        decimals={SYMBOL_SPECS[symbol].decimals}
                      />
                    </section>

                    <EightGateCard decision={d} onOpenStudio={() => setWorkspace("strategy")} />
                  </div>

                  {/* Right Desk Column: Full Order Ticket */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <OrderTicket
                      symbol={symbol}
                      quote={q}
                      decision={d}
                      balance={s.balance}
                      openCount={openCount}
                      settings={st}
                      strategy={s.strategy}
                      busy={busy}
                      onAct={act}
                    />
                  </div>
                </div>

                {/* Full-Width Multi-Tab Blotter */}
                <Blotter snap={snap} busy={busy} onAct={act} onSelectSymbol={selectSymbol} />
              </div>
            )}

            {workspace === "copilot" && (
              <CopilotPanel
                snap={snap}
                busy={busy}
                fullScreen
                onSend={sendChat}
                onAct={act}
                onSelectSymbol={selectSymbol}
              />
            )}

            {workspace === "strategy" && <StrategyStudio snap={snap} busy={busy} onAct={act} />}

            {workspace === "backtest" && <BacktestLab snap={snap} />}

            {workspace === "analytics" && <AnalyticsJournal snap={snap} busy={busy} onAct={act} />}

            {workspace === "intel" && <MarketIntel snap={snap} onSelectSymbol={selectSymbol} />}

            {workspace === "hub" && <ClientHub snap={snap} busy={busy} onAct={act} />}

            {workspace === "bridge" && (
              <BrokerBridge
                snap={snap}
                busy={busy}
                onAct={act}
                onRefresh={() => load(symbol, tf)}
                onToast={setToast}
              />
            )}
          </main>

          {/* Persistent Docked AI Copilot Drawer */}
          {showSideCopilot && (
            <aside>
              <CopilotPanel
                snap={snap}
                busy={busy}
                onSend={sendChat}
                onAct={act}
                onSelectSymbol={selectSymbol}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function EightGateCard({
  decision,
  onOpenStudio,
}: {
  decision: Decision | null;
  onOpenStudio: () => void;
}) {
  if (!decision) {
    return (
      <section className="card">
        <h2>8-Gate Signal & Risk Verdict</h2>
        <div className="muted">Waiting for live multi-timeframe bars...</div>
      </section>
    );
  }

  const verdictColor =
    decision.verdict === "BUY" ? "var(--green)" : decision.verdict === "SELL" ? "var(--red)" : "var(--amber)";

  return (
    <section className="card">
      <div className="card-h">
        <div>
          <h2>
            8-Gate Recommendation Engine · {decision.symbol} ({decision.strategyName})
          </h2>
          <div className="small muted">
            ATR(14): {formatPrice(decision.symbol, decision.atr)} · 15m RSI: {decision.rsi.toFixed(1)} ·{" "}
            {decision.sessionName}
            {decision.indicators.candlePattern ? ` · Pattern: ${decision.indicators.candlePattern}` : ""}
          </div>
        </div>
        <div className="btn-row">
          <span className="pill gold">Score {decision.score}/100</span>
          <button className="btn xs" onClick={onOpenStudio}>
            Tune Rules
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "8px 11px",
          borderRadius: 9,
          background: "var(--panel2)",
          border: `1px solid ${verdictColor}`,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: verdictColor }}>
            {decision.verdict === "DO NOT TRADE" ? "DO NOT PURCHASE / WAIT" : `${decision.verdict} SIGNAL ACTIVE`}
          </div>
          <div className="small muted">
            {decision.verdict === "DO NOT TRADE"
              ? "Capital protection active: one or more safety/structure gates below have not aligned yet."
              : "All 8 institutional gates aligned. Review exact Entry, Stop Loss, and R:R plan."}
          </div>
        </div>
        <div style={{ minWidth: 160 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>Confluence Score ({decision.score}%)</div>
          <div className="prog-track">
            <div
              className="prog-fill"
              style={{
                width: `${decision.score}%`,
                background: "linear-gradient(90deg, var(--red), var(--amber), var(--green))",
              }}
            />
          </div>
        </div>
      </div>

      <div className="gates-compact">
        {decision.gates.map((g: GateResult) => (
          <div key={g.id} className={`gate-box ${g.pass ? "pass" : "fail"}`}>
            <span className={`pill ${g.pass ? "good" : "bad"}`}>{g.pass ? "PASS" : "WAIT"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>
                {g.id}. {g.name}
              </div>
              <div className="small muted">{g.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedCard({ messages }: { messages: Message[] }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>Recommendation Feed</h2>
        <span className="small muted">{messages.length} alerts</span>
      </div>
      <div className="scroll-y" style={{ maxHeight: 285, display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.slice(0, 20).map((m) => (
          <div
            key={m.id}
            style={{
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              borderLeft: `3px solid ${
                m.kind === "BUY_ALERT" || m.kind === "TRADE_OPENED"
                  ? "var(--green)"
                  : m.kind === "SELL_ALERT" || m.kind === "RISK_GUARD"
                    ? "var(--red)"
                    : m.kind === "PRICE_ALERT" || m.kind === "BRIEFING"
                      ? "var(--gold2)"
                      : "var(--amber)"
              }`,
              borderRadius: 7,
              padding: "7px 9px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="muted">
              <strong style={{ color: "var(--gold2)" }}>{m.kind.replace("_", " ")}</strong>
              <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="small" style={{ marginTop: 3 }}>{m.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
