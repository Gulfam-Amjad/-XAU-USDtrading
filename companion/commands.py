"""Validation of remote commands before they are sent to the EA.

The EA validates again and enforces its own hard caps; this layer gives the
user a clear message immediately and blocks unauthorised chats.
"""

from __future__ import annotations

from dataclasses import dataclass

MODES = ("signal", "semi", "auto")
DIRECTIONS = ("both", "buy", "sell")

HELP_TEXT = (
    "GoldGuardian commands\n"
    "/status - account, limits and open trades\n"
    "/pause - stop opening new trades\n"
    "/resume - allow new trades again\n"
    "/closeall - close every GoldGuardian trade now\n"
    "/mode signal|semi|auto - permission level\n"
    "/risk 0.5 - risk per trade in % (capped by the EA)\n"
    "/direction both|buy|sell - allowed direction\n"
    "/report - today's report now\n"
    "/resetkill CONFIRM - reset the drawdown kill switch (trading stays paused)\n"
    "/help - this message"
)


@dataclass(frozen=True)
class ParsedCommand:
    ok: bool
    cmd: str = ""
    value: str = ""
    error: str = ""


def is_authorized(chat_id: int | None, allowed: list[int] | tuple[int, ...]) -> bool:
    return chat_id is not None and int(chat_id) in {int(x) for x in allowed}


def parse(cmd: str, args: list[str], max_risk_pct: float | None = None) -> ParsedCommand:
    cmd = cmd.lower().lstrip("/")
    value = args[0].strip() if args else ""

    if cmd in ("pause", "resume", "closeall", "status"):
        return ParsedCommand(True, cmd)

    if cmd == "mode":
        v = value.lower()
        if v not in MODES:
            return ParsedCommand(False, error="Use /mode signal, /mode semi or /mode auto.")
        return ParsedCommand(True, cmd, v)

    if cmd == "direction":
        v = value.lower()
        if v not in DIRECTIONS:
            return ParsedCommand(False, error="Use /direction both, /direction buy or /direction sell.")
        return ParsedCommand(True, cmd, v)

    if cmd == "risk":
        try:
            r = float(value.rstrip("%"))
        except ValueError:
            return ParsedCommand(False, error="Use /risk followed by a number, for example /risk 0.5")
        if r < 0.1:
            return ParsedCommand(False, error="Minimum risk is 0.10% per trade.")
        if max_risk_pct is not None and r > max_risk_pct:
            return ParsedCommand(False, error=f"Risk cannot exceed the hard cap of {max_risk_pct:.2f}% set in the EA.")
        return ParsedCommand(True, cmd, f"{r:.2f}")

    if cmd == "resetkill":
        if value != "CONFIRM":
            return ParsedCommand(False, error="To reset the kill switch send exactly: /resetkill CONFIRM")
        return ParsedCommand(True, cmd, "CONFIRM")

    return ParsedCommand(False, error="Unknown command. Send /help for the list.")
