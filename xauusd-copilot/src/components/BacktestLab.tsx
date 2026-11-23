"use client";

import { useCallback, useEffect, useState } from "react";
import type { BacktestResult } from "@/lib/backtest";
import { STRATEGY_PRESETS } from "@/lib/seed";
import { formatPrice, SYMBOLS, SYMBOL_SPECS } from "@/lib/symbols";
import type { Snapshot, StrategyId, SymbolCode, Timeframe } from "@/lib/types";

export default function BacktestLab({ snap }: { snap: Snapshot }) {
  const [symbol, setSymbol] = useState<SymbolCode>(snap.symbol);
  const [tf, setTf] = useState<Timeframe>("1d");
  const [strategyId, setStrategyId] = useState<StrategyId>(snap.state.strategy.activeStrategy);
  const [riskPct, setRiskPct] = useState(String(snap.state.settings.riskPct));
  const [rr, setRr] = useState(String(snap.state.strategy.rewardRatio));
  const [spread, setSpread] = useState(
    String(Number((SYMBOL_SPECS[snap.symbol].defaultMaxSpread * 0.65).toFixed(SYMBOL_SPECS[snap.symbol].decimals))),
  );
  const [slippage, setSlippage] = useState(
    String(Number((SYMBOL_SPECS[snap.symbol].pipSize * 0.5).toFixed(SYMBOL_SPECS[snap.symbol].decimals))),
  );
  const [partialTp, setPartialTp] = useState(snap.state.strategy.partialTpEnabled);
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const qs = new URLSearchParams({
        symbol,
        tf,
        strategyId,
        riskPct,
        rr,
        spread,
        slippage,
        partialTp: String(partialTp),
      });
      const r = await fetch(`/api/backtest?${qs.toString()}`, { cache: "no-store" });
      const data = (await r.json()) as BacktestResult & { error?: string };
      if (!r.ok || data.error) setErr(data.error ?? "Backtest failed");
      else setBt(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [symbol, tf, strategyId, riskPct, rr, spread, slippage, partialTp]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = () => {
    if (!bt) return;
    const header = "OpenDate,CloseDate,Symbol,Side,Entry,Stop,Target,Exit,R,NetUSD,Reason\n";
    const rows = bt.trades
      .map((t) =>
        [
          new Date(t.openTime * 1000).toISOString(),
          new Date(t.closeTime * 1000).toISOString(),
          bt.symbol,
          t.side,
          t.entry,
          t.stop,
          t.target,
          t.exit,
          t.r,
          t.dollars,
          `"${t.reason}"`,
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Backtest_${bt.symbol}_${bt.timeframe}_${bt.strategyId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div className="card-h">
          <div>
            <h2>Historical Strategy Tester & 500-Run Monte Carlo Stress Lab</h2>
            <div className="small muted">
              Replay rules on real market candles with spread & slippage deducted, then stress-test 500 randomized sequences against prop-firm drawdown limits.
            </div>
          </div>
          <div className="btn-row">
            {bt && (
              <button className="btn" onClick={downloadCsv}>
                Download Replay CSV
              </button>
            )}
            <button className="btn gold" disabled={busy} onClick={() => void run()}>
              {busy ? "Running Simulation..." : "Run Backtest + 500 Monte Carlo"}
            </button>
          </div>
        </div>

        <div className="grid-4">
          <div className="form-row">
            <label>Instrument</label>
            <select
              className="inp"
              value={symbol}
              onChange={(e) => {
                const sym = e.target.value as SymbolCode;
                setSymbol(sym);
                setSpread(String(Number((SYMBOL_SPECS[sym].defaultMaxSpread * 0.65).toFixed(SYMBOL_SPECS[sym].decimals))));
                setSlippage(String(SYMBOL_SPECS[sym].pipSize * 0.5));
              }}
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {s} — {SYMBOL_SPECS[s].shortName}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Strategy Blueprint</label>
            <select className="inp" value={strategyId} onChange={(e) => setStrategyId(e.target.value as StrategyId)}>
              {(Object.keys(STRATEGY_PRESETS) as StrategyId[]).map((id) => (
                <option key={id} value={id}>
                  {STRATEGY_PRESETS[id].name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Candle Timeframe</label>
            <select className="inp" value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
              <option value="1d">1D (500 Daily Bars)</option>
              <option value="4h">4H (Intraday Swing)</option>
              <option value="1h">1H (Session Structure)</option>
              <option value="15m">15m (Scalp / Momentum)</option>
            </select>
          </div>

          <div className="grid-2">
            <div className="form-row">
              <label>Risk / Trade %</label>
              <input className="inp" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Target R:R</label>
              <input className="inp" value={rr} onChange={(e) => setRr(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: 4, alignItems: "end" }}>
          <div className="form-row">
            <label>Modeled Broker Spread</label>
            <input className="inp" value={spread} onChange={(e) => setSpread(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Modeled Slippage Penalty</label>
            <input className="inp" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={partialTp} onChange={(e) => setPartialTp(e.target.checked)} />
            <span>Split TP1 (50% @ +1R + Break-Even)</span>
          </label>
        </div>
      </section>

      {err && <div className="banner">{err}</div>}

      {bt && (
        <>
          <section className="card">
            <div className="card-h">
              <h2>
                Backtest Verdict · {bt.symbol} · {bt.strategyName} ({bt.timeframe.toUpperCase()}, {bt.bars} Bars)
              </h2>
              <span className={`pill ${bt.profitFactor >= 1.3 ? "good" : "warn"}`}>
                {bt.profitFactor >= 1.3 ? "Positive Statistical Edge" : "Marginal / Needs Refinement"}
              </span>
            </div>

            <div className="kv-grid">
              <div className="kv"><div className="k">Total Trades</div><div className="v">{bt.trades.length}</div></div>
              <div className="kv"><div className="k">Win Rate</div><div className="v">{bt.winRate.toFixed(1)}%</div></div>
              <div className="kv"><div className="k">Profit Factor</div><div className="v gold-txt">{bt.profitFactor.toFixed(2)}</div></div>
              <div className="kv"><div className="k">Sharpe Ratio</div><div className="v">{bt.sharpeRatio.toFixed(2)}</div></div>
              <div className="kv">
                <div className="k">Net Profit</div>
                <div className={`v ${bt.netDollars >= 0 ? "pos" : "neg"}`}>
                  {bt.netDollars >= 0 ? "+" : "-"}${Math.abs(bt.netDollars).toLocaleString()} ({bt.netReturnPct >= 0 ? "+" : ""}{bt.netReturnPct.toFixed(2)}%)
                </div>
              </div>
              <div className="kv"><div className="k">Net R-Multiple</div><div className={`v ${bt.netR >= 0 ? "pos" : "neg"}`}>{bt.netR >= 0 ? "+" : ""}{bt.netR.toFixed(2)}R</div></div>
              <div className="kv"><div className="k">Max Drawdown</div><div className="v neg">{bt.maxDrawdownPct.toFixed(2)}%</div></div>
              <div className="kv"><div className="k">Ending Balance</div><div className="v">${bt.endingBalance.toLocaleString()}</div></div>
            </div>
          </section>

          <div className="grid-2">
            <section className="card">
              <div className="card-h">
                <h2>Historical Equity Curve</h2>
                <span className="small muted">{bt.wins}W / {bt.losses}L</span>
              </div>
              <EquitySvg points={bt.equity.map((p) => p.equity)} />
              <ul className="small muted" style={{ paddingLeft: 18, marginTop: 10 }}>
                {bt.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </section>

            <section className="card">
              <div className="card-h">
                <h2>500-Run Monte Carlo Confidence Bands</h2>
                <span className={`pill ${bt.monteCarlo.probBreachPropLimitPct < 5 ? "good" : "warn"}`}>
                  Prop Drawdown Breach Risk: {bt.monteCarlo.probBreachPropLimitPct.toFixed(1)}%
                </span>
              </div>
              <MonteCarloSvg bands={bt.monteCarlo.bands} />
              <div className="kv-grid" style={{ marginTop: 10 }}>
                <div className="kv">
                  <div className="k">95% Best Case</div>
                  <div className="v pos" style={{ fontSize: 14 }}>${bt.monteCarlo.p95EndingBalance.toLocaleString()}</div>
                </div>
                <div className="kv">
                  <div className="k">Median (50th)</div>
                  <div className="v gold-txt" style={{ fontSize: 14 }}>${bt.monteCarlo.p50EndingBalance.toLocaleString()}</div>
                </div>
                <div className="kv">
                  <div className="k">5% Worst Case</div>
                  <div className="v" style={{ fontSize: 14 }}>${bt.monteCarlo.p5EndingBalance.toLocaleString()}</div>
                </div>
                <div className="kv">
                  <div className="k">95% Worst DD</div>
                  <div className="v neg" style={{ fontSize: 14 }}>{bt.monteCarlo.p95WorstDrawdownPct.toFixed(2)}%</div>
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-h">
              <h2>Trade-by-Trade Replay ({bt.trades.length})</h2>
            </div>
            <div className="scroll-y">
              <table>
                <thead>
                  <tr>
                    <th>Open Date</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>Stop Loss</th>
                    <th>Target</th>
                    <th>Exit</th>
                    <th>R</th>
                    <th>P&L ($)</th>
                    <th>Exit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bt.trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td className="muted">{new Date(t.openTime * 1000).toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td className={t.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 700 }}>{t.side}</td>
                      <td>{formatPrice(bt.symbol, t.entry)}</td>
                      <td className="neg">{formatPrice(bt.symbol, t.stop)}</td>
                      <td className="pos">{formatPrice(bt.symbol, t.target)}</td>
                      <td>{formatPrice(bt.symbol, t.exit)}</td>
                      <td className={t.r >= 0 ? "pos" : "neg"}>{t.r >= 0 ? "+" : ""}{t.r.toFixed(2)}R</td>
                      <td className={t.dollars >= 0 ? "pos" : "neg"} style={{ fontWeight: 700 }}>
                        {t.dollars >= 0 ? "+" : "-"}${Math.abs(t.dollars).toFixed(2)}
                      </td>
                      <td className="muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EquitySvg({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="muted">Not enough trades for equity curve.</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const poly = points
    .map((v, i) => `${(i / (points.length - 1)) * 500},${145 - ((v - min) / span) * 125 - 10}`)
    .join(" ");
  return (
    <svg viewBox="0 0 500 150" style={{ width: "100%", height: 165, background: "#0c1017", borderRadius: 8 }}>
      <polyline points={poly} fill="none" stroke="#f3ca62" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MonteCarloSvg({ bands }: { bands: Array<{ step: number; p5: number; p50: number; p95: number }> }) {
  if (bands.length < 2) return <div className="muted">Not enough trades for Monte Carlo simulation.</div>;
  const all = bands.flatMap((b) => [b.p5, b.p50, b.p95]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const xOf = (i: number) => (i / (bands.length - 1)) * 500;
  const yOf = (v: number) => 145 - ((v - min) / span) * 125 - 10;

  const p95Pts = bands.map((b, i) => `${xOf(i)},${yOf(b.p95)}`).join(" ");
  const p50Pts = bands.map((b, i) => `${xOf(i)},${yOf(b.p50)}`).join(" ");
  const p5Pts = bands.map((b, i) => `${xOf(i)},${yOf(b.p5)}`).join(" ");
  const areaPts = [
    ...bands.map((b, i) => `${xOf(i)},${yOf(b.p95)}`),
    ...[...bands].reverse().map((b, idx) => `${xOf(bands.length - 1 - idx)},${yOf(b.p5)}`),
  ].join(" ");

  return (
    <svg viewBox="0 0 500 150" style={{ width: "100%", height: 165, background: "#0c1017", borderRadius: 8 }}>
      <polygon points={areaPts} fill="rgba(56, 189, 248, 0.14)" />
      <polyline points={p95Pts} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      <polyline points={p50Pts} fill="none" stroke="#38bdf8" strokeWidth="2.3" vectorEffect="non-scaling-stroke" />
      <polyline points={p5Pts} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
