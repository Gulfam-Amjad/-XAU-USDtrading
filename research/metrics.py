"""Performance metrics shared by the backtester and the live reports."""

from __future__ import annotations

import math
from typing import Iterable, Sequence


def max_drawdown_pct(equity: Sequence[float]) -> float:
    peak = -math.inf
    worst = 0.0
    for v in equity:
        peak = max(peak, v)
        if peak > 0:
            worst = max(worst, (peak - v) / peak * 100.0)
    return worst


def max_consecutive_losses(pnls: Iterable[float]) -> int:
    run = best = 0
    for p in pnls:
        if p < 0:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


def summarize(pnls: Sequence[float], r_multiples: Sequence[float] | None = None,
              start_balance: float | None = None) -> dict[str, float]:
    """pnls in account currency, in chronological order."""
    pnls = [float(p) for p in pnls]
    n = len(pnls)
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_win = sum(wins)
    gross_loss = -sum(losses)

    out: dict[str, float] = {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": (len(wins) / n * 100.0) if n else 0.0,
        "net": sum(pnls),
        "gross_win": gross_win,
        "gross_loss": gross_loss,
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else (math.inf if gross_win > 0 else 0.0),
        "avg_win": (gross_win / len(wins)) if wins else 0.0,
        "avg_loss": (-gross_loss / len(losses)) if losses else 0.0,
        "largest_win": max(wins) if wins else 0.0,
        "largest_loss": min(losses) if losses else 0.0,
        "max_consecutive_losses": max_consecutive_losses(pnls),
    }
    out["payoff_ratio"] = (out["avg_win"] / -out["avg_loss"]) if out["avg_loss"] < 0 else 0.0

    if r_multiples is not None and len(r_multiples):
        rs = [float(r) for r in r_multiples]
        out["expectancy_r"] = sum(rs) / len(rs)
        out["total_r"] = sum(rs)
    else:
        out["expectancy_r"] = 0.0
        out["total_r"] = 0.0

    if start_balance:
        equity = [start_balance]
        for p in pnls:
            equity.append(equity[-1] + p)
        out["start_balance"] = start_balance
        out["end_balance"] = equity[-1]
        out["return_pct"] = (equity[-1] - start_balance) / start_balance * 100.0
        out["max_drawdown_pct"] = max_drawdown_pct(equity)
    return out


def format_summary(m: dict[str, float]) -> str:
    pf = m.get("profit_factor", 0.0)
    pf_s = "inf" if math.isinf(pf) else f"{pf:.2f}"
    lines = [
        f"Trades:               {int(m.get('trades', 0))}",
        f"Win rate:             {m.get('win_rate_pct', 0):.1f}%",
        f"Profit factor:        {pf_s}",
        f"Expectancy:           {m.get('expectancy_r', 0):.2f} R per trade",
        f"Average win / loss:   {m.get('avg_win', 0):,.2f} / {m.get('avg_loss', 0):,.2f}",
        f"Largest win / loss:   {m.get('largest_win', 0):,.2f} / {m.get('largest_loss', 0):,.2f}",
        f"Max losing streak:    {int(m.get('max_consecutive_losses', 0))}",
        f"Net result:           {m.get('net', 0):,.2f}",
    ]
    if "return_pct" in m:
        lines.append(f"Return:               {m['return_pct']:.2f}%")
        lines.append(f"Max drawdown:         {m['max_drawdown_pct']:.2f}%")
    return "\n".join(lines)
