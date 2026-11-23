"use client";

import { useMemo, useState } from "react";
import { formatPrice, pnlForLots, SYMBOLS } from "@/lib/symbols";
import type { Quote, Snapshot, SymbolCode, Trade } from "@/lib/types";

const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Blotter({
  snap,
  busy,
  onAct,
  onSelectSymbol,
}: {
  snap: Snapshot;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onSelectSymbol: (sym: SymbolCode) => void;
}) {
  const s = snap.state;
  const openTrades = s.trades.filter((t) => t.status === "open");
  const closedTrades = s.trades.filter((t) => t.status === "closed");

  const [tab, setTab] = useState<"open" | "pending" | "history" | "blocked" | "alerts">("open");
  const [histFilter, setHistFilter] = useState<"all" | "wins" | "losses">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSl, setEditSl] = useState("");
  const [editTp, setEditTp] = useState("");
  const [editTrail, setEditTrail] = useState("");

  const [alertSym, setAlertSym] = useState<SymbolCode>(snap.symbol);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertNote, setAlertNote] = useState("");

  const quotesMap = useMemo(() => {
    const m = new Map<SymbolCode, Quote>(snap.watchlist.map((w) => [w.symbol, w]));
    if (snap.quote) m.set(snap.quote.symbol, snap.quote);
    return m;
  }, [snap.watchlist, snap.quote]);

  const filteredClosed = useMemo(() => {
    return closedTrades.filter((t) => {
      if (histFilter === "wins") return t.pnl > 0;
      if (histFilter === "losses") return t.pnl < 0;
      return true;
    });
  }, [closedTrades, histFilter]);

  const totalSavedUsd = useMemo(
    () => s.blockedSignals.reduce((a, b) => a + b.savedRiskUsd, 0),
    [s.blockedSignals],
  );

  const exportCsv = () => {
    const header = "Opened,Closed,Symbol,Side,Lots,Entry,StopLoss,TakeProfit,Exit,NetUSD,R,Reason,CloseReason\n";
    const rows = closedTrades
      .map((t) =>
        [
          t.openedAt,
          t.closedAt ?? "",
          t.symbol,
          t.side,
          t.initialLots,
          t.entry,
          t.stopLoss,
          t.takeProfit,
          t.exitPrice ?? "",
          t.pnl,
          t.rMultiple,
          `"${(t.reason || "").replace(/"/g, '""')}"`,
          `"${(t.closeReason || "").replace(/"/g, '""')}"`,
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AurumDesk_${s.id}_trades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const beginEdit = (t: Trade) => {
    setEditingId(t.id);
    setEditSl(String(t.stopLoss));
    setEditTp(String(t.takeProfit));
    setEditTrail(t.trailingDistance ? String(t.trailingDistance) : "");
  };

  return (
    <section className="card">
      <div className="card-h">
        <div className="btn-row">
          <button className={`btn xs ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}>
            Open Positions ({openTrades.length})
          </button>
          <button className={`btn xs ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
            Pending Orders ({s.pendingOrders.length})
          </button>
          <button className={`btn xs ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            Closed History ({closedTrades.length})
          </button>
          <button className={`btn xs ${tab === "blocked" ? "active" : ""}`} onClick={() => setTab("blocked")}>
            Blocked by Risk Guard ({s.blockedSignals.length})
          </button>
          <button className={`btn xs ${tab === "alerts" ? "active" : ""}`} onClick={() => setTab("alerts")}>
            Price Alerts ({s.priceAlerts.filter((a) => a.active).length})
          </button>
        </div>

        <div className="btn-row">
          {tab === "open" && openTrades.length > 0 && (
            <button className="btn xs red" disabled={busy} onClick={() => void onAct("closeAll")}>
              Flatten All ({openTrades.length})
            </button>
          )}
          {tab === "history" && closedTrades.length > 0 && (
            <>
              {(["all", "wins", "losses"] as const).map((f) => (
                <button key={f} className={`btn xs ${histFilter === f ? "active" : ""}`} onClick={() => setHistFilter(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
              <button className="btn xs gold" onClick={exportCsv}>
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {tab === "open" && (
        <div className="scroll-x">
          {openTrades.length === 0 ? (
            <div className="muted" style={{ padding: "12px 4px" }}>
              No open positions right now. Use the <strong>Order Ticket</strong> on the right or click{" "}
              <strong>Simulate Setup</strong> in the top bar to test live execution, Break-Even, and Partial 50% Take-Profit.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Lots</th>
                  <th>Entry</th>
                  <th>Live</th>
                  <th>SL / TP</th>
                  <th>Floating P&L</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((t) => {
                  const lq = quotesMap.get(t.symbol);
                  const mark = lq ? (t.side === "BUY" ? lq.bid : lq.ask) : t.entry;
                  const floatUsd = pnlForLots(t.symbol, t.side, t.entry, mark, t.lots);
                  const rLive = t.riskAmount > 0 ? floatUsd / t.riskAmount : 0;
                  return (
                    <tr key={t.id}>
                      <td>
                        <button className="btn xs" onClick={() => onSelectSymbol(t.symbol)}>
                          {t.symbol}
                        </button>
                      </td>
                      <td className={t.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 800 }}>
                        {t.side}
                      </td>
                      <td>
                        {t.lots.toFixed(2)}
                        {t.tp1Hit && <span className="pill good" style={{ marginLeft: 4 }}>TP1 Hit</span>}
                      </td>
                      <td>{formatPrice(t.symbol, t.entry)}</td>
                      <td>{formatPrice(t.symbol, mark)}</td>
                      <td>
                        {editingId === t.id ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input className="inp" style={{ width: 82, padding: "3px 5px" }} value={editSl} onChange={(e) => setEditSl(e.target.value)} placeholder="SL" />
                            <input className="inp" style={{ width: 82, padding: "3px 5px" }} value={editTp} onChange={(e) => setEditTp(e.target.value)} placeholder="TP" />
                            <input className="inp" style={{ width: 58, padding: "3px 5px" }} value={editTrail} onChange={(e) => setEditTrail(e.target.value)} placeholder="Trail" />
                            <button
                              className="btn xs green"
                              disabled={busy}
                              onClick={() => {
                                void onAct("modifyTrade", {
                                  tradeId: t.id,
                                  stopLoss: Number(editSl),
                                  takeProfit: Number(editTp),
                                  trailingDistance: editTrail ? Number(editTrail) : null,
                                });
                                setEditingId(null);
                              }}
                            >
                              Save
                            </button>
                            <button className="btn xs" onClick={() => setEditingId(null)}>
                              X
                            </button>
                          </div>
                        ) : (
                          <span>
                            <span className="neg">{formatPrice(t.symbol, t.stopLoss)}</span> /{" "}
                            <span className="pos">{formatPrice(t.symbol, t.takeProfit)}</span>
                            {t.breakEvenMoved && <span className="pill gold" style={{ marginLeft: 5 }}>BE</span>}
                            {t.trailingDistance && <span className="pill warn" style={{ marginLeft: 4 }}>Trail {t.trailingDistance}</span>}
                          </span>
                        )}
                      </td>
                      <td className={floatUsd >= 0 ? "pos" : "neg"} style={{ fontWeight: 800 }}>
                        {money(floatUsd)} ({rLive >= 0 ? "+" : ""}
                        {rLive.toFixed(2)}R)
                        {t.realizedPartialPnl !== 0 && (
                          <div className="small muted">Banked: {money(t.realizedPartialPnl)}</div>
                        )}
                      </td>
                      <td>
                        <div className="btn-row">
                          <button className="btn xs" disabled={busy} onClick={() => beginEdit(t)}>
                            SL/TP
                          </button>
                          <button
                            className="btn xs amber"
                            disabled={busy}
                            title="Lock Stop Loss at Entry + 1 pip"
                            onClick={() => void onAct("breakEven", { tradeId: t.id })}
                          >
                            Break-Even
                          </button>
                          <button
                            className="btn xs green"
                            disabled={busy || t.lots < 0.02}
                            onClick={() => void onAct("partialClose", { tradeId: t.id })}
                          >
                            Close 50%
                          </button>
                          <button
                            className="btn xs red"
                            disabled={busy}
                            onClick={() => void onAct("closeTrade", { tradeId: t.id })}
                          >
                            Close
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "pending" && (
        <div className="scroll-x">
          {s.pendingOrders.length === 0 ? (
            <div className="muted" style={{ padding: "12px 4px" }}>
              No pending Limit or Stop orders. Select <strong>Buy Limit / Sell Limit / Buy Stop / Sell Stop</strong> in the Order Ticket to queue automatic triggers.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Lots</th>
                  <th>Trigger</th>
                  <th>SL / TP</th>
                  <th>Risk</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {s.pendingOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="muted">{fmtTime(o.createdAt)}</td>
                    <td>{o.symbol}</td>
                    <td className={o.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 700 }}>
                      {o.orderType.replace("_", " ")}
                    </td>
                    <td>{o.lots.toFixed(2)}</td>
                    <td className="gold-txt">{formatPrice(o.symbol, o.triggerPrice)}</td>
                    <td className="muted">
                      {formatPrice(o.symbol, o.stopLoss)} / {formatPrice(o.symbol, o.takeProfit)}
                    </td>
                    <td>${o.riskAmount.toFixed(2)}</td>
                    <td>
                      <button
                        className="btn xs red"
                        disabled={busy}
                        onClick={() => void onAct("cancelPending", { orderId: o.id })}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="scroll-x scroll-y">
          {filteredClosed.length === 0 ? (
            <div className="muted" style={{ padding: "12px 4px" }}>
              No closed trades match this filter.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Lots</th>
                  <th>Entry → Exit</th>
                  <th>Outcome</th>
                  <th>Net P&L</th>
                  <th>R</th>
                  <th>Source / Tags</th>
                </tr>
              </thead>
              <tbody>
                {filteredClosed.slice(0, 40).map((t) => (
                  <tr key={t.id} title={t.reason}>
                    <td className="muted">{fmtTime(t.closedAt ?? t.openedAt)}</td>
                    <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                    <td className={t.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 700 }}>{t.side}</td>
                    <td>{t.initialLots.toFixed(2)}</td>
                    <td>
                      {formatPrice(t.symbol, t.entry)} → {formatPrice(t.symbol, t.exitPrice)}
                    </td>
                    <td className="muted">{t.closeReason}</td>
                    <td className={t.pnl >= 0 ? "pos" : "neg"} style={{ fontWeight: 800 }}>
                      {money(t.pnl)}
                    </td>
                    <td className={t.rMultiple >= 0 ? "pos" : "neg"}>
                      {t.rMultiple >= 0 ? "+" : ""}
                      {t.rMultiple.toFixed(2)}R
                    </td>
                    <td>
                      <span className="pill" style={{ marginRight: 4 }}>{t.approvedBy}</span>
                      {t.tags.slice(0, 2).map((tg) => (
                        <span key={tg} className="pill gold" style={{ marginRight: 3 }}>
                          {tg}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "blocked" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="small muted">
              Dangerous or low-quality entries automatically vetoed before risking capital
            </span>
            <span className="pill good">Estimated Risk Protected: ${totalSavedUsd.toLocaleString()}</span>
          </div>
          <div className="scroll-y">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Symbol</th>
                  <th>Bias</th>
                  <th>Gate Score</th>
                  <th>Blocking Guardrails</th>
                  <th>Risk Protected</th>
                </tr>
              </thead>
              <tbody>
                {s.blockedSignals.map((b) => (
                  <tr key={b.id}>
                    <td className="muted">{fmtTime(b.at)}</td>
                    <td style={{ fontWeight: 700 }}>{b.symbol}</td>
                    <td>{b.intendedSide}</td>
                    <td>{b.score}/100</td>
                    <td className="muted">{b.summary}</td>
                    <td className="pos">${b.savedRiskUsd.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "alerts" && (
        <div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <select className="inp" style={{ width: 120 }} value={alertSym} onChange={(e) => setAlertSym(e.target.value as SymbolCode)}>
              {SYMBOLS.map((sym) => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
            <input
              className="inp"
              style={{ width: 140 }}
              placeholder="Target price (e.g. 3645)"
              value={alertPrice}
              onChange={(e) => setAlertPrice(e.target.value)}
            />
            <input
              className="inp"
              style={{ width: 240 }}
              placeholder="Alert note (e.g. Breakout level)"
              value={alertNote}
              onChange={(e) => setAlertNote(e.target.value)}
            />
            <button
              className="btn gold"
              disabled={busy || !alertPrice}
              onClick={() => {
                void onAct("addAlert", { symbol: alertSym, targetPrice: Number(alertPrice), note: alertNote });
                setAlertPrice("");
                setAlertNote("");
              }}
            >
              + Create Price Alert
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Condition</th>
                <th>Target Price</th>
                <th>Note</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {s.priceAlerts.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>{a.symbol}</td>
                  <td>Crosses {a.condition}</td>
                  <td className="gold-txt">{formatPrice(a.symbol, a.targetPrice)}</td>
                  <td className="muted">{a.note}</td>
                  <td>
                    {a.active ? (
                      <span className="pill good">Armed</span>
                    ) : (
                      <span className="pill warn">Triggered {a.triggeredAt ? fmtTime(a.triggeredAt) : ""}</span>
                    )}
                  </td>
                  <td>
                    <button className="btn xs red" disabled={busy} onClick={() => void onAct("deleteAlert", { alertId: a.id })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {s.priceAlerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No price alerts configured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
