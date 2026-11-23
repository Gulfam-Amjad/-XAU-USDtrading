"""Price data loading.

Supported CSV formats (auto-detected):
  * MT5 "Export bars": <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> ... (tab or comma)
  * Dukascopy: "Gmt time,Open,High,Low,Close,Volume" with 01.01.2024 00:00:00.000
  * Generic: a time/datetime/date column plus open, high, low, close

All prices are treated as BID prices. The result is indexed by UTC time.
MT5 exports are in broker server time: pass tz_offset_hours (e.g. 2 or 3).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

OHLC = ["open", "high", "low", "close"]


def _normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns=lambda c: str(c).strip().strip("<>").lower().replace(" ", "_"))
    return df


def load_csv(path: str | Path, tz_offset_hours: float = 0.0) -> pd.DataFrame:
    path = Path(path)
    with path.open("r", encoding="utf-8-sig", errors="replace") as fh:
        head = fh.readline()
    sep = "\t" if "\t" in head else ("," if "," in head else ";")
    df = _normalise_columns(pd.read_csv(path, sep=sep))

    if "date" in df.columns and "time" in df.columns:
        ts = pd.to_datetime(df["date"].astype(str) + " " + df["time"].astype(str), format="mixed")
    elif "gmt_time" in df.columns:
        ts = pd.to_datetime(df["gmt_time"], format="%d.%m.%Y %H:%M:%S.%f")
    elif "local_time" in df.columns:
        raw = df["local_time"].astype(str).str.replace(r"\s*GMT.*$", "", regex=True)
        ts = pd.to_datetime(raw, format="%d.%m.%Y %H:%M:%S.%f")
    else:
        col = next((c for c in ("datetime", "time", "date", "timestamp") if c in df.columns), None)
        if col is None:
            raise ValueError(f"No time column found in {path.name}: {list(df.columns)}")
        ts = pd.to_datetime(df[col], format="mixed")

    missing = [c for c in OHLC if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns {missing} in {path.name}")

    vol_col = next((c for c in ("tickvol", "volume", "vol") if c in df.columns), None)
    out = pd.DataFrame({c: pd.to_numeric(df[c], errors="coerce") for c in OHLC})
    out["volume"] = pd.to_numeric(df[vol_col], errors="coerce") if vol_col else 0.0
    idx = pd.DatetimeIndex(ts) - pd.Timedelta(hours=tz_offset_hours)
    out.index = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
    out = out.dropna(subset=OHLC)
    out = out[out["high"] >= out["low"]]
    out = out[~out.index.duplicated(keep="first")].sort_index()
    return out


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    return df.resample(rule, label="left", closed="left").agg(agg).dropna(subset=OHLC)


def to_m15(df: pd.DataFrame) -> pd.DataFrame:
    step = df.index.to_series().diff().median()
    if pd.notna(step) and step < pd.Timedelta(minutes=15):
        return resample(df, "15min")
    return df


def synthetic_gold(days: int = 500, start: str = "2023-01-02", seed: int = 7,
                   start_price: float = 1900.0) -> pd.DataFrame:
    """Random-walk M15 bars with gold-like volatility. FOR PIPELINE TESTING ONLY:
    results on this data say nothing about real performance."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start=start, periods=days * 96, freq="15min", tz="UTC")
    idx = idx[idx.dayofweek < 5]
    hours = idx.hour.to_numpy()
    session_vol = np.where((hours >= 7) & (hours < 17), 1.6, 0.7)
    regime = np.repeat(rng.normal(0, 0.00015, size=len(idx) // 960 + 1), 960)[: len(idx)]
    rets = regime + rng.standard_t(df=4, size=len(idx)) * 0.0009 * session_vol / np.sqrt(2)
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]])
    wick = np.abs(rng.normal(0, 0.0007, size=len(idx))) * close * session_vol
    high = np.maximum(open_, close) + wick * rng.uniform(0.2, 1.0, len(idx))
    low = np.minimum(open_, close) - wick * rng.uniform(0.2, 1.0, len(idx))
    vol = rng.integers(50, 500, len(idx)) * session_vol
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": vol}, index=idx)
