"""Daily, weekly and monthly reports built from the EA event log and state."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from research.metrics import format_summary, summarize

SAFETY_EVENTS = ("daily_limit", "kill_switch", "close_all", "close_all_incomplete")


def _local_range(start_day: date, days: int, tz: ZoneInfo) -> tuple[float, float]:
    start = datetime.combine(start_day, time(0, 0), tzinfo=tz)
    end = datetime.combine(start_day + timedelta(days=days), time(0, 0), tzinfo=tz)
    return start.timestamp(), end.timestamp()


def _in_range(e: dict[str, Any], lo: float, hi: float) -> bool:
    try:
        ts = float(e.get("ts_utc", 0))
    except (TypeError, ValueError):
        return False
    return lo <= ts < hi


def _fmt_time(ts: Any, tz: ZoneInfo) -> str:
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).astimezone(tz).strftime("%H:%M")
    except (TypeError, ValueError):
        return "--:--"


def collect(events: list[dict[str, Any]], lo: float, hi: float) -> dict[str, Any]:
    opened = {str(e.get("position_id")): e for e in events if e.get("type") == "trade_opened"}
    closed = [e for e in events if e.get("type") == "trade_closed" and _in_range(e, lo, hi)]
    closed.sort(key=lambda e: float(e.get("ts_utc", 0)))
    blocked = [e for e in events if e.get("type") == "signal_blocked" and _in_range(e, lo, hi)]
    safety = [e for e in events if e.get("type") in SAFETY_EVENTS and _in_range(e, lo, hi)]
    trades = []
    for c in closed:
        o = opened.get(str(c.get("position_id")), {})
        trades.append({**c, "reason": o.get("reason", "-"), "open_ts": o.get("ts_utc")})
    return {"trades": trades, "blocked": blocked, "safety": safety}


def _stats(trades: list[dict[str, Any]], balance_now: float | None) -> dict[str, float]:
    pnls = [float(t.get("net", 0) or 0) for t in trades]
    rs = [float(t.get("r", 0) or 0) for t in trades]
    start_bal = None
    if balance_now:
        start_bal = balance_now - sum(pnls)
    return summarize(pnls, rs, start_bal if start_bal and start_bal > 0 else None)


def daily_report(events: list[dict[str, Any]], state: dict[str, Any] | None,
                 day: date, tz: ZoneInfo) -> str:
    lo, hi = _local_range(day, 1, tz)
    data = collect(events, lo, hi)
    s = state or {}
    balance = float(s.get("balance", 0) or 0) or None
    m = _stats(data["trades"], balance)

    status = "Paused" if s.get("paused") else "Active"
    if s.get("kill_switch"):
        status = "Stopped (kill switch)"
    lines = [
        f"XAU/USD DAILY REPORT - {day.strftime('%A %d %B %Y')}",
        "",
        f"Mode: {s.get('mode', '-')}    Status: {status}",
        f"Account balance: {balance:,.2f} {s.get('currency', '')}" if balance else "Account balance: -",
        f"Today: {m.get('return_pct', 0.0):+.2f}%  ({m['net']:+,.2f})",
        "",
        "TRADES TODAY" if data["trades"] else "TRADES TODAY: none",
    ]
    for i, t in enumerate(data["trades"], 1):
        lines.append(f"{i}) {t.get('side')} {t.get('open')} -> {t.get('close')}  "
                     f"{float(t.get('net', 0) or 0):+,.2f} ({t.get('r')}R)  ({t.get('close_reason')})")
        lines.append(f"   Reason: {t.get('reason')}")

    lines += ["", "RISK STATUS",
              f"Daily loss limit used: {s.get('daily_loss_pct', 0)}% of {s.get('daily_limit_pct', '-')}%",
              f"Overall drawdown:      {s.get('drawdown_pct', 0)}% of {s.get('drawdown_limit_pct', '-')}%",
              f"Open trades:           {s.get('open_trades', 0)} / {s.get('max_open_trades', '-')}"]

    if data["safety"]:
        lines += ["", "SAFETY EVENTS"]
        for e in data["safety"]:
            lines.append(f"{_fmt_time(e.get('ts_utc'), tz)} {e.get('type')}: {e.get('reason') or e.get('result') or ''}")

    if data["blocked"]:
        reasons = Counter(str(e.get("why", "")) for e in data["blocked"])
        lines += ["", f"SETUPS SKIPPED BY FILTERS: {len(data['blocked'])}"]
        for why, n in reasons.most_common(5):
            lines.append(f"  {n} x {why}")

    news = s.get("upcoming_news") or []
    lines += ["", "NEXT 36 HOURS"]
    if news:
        for n in news[:6]:
            ts = n.get("ts_utc")
            when = datetime.fromtimestamp(float(ts), tz=timezone.utc).astimezone(tz).strftime("%a %H:%M") if ts else "-"
            lines.append(f"High-impact news: {when} {n.get('currency')} {n.get('name')} (no trading around it)")
    else:
        lines.append("No high-impact news found.")
    if s:
        lines.append(f"Key levels: PDH {s.get('pdh')} | PDL {s.get('pdl')} | PWH {s.get('pwh')} | PWL {s.get('pwl')}")
    return "\n".join(lines)


def period_report(events: list[dict[str, Any]], state: dict[str, Any] | None,
                  start_day: date, days: int, title: str, tz: ZoneInfo) -> str:
    lo, hi = _local_range(start_day, days, tz)
    data = collect(events, lo, hi)
    s = state or {}
    balance = float(s.get("balance", 0) or 0) or None
    m = _stats(data["trades"], balance)
    end_day = start_day + timedelta(days=days - 1)
    lines = [
        f"XAU/USD {title} - {start_day.strftime('%d %b')} to {end_day.strftime('%d %b %Y')}",
        "",
        format_summary(m),
        "",
        f"Safety events: {len(data['safety'])}    Setups skipped by filters: {len(data['blocked'])}",
        f"Current drawdown: {s.get('drawdown_pct', '-')}% of {s.get('drawdown_limit_pct', '-')}% limit",
    ]
    by_reason = Counter(str(t.get("close_reason")) for t in data["trades"])
    if by_reason:
        lines.append("Exits: " + ", ".join(f"{k} {v}" for k, v in by_reason.most_common()))
    lines += ["", "Note: compare these figures with the backtest report before changing any setting."]
    return "\n".join(lines)


def weekly_report(events, state, today: date, tz: ZoneInfo) -> str:
    start = today - timedelta(days=today.weekday())
    return period_report(events, state, start, 7, "WEEKLY REPORT", tz)


def monthly_report(events, state, today: date, tz: ZoneInfo) -> str:
    first_this = today.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    start = last_prev.replace(day=1)
    return period_report(events, state, start, (first_this - start).days, "MONTHLY REPORT", tz)


def save_report(text: str, folder: str | Path, name: str) -> Path:
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.txt"
    path.write_text(text, encoding="utf-8")
    return path
