import { backtestFor, normalizeTf } from "@/lib/service";
import { normalizeSymbol } from "@/lib/symbols";
import type { StrategyId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const symbol = normalizeSymbol(sp.get("symbol") ?? "XAUUSD");
  const timeframe = normalizeTf(sp.get("tf") ?? "1d");
  const strategyId = (sp.get("strategyId") ?? undefined) as StrategyId | undefined;
  const riskPct = sp.get("riskPct") ? Number(sp.get("riskPct")) : undefined;
  const rr = sp.get("rr") ? Number(sp.get("rr")) : undefined;
  const spread = sp.get("spread") ? Number(sp.get("spread")) : undefined;
  const slippage = sp.get("slippage") ? Number(sp.get("slippage")) : undefined;
  const partialTp = sp.get("partialTp") !== null ? sp.get("partialTp") === "true" : undefined;

  try {
    const result = await backtestFor({
      symbol,
      timeframe,
      strategyId,
      riskPct,
      rr,
      spread,
      slippage,
      partialTp,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Backtest failed" }, { status: 502 });
  }
}
