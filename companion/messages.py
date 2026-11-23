"""Human-readable Telegram messages for EA events and state."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo


def _t(ts_utc: Any, tz: ZoneInfo) -> str:
    try:
        return datetime.fromtimestamp(float(ts_utc), tz=timezone.utc).astimezone(tz).strftime("%a %d %b %H:%M")
    except (TypeError, ValueError):
        return "-"


def _money(v: Any) -> str:
    try:
        return f"{float(v):,.2f}"
    except (TypeError, ValueError):
        return "-"


def format_signal_lines(e: dict[str, Any]) -> str:
    return (
        f"{e.get('side', '?')} XAU/USD  entry {e.get('entry')}\n"
        f"Stop {e.get('sl')}  Target {e.get('tp')}  (R:R {e.get('rr')})\n"
        f"Size {e.get('lots')} lots, risk {_money(e.get('risk_money'))} ({e.get('risk_pct')}%)\n"
        f"Reason: {e.get('reason', '-')}"
    )


def format_event(e: dict[str, Any], tz: ZoneInfo, notify_blocked: bool = False,
                 notify_managed: bool = True) -> str | None:
    kind = e.get("type")
    when = _t(e.get("ts_utc"), tz)

    if kind == "approval_request":
        return (f"APPROVAL NEEDED ({when})\n{format_signal_lines(e)}\n"
                f"Expires {_t(e.get('expires_utc'), tz)}")
    if kind == "signal":
        return f"SIGNAL ONLY ({when}) - place manually if you agree\n{format_signal_lines(e)}"
    if kind == "trade_opened":
        src = "approved by you" if e.get("source") == "approved" else "automatic"
        return f"TRADE OPENED #{e.get('position_id')} ({src})\n{format_signal_lines(e)}"
    if kind == "trade_closed":
        net = float(e.get("net", 0) or 0)
        result = "WIN" if net > 0 else ("LOSS" if net < 0 else "BREAK-EVEN")
        return (f"TRADE CLOSED #{e.get('position_id')} - {result}\n"
                f"{e.get('side')} {e.get('lots')} lots  {e.get('open')} -> {e.get('close')}\n"
                f"Result {_money(net)} ({e.get('r')}R), {e.get('close_reason')}\n"
                f"Balance {_money(e.get('balance'))}")
    if kind == "trade_rejected":
        return f"Trade not placed: {e.get('why')}"
    if kind == "signal_blocked":
        return f"Setup skipped by safety filter: {e.get('why')}" if notify_blocked else None
    if kind == "signal_expired":
        return "Approval request expired - no trade placed."
    if kind == "signal_rejected":
        return "Signal rejected - no trade placed."
    if kind == "trade_managed":
        return f"Trade management: {e.get('action')}" if notify_managed else None
    if kind == "daily_limit":
        return (f"DAILY LOSS LIMIT REACHED ({e.get('daily_loss_pct')}% of {e.get('limit_pct')}%).\n"
                "All trades closed. No new trades until tomorrow.")
    if kind == "kill_switch":
        return (f"KILL SWITCH: overall drawdown {e.get('drawdown_pct')}% hit the {e.get('limit_pct')}% limit.\n"
                "All trades closed and trading stopped. Review before using /resetkill CONFIRM.")
    if kind in ("close_all", "close_all_incomplete"):
        prefix = "CLOSE-ALL" if kind == "close_all" else "CLOSE-ALL INCOMPLETE - check MT5 now"
        return f"{prefix}: {e.get('result')} (reason: {e.get('reason')})"
    if kind == "command_ack":
        return ("OK: " if e.get("ok") else "Not done: ") + str(e.get("message", ""))
    if kind == "warning":
        return f"Warning: {e.get('message')}"
    if kind == "started":
        return (f"GoldGuardian started - mode {e.get('mode')}, risk {e.get('risk_pct')}%"
                f"{', PAUSED' if e.get('paused') else ''}{', KILL SWITCH ACTIVE' if e.get('kill_switch') else ''}")
    if kind == "stopped":
        return "GoldGuardian EA stopped (removed from chart or terminal closed)."
    return None


def format_status(s: dict[str, Any] | None, tz: ZoneInfo, age_seconds: float | None) -> str:
    if not s:
        return "No status from MT5 yet. Is the EA running on the XAU/USD chart?"
    flags = []
    if s.get("kill_switch"):
        flags.append("KILL SWITCH ACTIVE")
    if s.get("paused"):
        flags.append("PAUSED")
    if s.get("news_blocked"):
        flags.append(f"news pause ({s.get('news_reason')})")
    status = ", ".join(flags) if flags else "Active"
    cur = s.get("currency", "")
    lines = [
        f"GoldGuardian {s.get('version')} - {status}",
        f"Mode: {s.get('mode')}   Direction: {s.get('direction')}   Risk: {s.get('risk_pct')}% (cap {s.get('max_risk_pct')}%)",
        f"Balance {_money(s.get('balance'))} {cur}   Equity {_money(s.get('equity'))} {cur}",
        f"Daily loss {s.get('daily_loss_pct')}% / {s.get('daily_limit_pct')}%   "
        f"Drawdown {s.get('drawdown_pct')}% / {s.get('drawdown_limit_pct')}%",
        f"Open trades {s.get('open_trades')}/{s.get('max_open_trades')}   "
        f"Trades today {s.get('trades_today')}/{s.get('max_trades_per_day')}",
        f"Session: {s.get('session')}   Spread: {s.get('spread_points')} pts",
        f"Levels: PDH {s.get('pdh')}  PDL {s.get('pdl')}  PWH {s.get('pwh')}  PWL {s.get('pwl')}",
    ]
    for p in s.get("positions", []) or []:
        lines.append(f"  #{p.get('position_id')} {p.get('side')} {p.get('lots')} @ {p.get('open')} "
                     f"SL {p.get('sl')} TP {p.get('tp')}  P/L {_money(p.get('profit'))}")
    news = s.get("upcoming_news", []) or []
    if news:
        lines.append("Upcoming high-impact news:")
        for n in news[:5]:
            lines.append(f"  {_t(n.get('ts_utc'), tz)} {n.get('currency')} {n.get('name')}")
    if not s.get("news_calendar_ok", True):
        lines.append("Warning: economic calendar unavailable in MT5.")
    if age_seconds is not None and age_seconds > 120:
        lines.append(f"Warning: last update from MT5 was {int(age_seconds)} seconds ago.")
    return "\n".join(lines)
