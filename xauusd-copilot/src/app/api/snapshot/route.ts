import { normalizeTf, refresh } from "@/lib/service";
import { normalizeSymbol } from "@/lib/symbols";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tf = normalizeTf(sp.get("tf"));
  const symbol = normalizeSymbol(sp.get("symbol"));
  const snap = await refresh(tf, symbol);
  return Response.json(snap);
}
