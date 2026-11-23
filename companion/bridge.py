"""File bridge to the GoldGuardian EA.

The EA writes state.json, signals.json and events.jsonl into
Terminal\\Common\\Files\\GoldGuardian. Commands are sent as one JSON file per
command in the commands\\ subfolder; the EA deletes each file after reading it.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any


def default_bridge_dir() -> Path:
    appdata = os.environ.get("APPDATA", "")
    return Path(appdata) / "MetaQuotes" / "Terminal" / "Common" / "Files" / "GoldGuardian"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (FileNotFoundError, PermissionError):
        return None
    text = text.strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


class Bridge:
    def __init__(self, bridge_dir: str | Path | None, data_dir: str | Path):
        self.dir = Path(bridge_dir) if bridge_dir else default_bridge_dir()
        self.commands_dir = self.dir / "commands"
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._offset_file = self.data_dir / "events.offset"

    # ---- EA -> companion -------------------------------------------------
    def read_state(self) -> dict[str, Any] | None:
        return _read_json(self.dir / "state.json")

    def read_signal(self) -> dict[str, Any] | None:
        data = _read_json(self.dir / "signals.json")
        return data if data else None

    def _load_offset(self) -> int:
        try:
            return int(self._offset_file.read_text().strip() or 0)
        except (FileNotFoundError, ValueError):
            return 0

    def _save_offset(self, offset: int) -> None:
        self._offset_file.write_text(str(offset))

    def read_new_events(self) -> list[dict[str, Any]]:
        """Returns complete event lines written since the previous call."""
        path = self.dir / "events.jsonl"
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return []
        offset = self._load_offset()
        if size < offset:
            offset = 0
        if size == offset:
            return []
        with path.open("rb") as fh:
            fh.seek(offset)
            chunk = fh.read(size - offset)
        last_nl = chunk.rfind(b"\n")
        if last_nl < 0:
            return []
        complete = chunk[: last_nl + 1]
        self._save_offset(offset + len(complete))
        return _parse_lines(complete)

    def skip_existing_events(self) -> None:
        path = self.dir / "events.jsonl"
        try:
            self._save_offset(path.stat().st_size)
        except FileNotFoundError:
            self._save_offset(0)

    def read_all_events(self) -> list[dict[str, Any]]:
        path = self.dir / "events.jsonl"
        try:
            return _parse_lines(path.read_bytes())
        except FileNotFoundError:
            return []

    # ---- companion -> EA -------------------------------------------------
    def send_command(self, cmd: str, value: str = "", signal_id: str = "", source: str = "telegram") -> str:
        self.commands_dir.mkdir(parents=True, exist_ok=True)
        cmd_id = f"{time.time_ns()}_{uuid.uuid4().hex[:6]}"
        body = {"id": cmd_id, "cmd": cmd, "value": value, "signal_id": signal_id, "source": source}
        tmp = self.commands_dir / f"{cmd_id}.tmp"
        tmp.write_text(json.dumps(body), encoding="utf-8")
        os.replace(tmp, self.commands_dir / f"{cmd_id}.json")
        return cmd_id

    def state_age_seconds(self, state: dict[str, Any] | None) -> float | None:
        if not state or "ts_utc" not in state:
            return None
        return time.time() - float(state["ts_utc"])


def _parse_lines(raw: bytes) -> list[dict[str, Any]]:
    events = []
    for line in raw.decode("utf-8-sig", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            events.append(obj)
    return events
