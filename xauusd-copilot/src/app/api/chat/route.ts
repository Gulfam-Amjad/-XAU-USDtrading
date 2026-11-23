import { handleChat } from "@/lib/copilot";
import { normalizeTf, refresh } from "@/lib/service";
import { getActiveAccount, loadPlatformStore, pushChat, savePlatformStore } from "@/lib/store";
import { normalizeSymbol } from "@/lib/symbols";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    tf?: unknown;
    symbol?: unknown;
  };
  const message = String(body.message ?? "").slice(0, 1000);
  if (!message.trim()) return Response.json({ error: "Type a message first." }, { status: 400 });
  const tf = normalizeTf(body.tf);
  const symbol = normalizeSymbol(body.symbol);

  const snap = await refresh(tf, symbol);
  const store = loadPlatformStore();
  const s = getActiveAccount(store);
  pushChat(s, "user", message);
  const out = await handleChat(message, s, snap, store);
  pushChat(s, "assistant", out.reply, out.card);
  savePlatformStore(store);

  const fresh = await refresh(tf, symbol);
  return Response.json({ reply: out.reply, card: out.card, snapshot: fresh });
}
