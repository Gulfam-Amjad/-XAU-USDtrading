import { loadPlatformStore, nowIso, savePlatformStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    botToken?: unknown;
    chatId?: unknown;
  };
  const store = loadPlatformStore();
  const token = (typeof body.botToken === "string" && body.botToken.trim()) || store.telegram.botToken;
  const chatId = (typeof body.chatId === "string" && body.chatId.trim()) || store.telegram.chatId;

  if (!token || !chatId) {
    return Response.json(
      {
        ok: false,
        error: "Enter both a Telegram Bot Token (from @BotFather) and your numeric Chat ID first.",
      },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          "AurumDesk Pro Connected\n" +
          "Live XAU/USD recommendation alerts, trade fills, and emergency risk-guard notifications are active.",
      }),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      return Response.json(
        { ok: false, error: data.description ?? `Telegram HTTP ${res.status}` },
        { status: 502 },
      );
    }
    store.telegram.botToken = token;
    store.telegram.chatId = chatId;
    store.telegram.enabled = true;
    store.telegram.lastSentAt = nowIso();
    savePlatformStore(store);
    return Response.json({ ok: true, message: "Test alert delivered to Telegram." });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Telegram request failed" },
      { status: 502 },
    );
  }
}
