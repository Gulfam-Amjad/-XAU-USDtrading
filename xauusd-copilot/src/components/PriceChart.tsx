"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { bollingerSeries, emaSeries, rsiSeries } from "@/lib/indicators";
import type { Bar } from "@/lib/types";

export interface Level {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

export interface OverlayState {
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  bollinger: boolean;
  srLevels: boolean;
  volume: boolean;
  rsiPane: boolean;
}

export default function PriceChart({
  bars,
  levels,
  srLevels,
  overlays,
  decimals = 2,
}: {
  bars: Bar[];
  levels: Level[];
  srLevels: Level[];
  overlays: OverlayState;
  decimals?: number;
}) {
  const mainBox = useRef<HTMLDivElement>(null);
  const rsiBox = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const fittedRef = useRef(false);

  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const minMove = useMemo(() => Number((10 ** -decimals).toFixed(decimals)), [decimals]);

  // Initialize Main Chart
  useEffect(() => {
    const el = mainBox.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#121720" },
        textColor: "#8b96a9",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(37, 46, 61, 0.45)" },
        horzLines: { color: "rgba(37, 46, 61, 0.45)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: { type: "price", precision: decimals, minMove },
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const lineOpts = (color: string) => ({
      color,
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const e20 = chart.addSeries(LineSeries, lineOpts("#f3ca62"));
    const e50 = chart.addSeries(LineSeries, lineOpts("#38bdf8"));
    const e200 = chart.addSeries(LineSeries, lineOpts("#c084fc"));
    const bbU = chart.addSeries(LineSeries, { ...lineOpts("rgba(148, 163, 184, 0.55)"), lineStyle: 2 });
    const bbL = chart.addSeries(LineSeries, { ...lineOpts("rgba(148, 163, 184, 0.55)"), lineStyle: 2 });

    mainChartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;
    ema20Ref.current = e20;
    ema50Ref.current = e50;
    ema200Ref.current = e200;
    bbUpRef.current = bbU;
    bbLowRef.current = bbL;
    fittedRef.current = false;

    return () => {
      chart.remove();
      mainChartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      bbUpRef.current = null;
      bbLowRef.current = null;
      linesRef.current = [];
    };
  }, [decimals, minMove]);

  // Initialize RSI Sub-Chart when enabled
  useEffect(() => {
    if (!overlays.rsiPane) return;
    const el = rsiBox.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0f141c" },
        textColor: "#8b96a9",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(37, 46, 61, 0.35)" },
        horzLines: { color: "rgba(37, 46, 61, 0.35)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    const rSeries = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 1, minMove: 0.1 },
    });
    rSeries.createPriceLine({ price: 70, color: "rgba(239,68,68,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "70" });
    rSeries.createPriceLine({ price: 50, color: "rgba(148,163,184,0.3)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    rSeries.createPriceLine({ price: 30, color: "rgba(34,197,94,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "30" });

    rsiChartRef.current = chart;
    rsiLineRef.current = rSeries;

    return () => {
      chart.remove();
      rsiChartRef.current = null;
      rsiLineRef.current = null;
    };
  }, [overlays.rsiPane]);

  // Populate Candles, Volume, Overlays, and RSI
  useEffect(() => {
    const candle = candleRef.current;
    const chart = mainChartRef.current;
    if (!candle || !chart || bars.length === 0) return;

    candle.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    if (volRef.current) {
      volRef.current.setData(
        overlays.volume
          ? bars.map((b) => ({
              time: b.time as UTCTimestamp,
              value: b.volume,
              color: b.close >= b.open ? "rgba(34, 197, 94, 0.28)" : "rgba(239, 68, 68, 0.28)",
            }))
          : [],
      );
    }

    const closes = bars.map((b) => b.close);
    const toLine = (vals: number[]) =>
      bars.map((b, i) => ({ time: b.time as UTCTimestamp, value: vals[i] }));

    ema20Ref.current?.setData(overlays.ema20 ? toLine(emaSeries(closes, 20)) : []);
    ema50Ref.current?.setData(overlays.ema50 ? toLine(emaSeries(closes, 50)) : []);
    ema200Ref.current?.setData(overlays.ema200 ? toLine(emaSeries(closes, 200)) : []);

    if (overlays.bollinger) {
      const bb = bollingerSeries(closes, 20, 2);
      bbUpRef.current?.setData(toLine(bb.upper));
      bbLowRef.current?.setData(toLine(bb.lower));
    } else {
      bbUpRef.current?.setData([]);
      bbLowRef.current?.setData([]);
    }

    if (overlays.rsiPane && rsiLineRef.current) {
      const rVals = rsiSeries(closes, 14);
      rsiLineRef.current.setData(toLine(rVals));
      rsiChartRef.current?.timeScale().fitContent();
    }

    if (!fittedRef.current) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [bars, overlays]);

  // Price Lines (Open Trades + Proposals + Support/Resistance + PDH/PDL)
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const ln of linesRef.current) candle.removePriceLine(ln);
    const combined = overlays.srLevels ? [...srLevels, ...levels] : levels;
    linesRef.current = combined.map((l) =>
      candle.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.dashed ? 2 : 0,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
  }, [levels, srLevels, overlays.srLevels]);

  return (
    <div className={`chart-shell ${fullscreen ? "fullscreen" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6, flexWrap: "wrap" }}>
        <div className="small muted" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {overlays.ema20 && <span style={{ color: "#f3ca62" }}>● EMA 20</span>}
          {overlays.ema50 && <span style={{ color: "#38bdf8" }}>● EMA 50</span>}
          {overlays.ema200 && <span style={{ color: "#c084fc" }}>● EMA 200</span>}
          {overlays.bollinger && <span style={{ color: "#94a3b8" }}>◌ BB(20,2)</span>}
          {overlays.srLevels && <span style={{ color: "#22c55e" }}>━ S/R & PDH/PDL</span>}
        </div>
        <div className="btn-row">
          <button
            className="btn xs"
            onClick={() => {
              mainChartRef.current?.timeScale().fitContent();
              rsiChartRef.current?.timeScale().fitContent();
            }}
          >
            Reset Zoom
          </button>
          <button className="btn xs" onClick={() => setFullscreen((f) => !f)}>
            {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>
      <div ref={mainBox} className="chart-main" />
      {overlays.rsiPane && (
        <div>
          <div className="small muted" style={{ padding: "3px 2px 0", fontSize: 10.5 }}>
            RSI (14) Momentum Oscillator · Overbought 70 / Oversold 30
          </div>
          <div ref={rsiBox} className="chart-rsi" />
        </div>
      )}
    </div>
  );
}
