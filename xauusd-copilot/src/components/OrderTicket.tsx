"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPrice, marginRequiredUsd, SYMBOL_SPECS, usdPerPriceUnit } from "@/lib/symbols";
import type { Decision, OrderType, Quote, Settings, Side, StrategyConfig, SymbolCode } from "@/lib/types";

export default function OrderTicket({
  symbol,
  quote,
  decision,
  balance,
  openCount,
  settings,
  strategy,
  busy,
  onAct,
}: {
  symbol: SymbolCode;
  quote: Quote | null;
  decision: Decision | null;
  balance: number;
  openCount: number;
  settings: Settings;
  strategy: StrategyConfig;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const spec = SYMBOL_SPECS[symbol];
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [sizingMode, setSizingMode] = useState<"risk" | "lots">("risk");
  const [riskPct, setRiskPct] = useState(String(settings.riskPct));
  const [manualLots, setManualLots] = useState("0.10");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [partialTp, setPartialTp] = useState(strategy.partialTpEnabled);
  const [trailingDist, setTrailingDist] = useState("");

  // Smart auto-seed SL & TP whenever symbol or side changes
  const applySmartLevels = (targetSide: Side, q: Quote | null, atrVal: number) => {
    if (!q) return;
    const entry = targetSide === "BUY" ? q.ask : q.bid;
    const dist =
      atrVal > 0
        ? atrVal * 1.1
        : symbol === "XAUUSD"
          ? 10
          : symbol === "BTCUSD"
            ? 450
            : symbol === "USDJPY"
              ? 0.4
              : 0.0025;
    const rr = strategy.rewardRatio || 2;
    const sl = targetSide === "BUY" ? entry - dist : entry + dist;
    const tp = targetSide === "BUY" ? entry + dist * rr : entry - dist * rr;
    setTriggerPrice(entry.toFixed(spec.decimals));
    setStopLoss(sl.toFixed(spec.decimals));
    setTakeProfit(tp.toFixed(spec.decimals));
  };

  useEffect(() => {
    if (quote) applySmartLevels(side, quote, decision?.atr ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    setRiskPct(String(settings.riskPct));
  }, [settings.riskPct]);

  const effectiveOrderSide: Side =
    orderType === "MARKET" ? side : orderType.startsWith("BUY") ? "BUY" : "SELL";

  const entryRef = useMemo(() => {
    if (!quote) return 0;
    if (orderType === "MARKET") return effectiveOrderSide === "BUY" ? quote.ask : quote.bid;
    return Number(triggerPrice) || quote.mid;
  }, [quote, orderType, effectiveOrderSide, triggerPrice]);

  const calc = useMemo(() => {
    const sl = Number(stopLoss);
    const tp = Number(takeProfit);
    const dist = Math.abs(entryRef - sl);
    const rewDist = Math.abs(tp - entryRef);
    const unitVal = usdPerPriceUnit(symbol, entryRef);
    if (!(entryRef > 0) || !(sl > 0) || !(dist > 0)) {
      return { lots: 0.01, riskUsd: 0, rewardUsd: 0, rr: 0, margin: 0, validDir: false };
    }
    const validDir =
      effectiveOrderSide === "BUY"
        ? sl < entryRef && tp > entryRef
        : sl > entryRef && tp < entryRef;

    let lots = 0.01;
    let riskUsd = 0;
    if (sizingMode === "risk") {
      const rPct = Math.max(0.05, Number(riskPct) || settings.riskPct);
      riskUsd = (balance * rPct) / 100;
      lots = Math.min(spec.maxLot, Math.max(spec.minLot, Math.floor((riskUsd / (dist * unitVal)) * 100) / 100));
      riskUsd = dist * lots * unitVal;
    } else {
      lots = Math.min(spec.maxLot, Math.max(spec.minLot, Number(manualLots) || 0.01));
      riskUsd = dist * lots * unitVal;
    }
    const rewardUsd = rewDist * lots * unitVal;
    const rr = dist > 0 ? rewDist / dist : 0;
    const margin = marginRequiredUsd(symbol, lots, entryRef);
    return { lots, riskUsd, rewardUsd, rr, margin, validDir };
  }, [entryRef, stopLoss, takeProfit, symbol, effectiveOrderSide, sizingMode, riskPct, manualLots, balance, settings.riskPct, spec]);

  const spreadWarn = quote ? quote.spread > (symbol === "XAUUSD" ? settings.maxSpread : spec.defaultMaxSpread) : false;

  const submit = () => {
    void onAct("placeOrder", {
      symbol,
      orderType,
      side: effectiveOrderSide,
      triggerPrice: Number(triggerPrice),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      riskPct: sizingMode === "risk" ? Number(riskPct) : undefined,
      lots: sizingMode === "lots" ? Number(manualLots) : undefined,
      partialTp,
      trailingDistance: Number(trailingDist) > 0 ? Number(trailingDist) : undefined,
      reason: `Order Ticket (${orderType})`,
    });
  };

  return (
    <section className="card">
      <div className="card-h">
        <h2>Order Ticket · {symbol}</h2>
        <button
          className="btn xs"
          type="button"
          onClick={() => applySmartLevels(effectiveOrderSide, quote, decision?.atr ?? 0)}
        >
          Auto SL/2R
        </button>
      </div>

      <div className="form-row">
        <label>Execution Type</label>
        <select
          className="inp"
          value={orderType}
          onChange={(e) => {
            const nextType = e.target.value as OrderType;
            setOrderType(nextType);
            if (nextType !== "MARKET") {
              const nextSide: Side = nextType.startsWith("BUY") ? "BUY" : "SELL";
              setSide(nextSide);
              if (quote) applySmartLevels(nextSide, quote, decision?.atr ?? 0);
            }
          }}
        >
          <option value="MARKET">Market Execution (Instant)</option>
          <option value="BUY_LIMIT">Buy Limit (Below Market)</option>
          <option value="SELL_LIMIT">Sell Limit (Above Market)</option>
          <option value="BUY_STOP">Buy Stop (Breakout Above)</option>
          <option value="SELL_STOP">Sell Stop (Breakout Below)</option>
        </select>
      </div>

      {orderType === "MARKET" && (
        <div className="grid-2" style={{ marginBottom: 9 }}>
          <button
            type="button"
            className={`btn ${side === "BUY" ? "green" : ""}`}
            style={{ padding: "9px 8px", fontWeight: 800 }}
            onClick={() => {
              setSide("BUY");
              applySmartLevels("BUY", quote, decision?.atr ?? 0);
            }}
          >
            BUY · {quote ? formatPrice(symbol, quote.ask) : "--"}
          </button>
          <button
            type="button"
            className={`btn ${side === "SELL" ? "red" : ""}`}
            style={{ padding: "9px 8px", fontWeight: 800 }}
            onClick={() => {
              setSide("SELL");
              applySmartLevels("SELL", quote, decision?.atr ?? 0);
            }}
          >
            SELL · {quote ? formatPrice(symbol, quote.bid) : "--"}
          </button>
        </div>
      )}

      {orderType !== "MARKET" && (
        <div className="form-row">
          <label>Trigger Price ({symbol})</label>
          <input className="inp" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} />
        </div>
      )}

      <div className="grid-2">
        <div className="form-row">
          <label>Stop Loss (Mandatory)</label>
          <input className="inp" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Take Profit Target</label>
          <input className="inp" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 6 }}>
        <button
          type="button"
          className={`btn xs ${sizingMode === "risk" ? "active" : ""}`}
          onClick={() => setSizingMode("risk")}
        >
          Size by Risk %
        </button>
        <button
          type="button"
          className={`btn xs ${sizingMode === "lots" ? "active" : ""}`}
          onClick={() => setSizingMode("lots")}
        >
          Manual Lots
        </button>
      </div>

      <div className="grid-2">
        {sizingMode === "risk" ? (
          <div className="form-row">
            <label>Risk % of Balance</label>
            <input className="inp" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
          </div>
        ) : (
          <div className="form-row">
            <label>Volume (Lots)</label>
            <input className="inp" value={manualLots} onChange={(e) => setManualLots(e.target.value)} />
          </div>
        )}
        <div className="form-row">
          <label>Trailing Stop ($ dist, opt)</label>
          <input
            className="inp"
            placeholder="Off"
            value={trailingDist}
            onChange={(e) => setTrailingDist(e.target.value)}
          />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, margin: "4px 0 10px", cursor: "pointer" }}>
        <input type="checkbox" checked={partialTp} onChange={(e) => setPartialTp(e.target.checked)} />
        <span>Split TP1: bank 50% at +{strategy.tp1R}R & auto-lock Break-Even</span>
      </label>

      <div className="kv-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 10 }}>
        <div className="kv">
          <div className="k">Calculated Size</div>
          <div className="v" style={{ fontSize: 14 }}>{calc.lots.toFixed(2)} lots</div>
        </div>
        <div className="kv">
          <div className="k">Max Risk / Reward</div>
          <div className="v" style={{ fontSize: 13 }}>
            <span className="neg">-${calc.riskUsd.toFixed(0)}</span> / <span className="pos">+${calc.rewardUsd.toFixed(0)}</span>
          </div>
        </div>
        <div className="kv">
          <div className="k">R:R Ratio</div>
          <div className="v gold-txt" style={{ fontSize: 14 }}>1 : {calc.rr.toFixed(2)}</div>
        </div>
        <div className="kv">
          <div className="k">Margin (1:{spec.leverage})</div>
          <div className="v" style={{ fontSize: 14 }}>${calc.margin.toFixed(0)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={`pill ${!spreadWarn ? "good" : "warn"}`}>
          {spreadWarn ? "Wide Spread" : "Spread OK"}
        </span>
        <span className={`pill ${openCount < settings.maxOpenTrades ? "good" : "bad"}`}>
          Open {openCount}/{settings.maxOpenTrades}
        </span>
        <span className={`pill ${calc.validDir ? "good" : "bad"}`}>
          {calc.validDir ? "SL/TP Valid" : "Check SL/TP Side"}
        </span>
      </div>

      <button
        type="button"
        disabled={busy || !quote || !calc.validDir || settings.killSwitch}
        className={`btn ${effectiveOrderSide === "BUY" ? "green" : "red"}`}
        style={{ width: "100%", padding: "10px", fontWeight: 800, fontSize: 13 }}
        onClick={submit}
      >
        {settings.killSwitch
          ? "Kill Switch Active"
          : orderType === "MARKET"
            ? `Execute ${effectiveOrderSide} ${calc.lots.toFixed(2)} Lots (${symbol})`
            : `Place ${orderType.replace("_", " ")} (${calc.lots.toFixed(2)} Lots)`}
      </button>
    </section>
  );
}
