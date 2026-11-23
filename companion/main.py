"""Entry point: python -m companion.main --config companion/config.yaml"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import yaml

from .bridge import Bridge


def load_config(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    tg = cfg.get("telegram") or {}
    if not tg.get("token") or "PUT-" in str(tg.get("token")):
        raise SystemExit("Set telegram.token in the config file (from @BotFather).")
    if not tg.get("allowed_chat_ids"):
        raise SystemExit("Set telegram.allowed_chat_ids in the config file (see docs/SETUP.md).")
    return cfg


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="GoldGuardian Telegram companion")
    parser.add_argument("--config", default="companion/config.yaml")
    parser.add_argument("--replay-events", action="store_true",
                        help="send events already in the log (default: only new events)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        stream=sys.stdout)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    cfg = load_config(args.config)
    bridge = Bridge(cfg.get("bridge_dir") or None, cfg.get("data_dir", "companion_data"))
    if not bridge.dir.exists():
        logging.warning("Bridge folder %s does not exist yet. Start the EA in MT5 first.", bridge.dir)
    if not args.replay_events:
        bridge.skip_existing_events()

    from .telegram_bot import GoldGuardianBot

    GoldGuardianBot(cfg, bridge).run()


if __name__ == "__main__":
    main()
