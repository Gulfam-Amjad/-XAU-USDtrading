"""Python port of the EA's v0 strategy (StrategyKeyLevelRetest) for research.

PLACEHOLDER rules built from the course topic names; replace together with the
MQL5 version once the Strategy Rulebook is approved. Keep both in sync.

Evaluation happens at the open of bar i+1 using bars up to i (closed), exactly
like the EA which evaluates on the first tick of a new entry-timeframe bar.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .data_loader import resample


@dataclass
class StrategyParams:
    swing_strength: int = 2
    structure_lookback: int = 120
    retest_lookback: int = 48
    retest_tol_atr: float = 0.25
    break_min_atr: float = 0.5
    cluster_atr_mult: float = 0.25
    sl_buffer_atr: float = 0.2
    min_sl_atr: float = 0.6
    min_rr: float = 1.5
    default_rr: float = 2.0
    engulf_min_ratio: float = 1.0
    pin_wick_ratio: float = 0.6
    require_h4_agree: bool = True
    spread: float = 0.25            # price units added to BID for BUY entries
    server_gmt_offset_hours: int = 2


@dataclass
class Signal:
    time: pd.Timestamp              # entry time (open of the bar after the signal bar)
    signal_bar: pd.Timestamp
    dir: int
    entry: float
    sl: float
    tp: float
    rr: float
    level: str
    reason: str
    meta: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
def swings(values: np.ndarray, strength: int, lookback: int, highs: bool) -> list[float]:
    """Swing points of closed bars (chronological input); most recent first."""
    arr = values[-(lookback + strength + 1):]
    n = len(arr)
    out: list[float] = []
    for j in range(n - 1 - strength, strength - 1, -1):
        recent = arr[j + 1: j + strength + 1]
        older = arr[j - strength: j]
        if highs:
            ok = arr[j] > recent.max() and arr[j] >= older.max()
        else:
            ok = arr[j] < recent.min() and arr[j] <= older.min()
        if ok:
            out.append(float(arr[j]))
    return out


def bias(high: np.ndarray, low: np.ndarray, close: np.ndarray, strength: int, lookback: int) -> int:
    if len(close) < 2 * strength + 3:
        return 0
    hs = swings(high, strength, lookback, True)
    ls = swings(low, strength, lookback, False)
    if len(hs) < 2 or len(ls) < 2:
        return 0
    last = close[-1]
    if last > hs[0]:
        return 1
    if last < ls[0]:
        return -1
    if hs[0] > hs[1] and ls[0] > ls[1]:
        return 1
    if hs[0] < hs[1] and ls[0] < ls[1]:
        return -1
    return 0


def atr_sma(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    prev_close = np.concatenate([[close[0]], close[:-1]])
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    out = pd.Series(tr).rolling(period, min_periods=period).mean().to_numpy()
    return out


def cluster_levels(raw: list[tuple[float, str]], tol: float) -> list[tuple[float, str, int]]:
    raw = sorted((p, l) for p, l in raw if p and p > 0)
    out: list[list] = []
    for p, label in raw:
        if out and tol > 0 and p - out[-1][0] <= tol:
            t = out[-1][2]
            out[-1][0] = (out[-1][0] * t + p) / (t + 1)
            out[-1][2] = t + 1
            if label not in out[-1][1]:
                out[-1][1] += "+" + label
            continue
        out.append([p, label, 1])
    return [(p, l, t) for p, l, t in out]


def confirm_pattern(direction: int, o, h, l, c, po, pc, engulf_ratio: float, pin_ratio: float) -> str:
    body = abs(c - o)
    pbody = abs(pc - po)
    rng = h - l
    if direction > 0:
        if c > o and pc < po and c >= po and o <= pc and body >= pbody * engulf_ratio and body > 0:
            return "bullish engulfing"
        if rng > 0 and (min(o, c) - l) >= rng * pin_ratio and body <= rng * 0.35 and c >= l + rng * 0.5:
            return "bullish pin bar"
    else:
        if c < o and pc > po and c <= po and o >= pc and body >= pbody * engulf_ratio and body > 0:
            return "bearish engulfing"
        if rng > 0 and (h - max(o, c)) >= rng * pin_ratio and body <= rng * 0.35 and c <= h - rng * 0.5:
            return "bearish pin bar"
    return ""


# ---------------------------------------------------------------------------
def _naive_utc(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    return idx.tz_convert(None) if idx.tz is not None else idx


class _HigherTF:
    """Closed higher-timeframe bars aligned to broker server time."""

    def __init__(self, m15: pd.DataFrame, offset_h: int):
        shift = pd.Timedelta(hours=offset_h)
        srv = m15.copy()
        srv.index = _naive_utc(srv.index) + shift
        self.shift = shift
        self.d1 = resample(srv, "1D")
        self.h4 = resample(srv, "4h")
        self.mn = resample(srv, "MS")
        wk = srv.copy()
        wk_start = (wk.index.normalize() - pd.to_timedelta(wk.index.dayofweek, unit="D"))
        g = wk.groupby(wk_start)
        self.w1 = pd.DataFrame({"high": g["high"].max(), "low": g["low"].min()})

        self.d1_starts = self.d1.index.to_numpy()
        self.h4_ends = (self.h4.index + pd.Timedelta(hours=4)).to_numpy()
        self.w1_starts = self.w1.index.to_numpy()
        self.mn_starts = self.mn.index.to_numpy()
        h4 = self.h4
        self.h4_atr = atr_sma(h4["high"].to_numpy(), h4["low"].to_numpy(), h4["close"].to_numpy())
        self._d1_bias: dict[int, int] = {}
        self._h4_cache: dict[int, tuple[int, list[float], list[float]]] = {}

    def d1_count_before(self, t_srv: np.datetime64) -> int:
        day = t_srv.astype("datetime64[D]").astype("datetime64[ns]")
        return int(np.searchsorted(self.d1_starts, day, side="left"))

    def h4_closed(self, t_srv: np.datetime64) -> int:
        return int(np.searchsorted(self.h4_ends, t_srv, side="right"))

    def d1_bias(self, k: int, p: StrategyParams) -> int:
        if k not in self._d1_bias:
            d = self.d1.iloc[max(0, k - p.structure_lookback - p.swing_strength - 2):k]
            self._d1_bias[k] = bias(d["high"].to_numpy(), d["low"].to_numpy(), d["close"].to_numpy(),
                                    p.swing_strength, p.structure_lookback)
        return self._d1_bias[k]

    def h4_info(self, k: int, p: StrategyParams) -> tuple[int, list[float], list[float]]:
        if k not in self._h4_cache:
            d = self.h4.iloc[max(0, k - p.structure_lookback - p.swing_strength - 2):k]
            hi, lo, cl = d["high"].to_numpy(), d["low"].to_numpy(), d["close"].to_numpy()
            b = bias(hi, lo, cl, p.swing_strength, p.structure_lookback) if len(d) else 0
            hs = swings(hi, p.swing_strength, p.structure_lookback, True)[:4] if len(d) > 5 else []
            ls = swings(lo, p.swing_strength, p.structure_lookback, False)[:4] if len(d) > 5 else []
            self._h4_cache[k] = (b, hs, ls)
        return self._h4_cache[k]

    def levels(self, t_srv: np.datetime64, h4k: int, p: StrategyParams) -> list[tuple[float, str]]:
        raw: list[tuple[float, str]] = []
        dk = self.d1_count_before(t_srv)
        if dk >= 1:
            prev = self.d1.iloc[dk - 1]
            raw += [(prev["high"], "PDH"), (prev["low"], "PDL")]
        week = (t_srv.astype("datetime64[D]") - np.timedelta64(int(pd.Timestamp(t_srv).dayofweek), "D"))
        wk = int(np.searchsorted(self.w1_starts, week.astype("datetime64[ns]"), side="left"))
        if wk >= 1:
            pw = self.w1.iloc[wk - 1]
            raw += [(pw["high"], "PWH"), (pw["low"], "PWL")]
        ts = pd.Timestamp(t_srv)
        q_start_month = ((ts.month - 1) // 3) * 3 + 1
        q_start = np.datetime64(pd.Timestamp(year=ts.year, month=q_start_month, day=1), "ns")
        mk = int(np.searchsorted(self.mn_starts, q_start, side="left"))
        if mk < len(self.mn) and self.mn_starts[mk] == q_start:
            raw.append((self.mn.iloc[mk]["open"], "QO"))
        if mk >= 3:
            pq = self.mn.iloc[mk - 3:mk]
            raw += [(pq["high"].max(), "PQH"), (pq["low"].min(), "PQL")]
        _, hs, ls = self.h4_info(h4k, p)
        raw += [(x, "H4 swing high") for x in hs] + [(x, "H4 swing low") for x in ls]
        return raw


def generate_signals(m15: pd.DataFrame, params: StrategyParams | None = None) -> list[Signal]:
    p = params or StrategyParams()
    htf = _HigherTF(m15, p.server_gmt_offset_hours)
    o = m15["open"].to_numpy()
    h = m15["high"].to_numpy()
    l = m15["low"].to_numpy()
    c = m15["close"].to_numpy()
    times = m15.index
    srv_times = (_naive_utc(times) + htf.shift).to_numpy(dtype="datetime64[ns]")
    atr = atr_sma(h, l, c)
    signals: list[Signal] = []
    start = max(p.retest_lookback + 3, 20)

    for i in range(start, len(m15) - 1):
        if np.isnan(atr[i]) or atr[i] <= 0:
            continue
        bull = confirm_pattern(1, o[i], h[i], l[i], c[i], o[i - 1], c[i - 1], p.engulf_min_ratio, p.pin_wick_ratio)
        bear = confirm_pattern(-1, o[i], h[i], l[i], c[i], o[i - 1], c[i - 1], p.engulf_min_ratio, p.pin_wick_ratio)
        if not bull and not bear:
            continue
        t_eval = srv_times[i + 1]
        dk = htf.d1_count_before(t_eval)
        if dk < 10:
            continue
        b_d1 = htf.d1_bias(dk, p)
        if b_d1 == 0:
            continue
        pattern = bull if b_d1 > 0 else bear
        if not pattern:
            continue
        h4k = htf.h4_closed(t_eval)
        if h4k < 20:
            continue
        b_h4, _, _ = htf.h4_info(h4k, p)
        if p.require_h4_agree and b_h4 == -b_d1:
            continue
        atr_h4 = htf.h4_atr[h4k - 1]
        if np.isnan(atr_h4) or atr_h4 <= 0:
            continue

        d = b_d1
        a = atr[i]
        tol = a * p.retest_tol_atr
        levels = cluster_levels(htf.levels(t_eval, h4k, p), atr_h4 * p.cluster_atr_mult)
        if not levels:
            continue
        entry = o[i + 1] + (p.spread if d > 0 else 0.0)

        best = None
        best_dist = np.inf
        for lvl, label, _t in levels:
            touched = (l[i] <= lvl + tol and c[i] > lvl) if d > 0 else (h[i] >= lvl - tol and c[i] < lvl)
            if not touched:
                continue
            # break-and-hold within lookback: series r[k] = bar i+1-k, k = 2..lookback-1
            break_idx = None
            for k in range(2, p.retest_lookback):
                j = i + 1 - k
                if j < 0:
                    break
                if (c[j] < lvl) if d > 0 else (c[j] > lvl):
                    break_idx = k
                    break
            if break_idx is None or break_idx <= 2:
                continue
            seg = slice(i + 2 - break_idx, i + 1)
            extreme = h[seg].max() if d > 0 else l[seg].min()
            disp = (extreme - lvl) if d > 0 else (lvl - extreme)
            if disp < a * p.break_min_atr:
                continue
            dist = abs(entry - lvl)
            if dist < best_dist:
                best_dist = dist
                best = (lvl, label)
        if best is None:
            continue

        lvl, label = best
        sl = (min(l[i], lvl - tol) - a * p.sl_buffer_atr) if d > 0 else (max(h[i], lvl + tol) + a * p.sl_buffer_atr)
        risk = (entry - sl) * d
        min_risk = a * p.min_sl_atr
        if risk < min_risk:
            sl = entry - d * min_risk
            risk = min_risk
        if risk <= 0:
            continue

        if d > 0:
            above = [x for x in levels if x[0] > entry + tol]
            nxt = above[0] if above else None
        else:
            below = [x for x in levels if x[0] < entry - tol]
            nxt = below[-1] if below else None
        if nxt is not None:
            rr = (nxt[0] - entry) * d / risk
            if rr < p.min_rr:
                continue
            tp, tp_label = nxt[0], nxt[1]
        else:
            tp = entry + d * risk * p.default_rr
            tp_label = f"{p.default_rr:g}R"
            rr = p.default_rr

        bias_name = {1: "bullish", -1: "bearish", 0: "neutral"}
        reason = (f"Daily {bias_name[b_d1]}, H4 {bias_name[b_h4]}, re-test of {label} {lvl:.2f} "
                  f"+ {pattern} on M15, target {tp_label}")
        signals.append(Signal(time=times[i + 1], signal_bar=times[i], dir=d, entry=float(entry),
                              sl=float(sl), tp=float(tp), rr=float(rr), level=f"{label} {lvl:.2f}",
                              reason=reason, meta={"atr": float(a)}))
    return signals
