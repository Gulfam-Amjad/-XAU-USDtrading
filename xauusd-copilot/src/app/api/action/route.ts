import { normalizeTf, refresh, runAction, type ActionName } from "@/lib/service";
import { getActiveAccount, loadPlatformStore, savePlatformStore } from "@/lib/store";
import { normalizeSymbol } from "@/lib/symbols";

export const dynamic = "force-dynamic";

const ACTIONS: ActionName[] = [
  "approve",
  "approveHalf",
  "reject",
  "simulateSetup",
  "placeOrder",
  "closeTrade",
  "partialClose",
  "breakEven",
  "modifyTrade",
  "cancelPending",
  "addAlert",
  "deleteAlert",
  "switchAccount",
  "createAccount",
  "resetAccount",
  "setStrategyPreset",
  "updateStrategyConfig",
  "updateJournal",
  "mode",
  "direction",
  "settings",
  "pause",
  "resumeTrading",
  "killSwitch",
  "resume",
  "closeAll",
  "propFirm",
  "updateBridge",
  "updateTelegram",
  "testTelegram",
  "updatePolicy",
  "sendReport",
];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    payload?: unknown;
    tf?: unknown;
    symbol?: unknown;
  };
  const action = String(body.action ?? "") as ActionName;
  if (!ACTIONS.includes(action)) return Response.json({ error: "Unknown action" }, { status: 400 });
  const payload = (typeof body.payload === "object" && body.payload !== null ? body.payload : {}) as Record<
    string,
    unknown
  >;
  const tf = normalizeTf(body.tf);
  const symbol = normalizeSymbol(body.symbol);

  const snap = await refresh(tf, symbol);
  const store = loadPlatformStore();
  const s = getActiveAccount(store);
  const message = runAction(action, payload, s, snap, store);
  savePlatformStore(store);

  const fresh = await refresh(tf, symbol);
  return Response.json({ message, snapshot: fresh });
}
