import { loadPlatformStore, nowIso, savePlatformStore } from "@/lib/store";

export const dynamic = "force-dynamic";

function checkToken(req: Request, expected: string, bodyToken?: unknown): boolean {
  const sp = new URL(req.url).searchParams;
  const headerToken = req.headers.get("x-aurum-token") ?? "";
  const queryToken = sp.get("token") ?? "";
  const candidate = String((bodyToken ?? headerToken) || queryToken);
  return Boolean(expected) && candidate === expected;
}

export async function GET(req: Request) {
  const store = loadPlatformStore();
  if (!checkToken(req, store.mt5Bridge.token)) {
    return Response.json({ ok: false, error: "Invalid MT5 bridge token" }, { status: 401 });
  }
  if (!store.mt5Bridge.enabled) {
    return Response.json({ ok: true, enabled: false, commands: [] });
  }

  store.mt5Bridge.lastHeartbeatAt = nowIso();
  const pending = store.mt5Bridge.queuedCommands.filter((c) => !c.delivered);
  for (const c of pending) c.delivered = true;
  savePlatformStore(store);

  return Response.json({
    ok: true,
    enabled: true,
    serverTime: nowIso(),
    commands: pending,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
    brokerName?: unknown;
    accountLogin?: unknown;
    accountServer?: unknown;
    terminalBuild?: unknown;
    balance?: unknown;
    equity?: unknown;
    executed?: {
      ticket?: unknown;
      symbol?: unknown;
      action?: unknown;
      price?: unknown;
      lots?: unknown;
      detail?: unknown;
    };
  };

  const store = loadPlatformStore();
  if (!checkToken(req, store.mt5Bridge.token, body.token)) {
    return Response.json({ ok: false, error: "Invalid MT5 bridge token" }, { status: 401 });
  }

  store.mt5Bridge.lastHeartbeatAt = nowIso();
  if (typeof body.brokerName === "string") store.mt5Bridge.brokerName = body.brokerName.slice(0, 80);
  if (body.accountLogin !== undefined) store.mt5Bridge.accountLogin = String(body.accountLogin).slice(0, 40);
  if (typeof body.accountServer === "string") store.mt5Bridge.accountServer = body.accountServer.slice(0, 80);
  if (body.terminalBuild !== undefined) store.mt5Bridge.terminalBuild = String(body.terminalBuild).slice(0, 30);
  if (Number.isFinite(Number(body.balance))) store.mt5Bridge.brokerBalance = Number(body.balance);
  if (Number.isFinite(Number(body.equity))) store.mt5Bridge.brokerEquity = Number(body.equity);

  if (body.executed && typeof body.executed === "object") {
    store.mt5Bridge.executedLog.unshift({
      at: nowIso(),
      ticket: String(body.executed.ticket ?? "0"),
      symbol: String(body.executed.symbol ?? "XAUUSD"),
      action: String(body.executed.action ?? "EXEC"),
      price: Number(body.executed.price ?? 0),
      lots: Number(body.executed.lots ?? 0),
      detail: String(body.executed.detail ?? "Filled by MT5 EA").slice(0, 160),
    });
    store.mt5Bridge.executedLog = store.mt5Bridge.executedLog.slice(0, 50);
  }

  const pending = store.mt5Bridge.queuedCommands.filter((c) => !c.delivered);
  for (const c of pending) c.delivered = true;
  savePlatformStore(store);

  return Response.json({
    ok: true,
    serverTime: nowIso(),
    commands: pending,
  });
}
