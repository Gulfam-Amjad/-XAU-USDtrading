"""Telegram control panel for the GoldGuardian EA.

Only chat IDs listed in the config can use the bot. Every command is passed to
the EA through the file bridge; the EA re-checks all limits before acting.
"""

from __future__ import annotations

import logging
from datetime import datetime, time as dtime
from typing import Any
from zoneinfo import ZoneInfo

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from . import commands as cmdlib
from . import messages, reports
from .bridge import Bridge

log = logging.getLogger("goldguardian.telegram")

WEEKDAYS = {"sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6}


class GoldGuardianBot:
    def __init__(self, config: dict[str, Any], bridge: Bridge):
        self.cfg = config
        self.bridge = bridge
        self.tz = ZoneInfo(config.get("timezone", "Europe/London"))
        tg = config["telegram"]
        self.allowed = [int(x) for x in tg.get("allowed_chat_ids", [])]
        notify = config.get("notify", {})
        self.notify_blocked = bool(notify.get("blocked_signals", False))
        self.notify_managed = bool(notify.get("managed_trades", True))
        self.heartbeat_timeout = int(config.get("heartbeat_timeout_sec", 120))
        self.reports_dir = config.get("reports_dir", "companion_data/reports")
        self._stale_alerted = False
        self.app = Application.builder().token(tg["token"]).build()
        self._register()

    # ---- helpers ---------------------------------------------------------
    def _authorized(self, update: Update) -> bool:
        chat = update.effective_chat
        ok = cmdlib.is_authorized(chat.id if chat else None, self.allowed)
        if not ok:
            log.warning("Rejected command from chat %s", chat.id if chat else None)
        return ok

    async def _broadcast(self, text: str, markup: InlineKeyboardMarkup | None = None) -> None:
        for chat_id in self.allowed:
            try:
                await self.app.bot.send_message(chat_id=chat_id, text=text, reply_markup=markup)
            except Exception:  # noqa: BLE001 - keep notifying other chats
                log.exception("Failed to send message to %s", chat_id)

    def _max_risk(self) -> float | None:
        state = self.bridge.read_state()
        try:
            return float(state["max_risk_pct"]) if state else None
        except (KeyError, TypeError, ValueError):
            return None

    # ---- command handlers -----------------------------------------------
    def _register(self) -> None:
        a = self.app
        a.add_handler(CommandHandler(["start", "help"], self.on_help))
        a.add_handler(CommandHandler("status", self.on_status))
        a.add_handler(CommandHandler("report", self.on_report))
        for name in ("pause", "resume", "closeall", "mode", "risk", "direction", "resetkill"):
            a.add_handler(CommandHandler(name, self.on_command))
        a.add_handler(CallbackQueryHandler(self.on_button, pattern=r"^(approve|reject):"))

        jq = a.job_queue
        jq.run_repeating(self.poll_events, interval=float(self.cfg.get("poll_interval_sec", 3)), first=2)
        jq.run_repeating(self.check_heartbeat, interval=30, first=30)

        rep = self.cfg.get("reports", {})
        daily_t = self._parse_time(rep.get("daily_time", "22:30"))
        jq.run_daily(self.send_daily, time=daily_t)
        weekly_t = self._parse_time(rep.get("weekly_time", "22:45"))
        weekday = WEEKDAYS.get(str(rep.get("weekly_day", "friday")).lower(), 5)
        jq.run_daily(self.send_weekly, time=weekly_t, days=(weekday,))
        monthly_t = self._parse_time(rep.get("monthly_time", "08:00"))
        jq.run_monthly(self.send_monthly, when=monthly_t, day=int(rep.get("monthly_day", 1)))

    def _parse_time(self, hhmm: str) -> dtime:
        h, m = (int(x) for x in hhmm.split(":"))
        return dtime(h, m, tzinfo=self.tz)

    async def on_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._authorized(update):
            return
        await update.effective_message.reply_text(cmdlib.HELP_TEXT)

    async def on_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._authorized(update):
            return
        state = self.bridge.read_state()
        await update.effective_message.reply_text(
            messages.format_status(state, self.tz, self.bridge.state_age_seconds(state)))

    async def on_report(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._authorized(update):
            return
        text = reports.daily_report(self.bridge.read_all_events(), self.bridge.read_state(),
                                    datetime.now(self.tz).date(), self.tz)
        await update.effective_message.reply_text(text)

    async def on_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._authorized(update):
            return
        name = update.effective_message.text.split()[0].lstrip("/").split("@")[0]
        parsed = cmdlib.parse(name, list(context.args or []), self._max_risk())
        if not parsed.ok:
            await update.effective_message.reply_text(parsed.error)
            return
        user = update.effective_user.username if update.effective_user else "telegram"
        self.bridge.send_command(parsed.cmd, parsed.value, source=f"telegram:{user}")
        sent = f"{parsed.cmd} {parsed.value}".strip()
        await update.effective_message.reply_text(f"Sent '{sent}' to MT5. Waiting for confirmation...")

    async def on_button(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        if not self._authorized(update):
            await query.answer("Not authorised", show_alert=True)
            return
        action, signal_id = query.data.split(":", 1)
        user = update.effective_user.username if update.effective_user else "telegram"
        self.bridge.send_command(action, signal_id=signal_id, source=f"telegram:{user}")
        await query.answer("Sent to MT5")
        label = "Approved - placing trade..." if action == "approve" else "Rejected."
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(label)

    # ---- background jobs -------------------------------------------------
    async def poll_events(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        for e in self.bridge.read_new_events():
            text = messages.format_event(e, self.tz, self.notify_blocked, self.notify_managed)
            if not text:
                continue
            markup = None
            if e.get("type") == "approval_request" and e.get("signal_id"):
                sid = str(e["signal_id"])
                markup = InlineKeyboardMarkup([[
                    InlineKeyboardButton("Approve", callback_data=f"approve:{sid}"),
                    InlineKeyboardButton("Reject", callback_data=f"reject:{sid}"),
                ]])
            await self._broadcast(text, markup)

    async def check_heartbeat(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        age = self.bridge.state_age_seconds(self.bridge.read_state())
        stale = age is None or age > self.heartbeat_timeout
        if stale and not self._stale_alerted:
            self._stale_alerted = True
            await self._broadcast("WARNING: no update from MT5 for over "
                                  f"{self.heartbeat_timeout} seconds. Check the VPS, MT5 and the EA. "
                                  "Open trades still have their stop losses at the broker.")
        elif not stale and self._stale_alerted:
            self._stale_alerted = False
            await self._broadcast("MT5 connection restored.")

    async def _send_and_save(self, text: str, name: str) -> None:
        reports.save_report(text, self.reports_dir, name)
        await self._broadcast(text)

    async def send_daily(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        today = datetime.now(self.tz).date()
        if today.weekday() >= 5:
            return
        text = reports.daily_report(self.bridge.read_all_events(), self.bridge.read_state(), today, self.tz)
        await self._send_and_save(text, f"daily_{today.isoformat()}")

    async def send_weekly(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        today = datetime.now(self.tz).date()
        text = reports.weekly_report(self.bridge.read_all_events(), self.bridge.read_state(), today, self.tz)
        await self._send_and_save(text, f"weekly_{today.isoformat()}")

    async def send_monthly(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        today = datetime.now(self.tz).date()
        text = reports.monthly_report(self.bridge.read_all_events(), self.bridge.read_state(), today, self.tz)
        await self._send_and_save(text, f"monthly_{today.isoformat()}")

    def run(self) -> None:
        self.app.run_polling(allowed_updates=Update.ALL_TYPES)
