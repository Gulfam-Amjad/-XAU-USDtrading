import fs from "node:fs";
import path from "node:path";
import {
  buildCleanPaperAccount,
  buildShowcaseAccount,
  DEFAULT_SETTINGS,
  defaultStrategy,
} from "./seed";
import { normalizePolicy } from "./policy";
import { formatPrice, marginRequiredUsd, SYMBOL_SPECS, usdPerPriceUnit } from "./symbols";
import type {
  AccountProfile,
  AuditEntry,
  ChatCard,
  ChatMessage,
  DailyPnlCell,
  Message,
  MessageKind,
  OrderType,
  PendingOrder,
  PlatformStore,
  Proposal,
  Quote,
  SessionPerf,
  Side,
  Stats,
  StrategyId,
  SymbolCode,
  Trade,
  TradePlan,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "platform-v2.json");

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundPrice(symbol: SymbolCode, price: number): number {
  const f = 10 ** SYMBOL_SPECS[symbol].decimals;
  return Math.round(price * f) / f;
}

export function freshPlatformStore(): PlatformStore {
  const showcase = buildShowcaseAccount();
  const clean = buildCleanPaperAccount();
  return {
    version: 2,
    activeAccountId: showcase.id,
    accounts: [showcase, clean],
    mt5Bridge: {
      token: "aurum_" + uid() + uid(),
      enabled: true,
      autoForwardApproved: true,
      lastHeartbeatAt: null,
      brokerName: "",
      accountLogin: "",
      accountServer: "",
      terminalBuild: "",
      brokerBalance: null,
      brokerEquity: null,
      queuedCommands: [],
      executedLog: [],
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID ?? "",
      enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      forwardSignals: true,
      forwardTrades: true,
      lastSentAt: null,
    },
  };
}

export function loadPlatformStore(): PlatformStore {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PlatformStore>;
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
      const fresh = freshPlatformStore();
      savePlatformStore(fresh);
      return fresh;
    }
    const base = freshPlatformStore();
    const accounts = parsed.accounts.map((acc) => ({
      ...buildCleanPaperAccount(acc.id, acc.name, acc.settings?.startingBalance ?? 10000),
      ...acc,
      settings: { ...DEFAULT_SETTINGS, ...(acc.settings ?? {}) },
      strategy: { ...defaultStrategy(acc.strategy?.activeStrategy ?? "trend_pullback"), ...(acc.strategy ?? {}) },
      policy: normalizePolicy(acc.policy),
    }));
    const activeExists = accounts.some((a) => a.id === parsed.activeAccountId);
    return {
      version: 2,
      activeAccountId: activeExists ? (parsed.activeAccountId as string) : accounts[0].id,
      accounts,
      mt5Bridge: { ...base.mt5Bridge, ...(parsed.mt5Bridge ?? {}) },
      telegram: { ...base.telegram, ...(parsed.telegram ?? {}) },
    };
  } catch {
    const fresh = freshPlatformStore();
    savePlatformStore(fresh);
    return fresh;
  }
}

export function savePlatformStore(store: PlatformStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function getActiveAccount(store: PlatformStore): AccountProfile {
  return store.accounts.find((a) => a.id === store.activeAccountId) ?? store.accounts[0];
}

// Backwards-compatible helpers used by tests/utilities
export function freshState(): AccountProfile {
  return buildCleanPaperAccount("test-10k", "Test Paper", 10000, false, "Custom");
}

export function loadState(): AccountProfile {
  const store = loadPlatformStore();
  return getActiveAccount(store);
}

export function saveState(acc: AccountProfile): void {
  const store = loadPlatformStore();
  const idx = store.accounts.findIndex((a) => a.id === acc.id);
  if (idx >= 0) store.accounts[idx] = acc;
  else store.accounts.push(acc);
  savePlatformStore(store);
}

export function pushAudit(s: AccountProfile, action: string, detail: string): void {
  const entry: AuditEntry = { at: nowIso(), action, detail };
  s.audit.unshift(entry);
  s.audit = s.audit.slice(0, 300);
}

export function pushMessage(s: AccountProfile, kind: MessageKind, text: string, symbol?: SymbolCode): void {
  const m: Message = { id: uid(), at: nowIso(), symbol, kind, text };
  s.messages.unshift(m);
  s.messages = s.messages.slice(0, 200);
}

export function pushChat(
  s: AccountProfile,
  role: "user" | "assistant",
  text: string,
  card?: ChatCard,
): ChatMessage {
  const m: ChatMessage = { id: uid(), role, text, at: nowIso(), card };
  s.chat.push(m);
  s.chat = s.chat.slice(-80);
  return m;
}

export function pnlForLots(symbol: SymbolCode, side: Side, entry: number, exit: number, lots: number): number {
  const dir = side === "BUY" ? 1 : -1;
  const unitVal = usdPerPriceUnit(symbol, exit || entry);
  return round2((exit - entry) * dir * lots * unitVal);
}

export function pnlFor(
  t: Pick<Trade, "side" | "entry" | "lots"> & { symbol?: SymbolCode; realizedPartialPnl?: number },
  exit: number,
): number {
  const sym = t.symbol ?? "XAUUSD";
  return round2(pnlForLots(sym, t.side, t.entry, exit, t.lots) + (t.realizedPartialPnl ?? 0));
}

export function queueMt5Command(
  store: PlatformStore,
  cmd: Omit<PlatformStore["mt5Bridge"]["queuedCommands"][number], "id" | "createdAt" | "delivered">,
): void {
  if (!store.mt5Bridge.enabled || !store.mt5Bridge.autoForwardApproved) return;
  store.mt5Bridge.queuedCommands.push({
    ...cmd,
    id: uid(),
    createdAt: nowIso(),
    delivered: false,
  });
  store.mt5Bridge.queuedCommands = store.mt5Bridge.queuedCommands.slice(-100);
}

export async function forwardTelegramIfEnabled(store: PlatformStore, text: string): Promise<void> {
  const tg = store.telegram;
  if (!tg.enabled || !tg.botToken || !tg.chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tg.chatId, text: `[AurumDesk Pro]\n${text}` }),
    });
    if (res.ok) tg.lastSentAt = nowIso();
  } catch {
    /* non-blocking */
  }
}

export function openTrade(
  s: AccountProfile,
  plan: Partial<TradePlan> & Pick<TradePlan, "side" | "entry" | "stopLoss" | "takeProfit" | "lots" | "riskAmount">,
  reason: string,
  approvedBy: Trade["approvedBy"],
  opts?: { strategyId?: StrategyId; session?: string; store?: PlatformStore },
): Trade {
  const symbol: SymbolCode = plan.symbol ?? "XAUUSD";
  const entry = roundPrice(symbol, plan.entry);
  const stopLoss = roundPrice(symbol, plan.stopLoss);
  const takeProfit = roundPrice(symbol, plan.takeProfit);
  const tp1Price =
    plan.tp1Price !== undefined && plan.tp1Price !== null ? roundPrice(symbol, plan.tp1Price) : null;
  const trailingDistance = plan.trailingDistance ?? null;
  const marginUsed = plan.marginRequired ?? marginRequiredUsd(symbol, plan.lots, entry);

  const t: Trade = {
    id: uid(),
    symbol,
    side: plan.side,
    entry,
    stopLoss,
    tp1Price,
    tp1Hit: false,
    takeProfit,
    initialLots: plan.lots,
    lots: plan.lots,
    realizedPartialPnl: 0,
    breakEvenMoved: false,
    trailingDistance,
    riskAmount: round2(plan.riskAmount),
    marginUsed,
    openedAt: nowIso(),
    closedAt: null,
    exitPrice: null,
    pnl: 0,
    rMultiple: 0,
    status: "open",
    closeReason: "",
    approvedBy,
    strategyId: opts?.strategyId ?? s.strategy.activeStrategy,
    session: opts?.session ?? "Active session",
    reason,
    tags: approvedBy === "manual" ? ["Manual"] : approvedBy === "simulated" ? ["Demo Sim"] : ["Followed Plan"],
    notes: "",
  };
  s.trades.unshift(t);

  const sourceLabel =
    approvedBy === "auto"
      ? "auto mode (within limits)"
      : approvedBy === "manual"
        ? "manual order ticket"
        : approvedBy === "simulated"
          ? "simulated demo approval"
          : "your approval";
  const msg = `${symbol} ${plan.side} ${plan.lots.toFixed(2)} lots opened at ${formatPrice(symbol, entry)}. SL ${formatPrice(symbol, stopLoss)}${tp1Price ? ` | TP1 ${formatPrice(symbol, tp1Price)}` : ""} | TP ${formatPrice(symbol, takeProfit)} | Risk $${t.riskAmount.toFixed(2)}. Source: ${sourceLabel}.`;
  pushMessage(s, "TRADE_OPENED", msg, symbol);
  pushAudit(s, "trade.open", `${symbol} ${plan.side} ${plan.lots} lots @ ${formatPrice(symbol, entry)} (${approvedBy})`);

  if (opts?.store) {
    queueMt5Command(opts.store, {
      type: "OPEN",
      symbol,
      side: plan.side,
      lots: plan.lots,
      entry,
      stopLoss,
      takeProfit,
      comment: `AurumDesk:${approvedBy}`,
    });
    if (opts.store.telegram.forwardTrades) void forwardTelegramIfEnabled(opts.store, msg);
  }
  return t;
}

export function closeTrade(
  s: AccountProfile,
  t: Trade,
  exit: number,
  reason: string,
  store?: PlatformStore,
): void {
  if (t.status === "closed") return;
  const remainingPnl = pnlForLots(t.symbol, t.side, t.entry, exit, t.lots);
  const totalPnl = round2(remainingPnl + t.realizedPartialPnl);
  t.status = "closed";
  t.exitPrice = roundPrice(t.symbol, exit);
  t.closedAt = nowIso();
  t.pnl = totalPnl;
  t.rMultiple = t.riskAmount > 0 ? round2(totalPnl / t.riskAmount) : 0;
  t.closeReason = reason;
  // Note: realizedPartialPnl was already added to s.balance at TP1/partial-close time!
  s.balance = round2(s.balance + remainingPnl);
  s.equityPeak = Math.max(s.equityPeak, s.balance);
  const sign = totalPnl >= 0 ? "+" : "-";
  const msg = `${t.symbol} ${t.side} closed at ${formatPrice(t.symbol, exit)} (${reason}). Total result ${sign}$${Math.abs(totalPnl).toFixed(2)} (${t.rMultiple.toFixed(2)}R).`;
  pushMessage(s, "TRADE_CLOSED", msg, t.symbol);
  pushAudit(s, "trade.close", `${t.symbol} ${t.side} @ ${formatPrice(t.symbol, exit)} ${reason} pnl ${totalPnl}`);
  if (store && store.telegram.forwardTrades) void forwardTelegramIfEnabled(store, msg);
}

export function partialCloseTrade(s: AccountProfile, tradeId: string, q: Quote, fraction = 0.5): string {
  const t = s.trades.find((x) => x.id === tradeId && x.status === "open");
  if (!t) return "Open trade not found.";
  const exit = t.side === "BUY" ? q.bid : q.ask;
  const closeLots = Math.max(0.01, Math.floor(t.lots * fraction * 100) / 100);
  if (closeLots >= t.lots || t.lots <= 0.01) {
    closeTrade(s, t, exit, "Manual full close");
    return `Position had minimum size, so closed 100% at ${formatPrice(t.symbol, exit)}.`;
  }
  const realized = pnlForLots(t.symbol, t.side, t.entry, exit, closeLots);
  t.lots = round2(t.lots - closeLots);
  t.tp1Hit = true;
  t.realizedPartialPnl = round2(t.realizedPartialPnl + realized);
  t.marginUsed = marginRequiredUsd(t.symbol, t.lots, t.entry);
  s.balance = round2(s.balance + realized);
  s.equityPeak = Math.max(s.equityPeak, s.balance);
  if (!t.tags.includes("Partial TP")) t.tags.push("Partial TP");
  const sign = realized >= 0 ? "+" : "-";
  pushMessage(
    s,
    "INFO",
    `Closed ${closeLots.toFixed(2)} lots (50%) of ${t.symbol} ${t.side} at ${formatPrice(t.symbol, exit)}, banking ${sign}$${Math.abs(realized).toFixed(2)}. ${t.lots.toFixed(2)} lots still running.`,
    t.symbol,
  );
  pushAudit(s, "trade.partial", `${t.symbol} closed ${closeLots} lots @ ${formatPrice(t.symbol, exit)} (${realized})`);
  return `Banked ${sign}$${Math.abs(realized).toFixed(2)} on ${closeLots.toFixed(2)} lots. ${t.lots.toFixed(2)} lots remain open.`;
}

export function moveTradeBreakEven(s: AccountProfile, tradeId: string, q: Quote): string {
  const t = s.trades.find((x) => x.id === tradeId && x.status === "open");
  if (!t) return "Open trade not found.";
  const pip = SYMBOL_SPECS[t.symbol].pipSize;
  const bePrice = roundPrice(t.symbol, t.side === "BUY" ? t.entry + pip : t.entry - pip);
  if (t.side === "BUY" && q.bid <= bePrice) {
    return `Cannot move BUY stop to break-even (${formatPrice(t.symbol, bePrice)}) until bid (${formatPrice(t.symbol, q.bid)}) is in profit above entry.`;
  }
  if (t.side === "SELL" && q.ask >= bePrice) {
    return `Cannot move SELL stop to break-even (${formatPrice(t.symbol, bePrice)}) until ask (${formatPrice(t.symbol, q.ask)}) is in profit below entry.`;
  }
  t.stopLoss = bePrice;
  t.breakEvenMoved = true;
  if (!t.tags.includes("Break-Even")) t.tags.push("Break-Even");
  pushAudit(s, "trade.breakeven", `${t.symbol} ${t.side} SL moved to ${formatPrice(t.symbol, bePrice)}`);
  return `${t.symbol} ${t.side} Stop Loss locked at Break-Even (${formatPrice(t.symbol, bePrice)}). Risk on remaining ${t.lots.toFixed(2)} lots is now $0.`;
}

export function modifyTradeProtection(
  s: AccountProfile,
  tradeId: string,
  stopLoss: number,
  takeProfit: number,
  trailingDistance: number | null,
): string {
  const t = s.trades.find((x) => x.id === tradeId && x.status === "open");
  if (!t) return "Open trade not found.";
  if (!(stopLoss > 0) || !(takeProfit > 0)) return "Stop loss and take profit must be positive prices.";
  if (t.side === "BUY" && stopLoss >= takeProfit) return "For a BUY, Stop Loss must be below Take Profit.";
  if (t.side === "SELL" && stopLoss <= takeProfit) return "For a SELL, Stop Loss must be above Take Profit.";
  t.stopLoss = roundPrice(t.symbol, stopLoss);
  t.takeProfit = roundPrice(t.symbol, takeProfit);
  t.trailingDistance = trailingDistance && trailingDistance > 0 ? trailingDistance : null;
  pushAudit(
    s,
    "trade.modify",
    `${t.symbol} SL=${formatPrice(t.symbol, t.stopLoss)} TP=${formatPrice(t.symbol, t.takeProfit)} trail=${t.trailingDistance ?? "off"}`,
  );
  return `Updated ${t.symbol} ${t.side}: SL ${formatPrice(t.symbol, t.stopLoss)}, TP ${formatPrice(t.symbol, t.takeProfit)}${t.trailingDistance ? `, Trailing ${t.trailingDistance}` : ""}.`;
}

export function placePendingOrder(
  s: AccountProfile,
  input: {
    symbol: SymbolCode;
    orderType: Exclude<OrderType, "MARKET">;
    triggerPrice: number;
    stopLoss: number;
    tp1Price: number | null;
    takeProfit: number;
    lots: number;
    riskAmount: number;
    trailingDistance: number | null;
    reason: string;
    source: "manual" | "ai";
  },
): PendingOrder {
  const side: Side = input.orderType.startsWith("BUY") ? "BUY" : "SELL";
  const po: PendingOrder = {
    id: uid(),
    symbol: input.symbol,
    orderType: input.orderType,
    side,
    triggerPrice: roundPrice(input.symbol, input.triggerPrice),
    stopLoss: roundPrice(input.symbol, input.stopLoss),
    tp1Price: input.tp1Price ? roundPrice(input.symbol, input.tp1Price) : null,
    takeProfit: roundPrice(input.symbol, input.takeProfit),
    lots: input.lots,
    riskAmount: round2(input.riskAmount),
    trailingDistance: input.trailingDistance,
    createdAt: nowIso(),
    expiresAt: null,
    reason: input.reason,
    source: input.source,
  };
  s.pendingOrders.unshift(po);
  pushMessage(
    s,
    "INFO",
    `Pending ${po.orderType.replace("_", " ")} placed on ${po.symbol}: ${po.lots.toFixed(2)} lots @ ${formatPrice(po.symbol, po.triggerPrice)} (SL ${formatPrice(po.symbol, po.stopLoss)}, TP ${formatPrice(po.symbol, po.takeProfit)}).`,
    po.symbol,
  );
  pushAudit(s, "order.pending", `${po.symbol} ${po.orderType} ${po.lots} @ ${formatPrice(po.symbol, po.triggerPrice)}`);
  return po;
}

// Evaluates single-symbol open positions (backwards-compatible signature used by tests)
export function managePositions(s: AccountProfile, q: Quote, store?: PlatformStore): void {
  const map = new Map<SymbolCode, Quote>([[q.symbol ?? "XAUUSD", { ...q, symbol: q.symbol ?? "XAUUSD" }]]);
  managePositionsMulti(s, map, store);
}

export function managePositionsMulti(
  s: AccountProfile,
  quotes: Map<SymbolCode, Quote>,
  store?: PlatformStore,
): void {
  // 1. Trigger pending orders if live price crosses trigger
  const remainingPending: PendingOrder[] = [];
  for (const po of s.pendingOrders) {
    const q = quotes.get(po.symbol);
    if (!q || s.settings.killSwitch) {
      remainingPending.push(po);
      continue;
    }
    const openCount = s.trades.filter((t) => t.status === "open").length;
    if (openCount >= s.settings.maxOpenTrades) {
      remainingPending.push(po);
      continue;
    }
    const triggered =
      (po.orderType === "BUY_LIMIT" && q.ask <= po.triggerPrice) ||
      (po.orderType === "BUY_STOP" && q.ask >= po.triggerPrice) ||
      (po.orderType === "SELL_LIMIT" && q.bid >= po.triggerPrice) ||
      (po.orderType === "SELL_STOP" && q.bid <= po.triggerPrice);

    if (triggered) {
      openTrade(
        s,
        {
          symbol: po.symbol,
          side: po.side,
          entry: po.triggerPrice,
          stopLoss: po.stopLoss,
          tp1Price: po.tp1Price,
          takeProfit: po.takeProfit,
          riskDistance: Math.abs(po.triggerPrice - po.stopLoss),
          rewardRatio: 2,
          lots: po.lots,
          riskAmount: po.riskAmount,
          marginRequired: marginRequiredUsd(po.symbol, po.lots, po.triggerPrice),
          trailingDistance: po.trailingDistance,
        },
        `Pending ${po.orderType.replace("_", " ")} triggered`,
        "manual",
        { store },
      );
    } else {
      remainingPending.push(po);
    }
  }
  s.pendingOrders = remainingPending;

  // 2. Check custom Price Alerts
  for (const al of s.priceAlerts) {
    if (!al.active) continue;
    const q = quotes.get(al.symbol);
    if (!q) continue;
    const hit =
      (al.condition === "ABOVE" && q.mid >= al.targetPrice) ||
      (al.condition === "BELOW" && q.mid <= al.targetPrice);
    if (hit) {
      al.active = false;
      al.triggeredAt = nowIso();
      const txt = `PRICE ALERT: ${al.symbol} crossed ${al.condition} ${formatPrice(al.symbol, al.targetPrice)} (now ${formatPrice(al.symbol, q.mid)}). ${al.note}`;
      pushMessage(s, "PRICE_ALERT", txt, al.symbol);
      pushAudit(s, "alert.triggered", txt);
      if (store && store.telegram.forwardSignals) void forwardTelegramIfEnabled(store, txt);
    }
  }

  // 3. Manage open positions: Stop Loss -> Final TP -> Partial TP1 + Break-Even -> Trailing Stop
  for (const t of s.trades) {
    if (t.status !== "open") continue;
    const sym = t.symbol ?? "XAUUSD";
    const q = quotes.get(sym);
    if (!q) continue;

    if (t.side === "BUY") {
      if (q.bid <= t.stopLoss) {
        closeTrade(
          s,
          t,
          t.stopLoss,
          t.breakEvenMoved && t.stopLoss >= t.entry ? "Break-even / Trailing stop hit" : "Stop loss hit",
          store,
        );
        continue;
      }
      if (q.bid >= t.takeProfit) {
        closeTrade(s, t, t.takeProfit, "Take profit hit", store);
        continue;
      }
      // TP1 partial take-profit + auto Break-Even
      if (!t.tp1Hit && t.tp1Price && q.bid >= t.tp1Price && t.lots >= 0.02) {
        t.tp1Hit = true;
        const halfLots = Math.max(0.01, Math.floor(t.lots * 0.5 * 100) / 100);
        const banked = pnlForLots(sym, "BUY", t.entry, t.tp1Price, halfLots);
        t.lots = round2(t.lots - halfLots);
        t.realizedPartialPnl = round2(t.realizedPartialPnl + banked);
        t.stopLoss = t.entry;
        t.breakEvenMoved = true;
        s.balance = round2(s.balance + banked);
        s.equityPeak = Math.max(s.equityPeak, s.balance);
        pushMessage(
          s,
          "INFO",
          `${sym} BUY hit TP1 (${formatPrice(sym, t.tp1Price)}): banked +$${banked.toFixed(2)} on ${halfLots.toFixed(2)} lots and moved SL to Break-Even (${formatPrice(sym, t.entry)}).`,
          sym,
        );
      }
      // Trailing Stop ratchet
      if (t.trailingDistance && t.trailingDistance > 0) {
        const candidateSl = roundPrice(sym, q.bid - t.trailingDistance);
        if (candidateSl > t.stopLoss && candidateSl > t.entry) {
          t.stopLoss = candidateSl;
          t.breakEvenMoved = true;
        }
      }
    } else {
      if (q.ask >= t.stopLoss) {
        closeTrade(
          s,
          t,
          t.stopLoss,
          t.breakEvenMoved && t.stopLoss <= t.entry ? "Break-even / Trailing stop hit" : "Stop loss hit",
          store,
        );
        continue;
      }
      if (q.ask <= t.takeProfit) {
        closeTrade(s, t, t.takeProfit, "Take profit hit", store);
        continue;
      }
      if (!t.tp1Hit && t.tp1Price && q.ask <= t.tp1Price && t.lots >= 0.02) {
        t.tp1Hit = true;
        const halfLots = Math.max(0.01, Math.floor(t.lots * 0.5 * 100) / 100);
        const banked = pnlForLots(sym, "SELL", t.entry, t.tp1Price, halfLots);
        t.lots = round2(t.lots - halfLots);
        t.realizedPartialPnl = round2(t.realizedPartialPnl + banked);
        t.stopLoss = t.entry;
        t.breakEvenMoved = true;
        s.balance = round2(s.balance + banked);
        s.equityPeak = Math.max(s.equityPeak, s.balance);
        pushMessage(
          s,
          "INFO",
          `${sym} SELL hit TP1 (${formatPrice(sym, t.tp1Price)}): banked +$${banked.toFixed(2)} on ${halfLots.toFixed(2)} lots and moved SL to Break-Even (${formatPrice(sym, t.entry)}).`,
          sym,
        );
      }
      if (t.trailingDistance && t.trailingDistance > 0) {
        const candidateSl = roundPrice(sym, q.ask + t.trailingDistance);
        if (candidateSl < t.stopLoss && candidateSl < t.entry) {
          t.stopLoss = candidateSl;
          t.breakEvenMoved = true;
        }
      }
    }
  }
}

export function closeAll(
  s: AccountProfile,
  quotesOrSingle: Quote | Map<SymbolCode, Quote>,
  reason: string,
  store?: PlatformStore,
): number {
  const map =
    quotesOrSingle instanceof Map
      ? quotesOrSingle
      : new Map<SymbolCode, Quote>([[quotesOrSingle.symbol ?? "XAUUSD", quotesOrSingle]]);
  let n = 0;
  for (const t of s.trades) {
    if (t.status !== "open") continue;
    const q = map.get(t.symbol ?? "XAUUSD") ?? [...map.values()][0];
    const exit = q ? (t.side === "BUY" ? q.bid : q.ask) : t.entry;
    closeTrade(s, t, exit, reason, store);
    n++;
  }
  return n;
}

export function createSimulatedProposal(
  s: AccountProfile,
  q: Quote,
  side: Side,
  atrFallback: number,
): Proposal {
  const sym = q.symbol;
  const entry = side === "BUY" ? q.ask : q.bid;
  const defaultDist =
    sym === "XAUUSD"
      ? Math.max(8, round2(atrFallback || 12))
      : sym === "XAGUSD"
        ? 0.35
        : sym === "BTCUSD"
          ? 450
          : sym === "USDJPY"
            ? 0.45
            : 0.0025;
  const sl = roundPrice(sym, side === "BUY" ? entry - defaultDist : entry + defaultDist);
  const rr = s.strategy.rewardRatio || 2;
  const tp1 = s.strategy.partialTpEnabled
    ? roundPrice(sym, side === "BUY" ? entry + defaultDist * s.strategy.tp1R : entry - defaultDist * s.strategy.tp1R)
    : null;
  const tp = roundPrice(sym, side === "BUY" ? entry + defaultDist * rr : entry - defaultDist * rr);
  const riskAmount = round2((s.balance * s.settings.riskPct) / 100);
  const unitVal = usdPerPriceUnit(sym, entry);
  const rawLots = riskAmount / (defaultDist * unitVal);
  const lots = Math.max(0.01, Math.min(SYMBOL_SPECS[sym].maxLot, Math.floor(rawLots * 100) / 100));

  const plan: TradePlan = {
    symbol: sym,
    side,
    entry,
    stopLoss: sl,
    tp1Price: tp1,
    takeProfit: tp,
    riskDistance: defaultDist,
    rewardRatio: rr,
    lots,
    riskAmount,
    marginRequired: marginRequiredUsd(sym, lots, entry),
    trailingDistance: s.strategy.trailingStopAtr > 0 ? roundPrice(sym, defaultDist * 0.8) : null,
  };

  const now = Date.now();
  const prop: Proposal = {
    id: uid(),
    symbol: sym,
    plan,
    strategyId: s.strategy.activeStrategy,
    strategyName: `${s.strategy.activeStrategy} (Live Demo Simulation)`,
    score: 94,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60000).toISOString(),
    reason: `Simulated live ${side} setup anchored to real ${sym} market quote (${formatPrice(sym, entry)}) for interactive approval walkthrough`,
    simulated: true,
    gatesSummary: [
      "HTF Trend aligned",
      "15m Momentum confirmed",
      `${rr.toFixed(1)}R structure target clear`,
      "Risk Guard & Spread within limits",
    ],
  };
  s.proposal = prop;
  pushMessage(
    s,
    side === "BUY" ? "BUY_ALERT" : "SELL_ALERT",
    `[DEMO SETUP READY] ${sym} ${side} ${lots.toFixed(2)} lots @ ${formatPrice(sym, entry)} | SL ${formatPrice(sym, sl)}${tp1 ? ` | TP1 ${formatPrice(sym, tp1)}` : ""} | TP ${formatPrice(sym, tp)} | Risk $${riskAmount.toFixed(2)} (${s.settings.riskPct}%). Click Approve in the Ticket or Copilot to test live execution.`,
    sym,
  );
  pushAudit(s, "proposal.simulated", `Simulated ${sym} ${side} proposal @ ${formatPrice(sym, entry)}`);
  return prop;
}

export function computeStats(
  s: AccountProfile,
  quotesOrMid: number | Map<SymbolCode, Quote>,
): Stats {
  const closed = s.trades
    .filter((t) => t.status === "closed")
    .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "") || a.openedAt.localeCompare(b.openedAt));

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const breakevens = closed.filter((t) => t.pnl === 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? round2(grossWin / grossLoss) : grossWin > 0 ? 99 : 0;
  const averageR = closed.length ? round2(closed.reduce((a, t) => a + t.rMultiple, 0) / closed.length) : 0;
  const netPnl = round2(closed.reduce((a, t) => a + t.pnl, 0));
  const expectancyUsd = closed.length ? round2(netPnl / closed.length) : 0;
  const avgWinUsd = wins.length ? round2(grossWin / wins.length) : 0;
  const avgLossUsd = losses.length ? round2(-grossLoss / losses.length) : 0;
  const bestTradeUsd = closed.length ? round2(Math.max(...closed.map((t) => t.pnl))) : 0;
  const worstTradeUsd = closed.length ? round2(Math.min(...closed.map((t) => t.pnl))) : 0;

  // Sharpe across closed trades (annualized approx)
  let sharpeRatio = 0;
  if (closed.length >= 3) {
    const rets = closed.map((t) => t.pnl / Math.max(1, s.settings.startingBalance));
    const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
    const variance = rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) sharpeRatio = round2((mean / std) * Math.sqrt(Math.min(252, closed.length * 10)));
  }

  // Consecutive streaks
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let curW = 0;
  let curL = 0;
  for (const t of closed) {
    if (t.pnl > 0) {
      curW++;
      curL = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, curW);
    } else if (t.pnl < 0) {
      curL++;
      curW = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, curL);
    }
  }

  // Long vs short
  const longs = closed.filter((t) => t.side === "BUY");
  const shorts = closed.filter((t) => t.side === "SELL");
  const longWinRate = longs.length ? round2((longs.filter((t) => t.pnl > 0).length / longs.length) * 100) : 0;
  const shortWinRate = shorts.length ? round2((shorts.filter((t) => t.pnl > 0).length / shorts.length) * 100) : 0;

  const todayKey = nowIso().slice(0, 10);
  const since = (ms: number) =>
    closed.filter((t) => Date.parse(t.closedAt ?? "") >= ms).reduce((a, t) => a + t.pnl, 0);
  const todayPnl = closed.filter((t) => (t.closedAt ?? "").startsWith(todayKey)).reduce((a, t) => a + t.pnl, 0);

  let bal = s.settings.startingBalance;
  let peak = bal;
  let maxDd = 0;
  const dayMap = new Map<string, DailyPnlCell>();
  const sessMap = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const t of closed) {
    bal += t.pnl;
    peak = Math.max(peak, bal);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - bal) / peak) * 100);

    const day = (t.closedAt ?? t.openedAt).slice(0, 10);
    const cell = dayMap.get(day) ?? { date: day, pnl: 0, trades: 0, wins: 0 };
    cell.pnl = round2(cell.pnl + t.pnl);
    cell.trades += 1;
    if (t.pnl > 0) cell.wins += 1;
    dayMap.set(day, cell);

    const sess = t.session || "Other";
    const sp = sessMap.get(sess) ?? { trades: 0, wins: 0, pnl: 0 };
    sp.trades += 1;
    if (t.pnl > 0) sp.wins += 1;
    sp.pnl = round2(sp.pnl + t.pnl);
    sessMap.set(sess, sp);
  }

  // Open floating P&L & margin
  let openFloating = 0;
  let usedMargin = 0;
  for (const t of s.trades) {
    if (t.status !== "open") continue;
    const sym = t.symbol ?? "XAUUSD";
    let markPrice = t.entry;
    if (typeof quotesOrMid === "number") {
      markPrice = quotesOrMid || t.entry;
    } else {
      const q = quotesOrMid.get(sym);
      if (q) markPrice = t.side === "BUY" ? q.bid : q.ask;
    }
    // Floating P&L on remaining open lots only (realizedPartialPnl is already in balance)
    openFloating += pnlForLots(sym, t.side, t.entry, markPrice, t.lots);
    usedMargin += t.marginUsed || marginRequiredUsd(sym, t.lots, t.entry);
  }
  openFloating = round2(openFloating);
  usedMargin = round2(usedMargin);
  const equity = round2(s.balance + openFloating);
  const freeMargin = round2(equity - usedMargin);
  const marginLevelPct = usedMargin > 0 ? round2((equity / usedMargin) * 100) : 0;

  const sessionBreakdown: SessionPerf[] = [...sessMap.entries()].map(([session, v]) => ({
    session,
    trades: v.trades,
    wins: v.wins,
    winRate: v.trades ? round2((v.wins / v.trades) * 100) : 0,
    pnl: v.pnl,
  }));

  return {
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: closed.length ? round2((wins.length / closed.length) * 100) : 0,
    profitFactor,
    expectancyUsd,
    sharpeRatio,
    avgWinUsd,
    avgLossUsd,
    bestTradeUsd,
    worstTradeUsd,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    currentLossStreak: curL,
    tradingDays: dayMap.size,
    longTrades: longs.length,
    longWinRate,
    shortTrades: shorts.length,
    shortWinRate,
    netPnl,
    netReturnPct: s.settings.startingBalance > 0 ? round2((netPnl / s.settings.startingBalance) * 100) : 0,
    todayPnl: round2(todayPnl),
    pnl7d: round2(since(Date.now() - 7 * 864e5)),
    pnl30d: round2(since(Date.now() - 30 * 864e5)),
    averageR,
    maxDrawdownPct: round2(maxDd),
    openFloating,
    usedMargin,
    freeMargin,
    marginLevelPct,
    dailyCalendar: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    sessionBreakdown,
  };
}

export function riskFrom(s: AccountProfile, stats: Stats): { dailyPnlPct: number; drawdownPct: number } {
  const base = s.balance - stats.todayPnl;
  const dailyPnlPct = base > 0 ? ((stats.todayPnl + stats.openFloating) / base) * 100 : 0;
  const equity = s.balance + stats.openFloating;
  const peak = Math.max(s.equityPeak, equity);
  const drawdownPct = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
  return { dailyPnlPct: round2(dailyPnlPct), drawdownPct: round2(drawdownPct) };
}
