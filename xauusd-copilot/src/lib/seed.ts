import type {
  AccountProfile,
  AuditEntry,
  BlockedSignal,
  Message,
  PriceAlert,
  Settings,
  StrategyConfig,
  StrategyId,
  Trade,
} from "./types";
import { DEFAULT_POLICY } from "./policy";

export const DEFAULT_SETTINGS: Settings = {
  mode: "semi",
  direction: "both",
  riskPct: 1,
  dailyLossPct: 2,
  maxDrawdownPct: 10,
  profitTargetPct: 10,
  maxOpenTrades: 2,
  maxSpread: 0.45,
  killSwitch: false,
  startingBalance: 10000,
  propFirm: false,
};

export const STRATEGY_PRESETS: Record<
  StrategyId,
  { name: string; tagline: string; description: string; config: Omit<StrategyConfig, "activeStrategy"> }
> = {
  trend_pullback: {
    name: "Trend Pullback Pro",
    tagline: "Daily + 4H EMA alignment with 15m RSI momentum turn",
    description:
      "Waits for Daily and 4H EMA 20/50 trend agreement, enters when 15m RSI pulls back and turns back in trend direction with at least 1.5R room to opposing structure.",
    config: {
      emaFast: 20,
      emaSlow: 50,
      emaMacro: 200,
      rsiPeriod: 14,
      rsiBuyMin: 44,
      rsiBuyMax: 68,
      rsiSellMin: 32,
      rsiSellMax: 56,
      atrMultiplierStop: 0.5,
      rewardRatio: 2.0,
      minRoomR: 1.5,
      partialTpEnabled: true,
      tp1R: 1.0,
      trailingStopAtr: 0,
      allowedSessions: ["london", "ny_overlap", "ny"],
      newsBlackoutBeforeMin: 30,
      newsBlackoutAfterMin: 60,
      newsOfflinePolicy: "warn_only",
      cooldownAfterLosses: 3,
    },
  },
  key_level_pa: {
    name: "Key-Level Price Action",
    tagline: "PDH/PDL & swing zones + Engulfing / Pin-Bar confirmation",
    description:
      "Maps Previous Day High/Low and multi-touch 1H/4H support-resistance zones, requiring a clean rejection wick or engulfing close with tight structure stops.",
    config: {
      emaFast: 20,
      emaSlow: 50,
      emaMacro: 200,
      rsiPeriod: 14,
      rsiBuyMin: 38,
      rsiBuyMax: 66,
      rsiSellMin: 34,
      rsiSellMax: 62,
      atrMultiplierStop: 0.4,
      rewardRatio: 2.5,
      minRoomR: 1.6,
      partialTpEnabled: true,
      tp1R: 1.0,
      trailingStopAtr: 1.2,
      allowedSessions: ["london", "ny_overlap", "ny"],
      newsBlackoutBeforeMin: 30,
      newsBlackoutAfterMin: 60,
      newsOfflinePolicy: "warn_only",
      cooldownAfterLosses: 3,
    },
  },
  killzone_breakout: {
    name: "London / NY Killzone",
    tagline: "Session liquidity sweep & momentum expansion during peak hours",
    description:
      "Focuses strictly on London Open (07:00-11:00 UTC) and London/NY Overlap (12:00-16:00 UTC) breakouts with volatility expansion and trailing ATR protection.",
    config: {
      emaFast: 12,
      emaSlow: 34,
      emaMacro: 100,
      rsiPeriod: 14,
      rsiBuyMin: 48,
      rsiBuyMax: 72,
      rsiSellMin: 28,
      rsiSellMax: 52,
      atrMultiplierStop: 0.6,
      rewardRatio: 2.2,
      minRoomR: 1.4,
      partialTpEnabled: true,
      tp1R: 1.0,
      trailingStopAtr: 1.5,
      allowedSessions: ["london", "ny_overlap"],
      newsBlackoutBeforeMin: 30,
      newsBlackoutAfterMin: 45,
      newsOfflinePolicy: "warn_only",
      cooldownAfterLosses: 2,
    },
  },
  prop_shield: {
    name: "Prop-Firm Capital Shield",
    tagline: "Ultra-conservative drawdown defense for funded $100k accounts",
    description:
      "Designed for FTMO-style funded accounts: strict trend + structure + volatility confluence, 2.5R target, mandatory TP1 break-even lock, and 2-loss daily cooldown.",
    config: {
      emaFast: 21,
      emaSlow: 55,
      emaMacro: 200,
      rsiPeriod: 14,
      rsiBuyMin: 46,
      rsiBuyMax: 64,
      rsiSellMin: 36,
      rsiSellMax: 54,
      atrMultiplierStop: 0.5,
      rewardRatio: 2.5,
      minRoomR: 1.8,
      partialTpEnabled: true,
      tp1R: 1.0,
      trailingStopAtr: 1.3,
      allowedSessions: ["london", "ny_overlap", "ny"],
      newsBlackoutBeforeMin: 45,
      newsBlackoutAfterMin: 60,
      newsOfflinePolicy: "fail_closed",
      cooldownAfterLosses: 2,
    },
  },
};

export function defaultStrategy(id: StrategyId = "trend_pullback"): StrategyConfig {
  return {
    activeStrategy: id,
    ...STRATEGY_PRESETS[id].config,
  };
}

function isoDaysAgo(daysAgo: number, hourUtc: number, minUtc = 15): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hourUtc, minUtc, 0, 0);
  return d.toISOString();
}

interface SeedRow {
  daysAgo: number;
  openH: number;
  closeH: number;
  symbol: Trade["symbol"];
  side: Trade["side"];
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  lots: number;
  riskUsd: number;
  pnl: number;
  reason: string;
  closeReason: string;
  approvedBy: Trade["approvedBy"];
  strategyId: StrategyId;
  session: string;
  tags: string[];
  notes: string;
}

const SHOWCASE_ROWS: SeedRow[] = [
  { daysAgo: 26, openH: 8, closeH: 13, symbol: "XAUUSD", side: "BUY", entry: 3512.4, sl: 3502.4, tp: 3532.4, exit: 3532.4, lots: 0.5, riskUsd: 500, pnl: 1000, reason: "Daily + 4H bullish, London key-level retest at 3512", closeReason: "Take profit hit (2.0R)", approvedBy: "you", strategyId: "key_level_pa", session: "London session", tags: ["Followed Plan", "Key Level"], notes: "Clean bounce off weekly support zone during London open." },
  { daysAgo: 25, openH: 13, closeH: 16, symbol: "XAUUSD", side: "BUY", entry: 3528.0, sl: 3518.0, tp: 3548.0, exit: 3518.0, lots: 0.5, riskUsd: 500, pnl: -500, reason: "NY overlap trend continuation pullback", closeReason: "Stop loss hit (-1.0R)", approvedBy: "you", strategyId: "trend_pullback", session: "London / New York overlap", tags: ["Followed Plan"], notes: "Sudden Treasury yield spike stopped position at planned 0.5% risk cap." },
  { daysAgo: 24, openH: 9, closeH: 15, symbol: "XAUUSD", side: "BUY", entry: 3521.5, sl: 3511.5, tp: 3544.5, exit: 3544.5, lots: 0.5, riskUsd: 500, pnl: 1150, reason: "4H bullish structure + 15m engulfing off PDL sweep", closeReason: "Take profit hit (2.3R)", approvedBy: "you", strategyId: "key_level_pa", session: "London session", tags: ["Followed Plan", "Key Level", "A+ Setup"], notes: "Textbook liquidity sweep below previous day low followed by strong London expansion." },
  { daysAgo: 22, openH: 14, closeH: 18, symbol: "EURUSD", side: "SELL", entry: 1.1042, sl: 1.1062, tp: 1.0998, exit: 1.0998, lots: 2.5, riskUsd: 500, pnl: 1100, reason: "DXY strength + 4H bearish EMA alignment", closeReason: "Take profit hit (2.2R)", approvedBy: "auto", strategyId: "trend_pullback", session: "London / New York overlap", tags: ["Followed Plan"], notes: "Smooth NY continuation." },
  { daysAgo: 21, openH: 10, closeH: 14, symbol: "XAUUSD", side: "SELL", entry: 3564.0, sl: 3574.0, tp: 3542.0, exit: 3554.0, lots: 0.5, riskUsd: 500, pnl: 250, reason: "4H resistance rejection pin bar", closeReason: "TP1 + Break-even stop (0.5R)", approvedBy: "you", strategyId: "key_level_pa", session: "London session", tags: ["Partial TP", "Break-Even"], notes: "Banked 50% at +1R, remainder stopped at break-even on NY reversal." },
  { daysAgo: 19, openH: 13, closeH: 17, symbol: "XAUUSD", side: "BUY", entry: 3548.2, sl: 3538.2, tp: 3568.2, exit: 3568.2, lots: 0.5, riskUsd: 500, pnl: 1000, reason: "London/NY killzone breakout above Asian high", closeReason: "Take profit hit (2.0R)", approvedBy: "you", strategyId: "killzone_breakout", session: "London / New York overlap", tags: ["Followed Plan", "Killzone"], notes: "Strong momentum candle after US jobless claims cleared." },
  { daysAgo: 18, openH: 8, closeH: 11, symbol: "GBPUSD", side: "BUY", entry: 1.3025, sl: 1.3005, tp: 1.3070, exit: 1.3005, lots: 2.5, riskUsd: 500, pnl: -500, reason: "London open pullback to EMA20", closeReason: "Stop loss hit (-1.0R)", approvedBy: "manual", strategyId: "trend_pullback", session: "London session", tags: ["Manual"], notes: "False breakout on UK retail headlines; loss strictly capped at $500." },
  { daysAgo: 17, openH: 14, closeH: 19, symbol: "XAUUSD", side: "BUY", entry: 3559.0, sl: 3549.0, tp: 3581.0, exit: 3581.0, lots: 0.5, riskUsd: 500, pnl: 1100, reason: "Daily + 4H bullish alignment + 15m RSI 51 rising", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "trend_pullback", session: "London / New York overlap", tags: ["Followed Plan", "A+ Setup"], notes: "Held runner cleanly into NY afternoon target." },
  { daysAgo: 15, openH: 9, closeH: 13, symbol: "XAUUSD", side: "SELL", entry: 3592.5, sl: 3602.5, tp: 3572.5, exit: 3602.5, lots: 0.5, riskUsd: 500, pnl: -500, reason: "Counter-move off upper Bollinger band", closeReason: "Stop loss hit (-1.0R)", approvedBy: "manual", strategyId: "key_level_pa", session: "London session", tags: ["Early Entry"], notes: "Entered slightly before 15m candle close; good reminder to wait for gate 2." },
  { daysAgo: 14, openH: 13, closeH: 18, symbol: "XAUUSD", side: "BUY", entry: 3576.0, sl: 3566.0, tp: 3598.0, exit: 3598.0, lots: 0.5, riskUsd: 500, pnl: 1100, reason: "Retest of broken 3575 resistance turned support", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "key_level_pa", session: "London / New York overlap", tags: ["Followed Plan", "Key Level"], notes: "Zero drawdown after entry." },
  { daysAgo: 12, openH: 12, closeH: 16, symbol: "XAGUSD", side: "BUY", entry: 41.2, sl: 40.95, tp: 41.75, exit: 41.75, lots: 0.4, riskUsd: 500, pnl: 1100, reason: "Silver lagging Gold breakout with clean 4H trend", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "trend_pullback", session: "London / New York overlap", tags: ["Followed Plan"], notes: "Gold/Silver correlation confirmation." },
  { daysAgo: 11, openH: 9, closeH: 14, symbol: "XAUUSD", side: "BUY", entry: 3588.4, sl: 3578.4, tp: 3608.4, exit: 3598.4, lots: 0.5, riskUsd: 500, pnl: 250, reason: "London session EMA20 pullback", closeReason: "TP1 + Break-even stop (0.5R)", approvedBy: "auto", strategyId: "prop_shield", session: "London session", tags: ["Partial TP", "Break-Even"], notes: "Auto break-even protected capital before NY chop." },
  { daysAgo: 10, openH: 15, closeH: 19, symbol: "XAUUSD", side: "SELL", entry: 3614.0, sl: 3624.0, tp: 3592.0, exit: 3592.0, lots: 0.5, riskUsd: 500, pnl: 1100, reason: "PDH liquidity sweep at 3615 + bearish engulfing", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "key_level_pa", session: "New York session", tags: ["Followed Plan", "Key Level", "A+ Setup"], notes: "Sharp reversal from weekly resistance." },
  { daysAgo: 8, openH: 8, closeH: 12, symbol: "XAUUSD", side: "SELL", entry: 3604.0, sl: 3614.0, tp: 3584.0, exit: 3614.0, lots: 0.5, riskUsd: 500, pnl: -500, reason: "4H trend continuation attempt", closeReason: "Stop loss hit (-1.0R)", approvedBy: "auto", strategyId: "trend_pullback", session: "London session", tags: ["Followed Plan"], notes: "Standard 1R stop inside daily risk budget." },
  { daysAgo: 7, openH: 13, closeH: 17, symbol: "XAUUSD", side: "BUY", entry: 3595.0, sl: 3585.0, tp: 3617.0, exit: 3617.0, lots: 0.5, riskUsd: 500, pnl: 1100, reason: "All 8 gates green during London/NY overlap", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "prop_shield", session: "London / New York overlap", tags: ["Followed Plan", "A+ Setup"], notes: "High-conviction setup approved from Copilot ticket." },
  { daysAgo: 5, openH: 10, closeH: 15, symbol: "USDJPY", side: "BUY", entry: 157.8, sl: 157.4, tp: 158.68, exit: 158.68, lots: 1.98, riskUsd: 500, pnl: 1095, reason: "US yield strength + 4H breakout retest", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "trend_pullback", session: "London session", tags: ["Followed Plan"], notes: "Clean trend move." },
  { daysAgo: 4, openH: 14, closeH: 17, symbol: "XAUUSD", side: "SELL", entry: 3632.0, sl: 3642.0, tp: 3612.0, exit: 3642.0, lots: 0.5, riskUsd: 500, pnl: -500, reason: "Resistance fade ahead of NY close", closeReason: "Stop loss hit (-1.0R)", approvedBy: "manual", strategyId: "key_level_pa", session: "New York session", tags: ["Manual"], notes: "Gold bid stayed strong into close." },
  { daysAgo: 3, openH: 9, closeH: 14, symbol: "XAUUSD", side: "BUY", entry: 3608.5, sl: 3598.5, tp: 3630.5, exit: 3630.5, lots: 0.5, riskUsd: 500, pnl: 1100, reason: "London killzone sweep + 1H structure break", closeReason: "Take profit hit (2.2R)", approvedBy: "you", strategyId: "killzone_breakout", session: "London session", tags: ["Followed Plan", "Killzone"], notes: "Strong 22-point push in 4 hours." },
  { daysAgo: 1, openH: 13, closeH: 16, symbol: "XAUUSD", side: "SELL", entry: 3636.0, sl: 3646.0, tp: 3616.0, exit: 3616.0, lots: 0.5, riskUsd: 500, pnl: 1000, reason: "4H bearish alignment + rejection at 3637 day high", closeReason: "Take profit hit (2.0R)", approvedBy: "you", strategyId: "trend_pullback", session: "London / New York overlap", tags: ["Followed Plan", "Key Level"], notes: "Rejected right below 3637 resistance." },
  { daysAgo: 0, openH: 7, closeH: 10, symbol: "XAUUSD", side: "SELL", entry: 3628.4, sl: 3638.4, tp: 3608.4, exit: 3615.4, lots: 0.5, riskUsd: 500, pnl: 650, reason: "London open bearish continuation with trailing stop", closeReason: "Trailing stop locked profit (+1.3R)", approvedBy: "you", strategyId: "prop_shield", session: "London session", tags: ["Followed Plan", "Trailing Stop"], notes: "Locked +$650 on London drop before midday bounce." },
];

export function buildShowcaseAccount(): AccountProfile {
  const startingBalance = 100000;
  const settings: Settings = {
    mode: "semi",
    direction: "both",
    riskPct: 0.5,
    dailyLossPct: 5,
    maxDrawdownPct: 10,
    profitTargetPct: 10,
    maxOpenTrades: 2,
    maxSpread: 0.45,
    killSwitch: false,
    startingBalance,
    propFirm: true,
  };

  let runningBalance = startingBalance;
  let equityPeak = startingBalance;

  const chronological = [...SHOWCASE_ROWS].sort((a, b) => b.daysAgo - a.daysAgo);
  const trades: Trade[] = chronological
    .map((r, idx) => {
      runningBalance = Math.round((runningBalance + r.pnl) * 100) / 100;
      equityPeak = Math.max(equityPeak, runningBalance);
      const rMult = Math.round((r.pnl / r.riskUsd) * 100) / 100;
      const riskDist = Math.abs(r.entry - r.sl);
      const tp1 =
        r.side === "BUY"
          ? Math.round((r.entry + riskDist) * 100000) / 100000
          : Math.round((r.entry - riskDist) * 100000) / 100000;
      return {
        id: `seed-${idx + 1}`,
        symbol: r.symbol,
        side: r.side,
        entry: r.entry,
        stopLoss: r.sl,
        tp1Price: tp1,
        tp1Hit: r.pnl > 0,
        takeProfit: r.tp,
        initialLots: r.lots,
        lots: r.lots,
        realizedPartialPnl: 0,
        breakEvenMoved: r.pnl > 0,
        trailingDistance: null,
        riskAmount: r.riskUsd,
        marginUsed: 0,
        openedAt: isoDaysAgo(r.daysAgo, r.openH, 10),
        closedAt: isoDaysAgo(r.daysAgo, r.closeH, 35),
        exitPrice: r.exit,
        pnl: r.pnl,
        rMultiple: rMult,
        status: "closed" as const,
        closeReason: r.closeReason,
        approvedBy: r.approvedBy,
        strategyId: r.strategyId,
        session: r.session,
        reason: r.reason,
        tags: r.tags,
        notes: r.notes,
      };
    })
    .reverse();

  const blockedSignals: BlockedSignal[] = [
    {
      id: "blk-1",
      at: isoDaysAgo(0, 6, 15),
      symbol: "XAUUSD",
      intendedSide: "SELL",
      price: 3624.8,
      score: 63,
      blockingGates: ["Momentum (15m RSI)", "Key-Level Structure & R:R Room"],
      savedRiskUsd: 500,
      summary: "Blocked early short at 3624.80 because nearest 1H support at 3608 left less than 1.5R room.",
    },
    {
      id: "blk-2",
      at: isoDaysAgo(2, 21, 40),
      symbol: "XAUUSD",
      intendedSide: "BUY",
      price: 3611.2,
      score: 50,
      blockingGates: ["Session & Killzone Liquidity", "Broker Spread Collar"],
      savedRiskUsd: 500,
      summary: "Blocked rollover entry at 21:40 UTC when broker spread widened to $0.82 (limit $0.45).",
    },
    {
      id: "blk-3",
      at: isoDaysAgo(6, 13, 20),
      symbol: "XAUUSD",
      intendedSide: "BUY",
      price: 3589.5,
      score: 75,
      blockingGates: ["High-Impact USD News Filter"],
      savedRiskUsd: 500,
      summary: "Blocked entry 10 minutes before US Retail Sales / PPI volatility spike.",
    },
    {
      id: "blk-4",
      at: isoDaysAgo(9, 16, 45),
      symbol: "XAUUSD",
      intendedSide: "SELL",
      price: 3601.0,
      score: 62,
      blockingGates: ["Personal & Prop-Firm Risk Guard"],
      savedRiskUsd: 500,
      summary: "Cooldown guard paused entries after 2 consecutive stops earlier that session.",
    },
  ];

  const priceAlerts: PriceAlert[] = [
    {
      id: "al-1",
      symbol: "XAUUSD",
      condition: "ABOVE",
      targetPrice: 3640.0,
      note: "4H supply & breakout watch above 3640",
      active: true,
      triggeredAt: null,
      createdAt: isoDaysAgo(1, 9, 0),
    },
    {
      id: "al-2",
      symbol: "XAUUSD",
      condition: "BELOW",
      targetPrice: 3600.0,
      note: "Psychological $3,600 round-number support test",
      active: true,
      triggeredAt: null,
      createdAt: isoDaysAgo(1, 9, 5),
    },
  ];

  const messages: Message[] = [
    {
      id: "msg-1",
      at: isoDaysAgo(0, 10, 35),
      symbol: "XAUUSD",
      kind: "TRADE_CLOSED",
      text: "XAUUSD SELL 0.50 lots closed at 3615.40 (Trailing stop locked profit). Net +$650.00 (+1.30R).",
    },
    {
      id: "msg-2",
      at: isoDaysAgo(0, 7, 10),
      symbol: "XAUUSD",
      kind: "TRADE_OPENED",
      text: "XAUUSD SELL 0.50 lots opened at 3628.40. SL 3638.40 | TP1 3618.40 | TP2 3608.40 | Risk $500.00 (0.5%). Approved by you.",
    },
    {
      id: "msg-3",
      at: isoDaysAgo(0, 6, 15),
      symbol: "XAUUSD",
      kind: "DO_NOT_BUY",
      text: "DO NOT ENTER XAUUSD right now (Score 63/100). Daily/4H trend is aligned, but 15m RSI is counter-sloping and 1H support is too close for 1.5R.",
    },
    {
      id: "msg-4",
      at: isoDaysAgo(1, 16, 35),
      symbol: "XAUUSD",
      kind: "TRADE_CLOSED",
      text: "XAUUSD SELL 0.50 lots hit Take Profit at 3616.00. Net +$1,000.00 (+2.00R).",
    },
  ];

  const audit: AuditEntry[] = [
    { at: isoDaysAgo(0, 10, 35), action: "trade.close", detail: "XAUUSD SELL 0.50 lots @ 3615.40 (+$650.00)" },
    { at: isoDaysAgo(0, 7, 10), action: "proposal.approved", detail: "Edward approved XAUUSD SELL 0.50 lots @ 3628.40" },
    { at: isoDaysAgo(0, 6, 15), action: "gate.blocked", detail: "Blocked premature XAUUSD entry (insufficient R:R room)" },
    { at: isoDaysAgo(1, 9, 0), action: "strategy.preset", detail: "Prop-Firm limits active: 0.5% risk, 5% daily cap, 10% max DD" },
  ];

  return {
    id: "showcase-100k",
    name: "$100k Prop-Firm Showcase",
    badge: "Prop Showcase",
    settings,
    strategy: defaultStrategy("prop_shield"),
    policy: { ...DEFAULT_POLICY, allowedSymbols: [...DEFAULT_POLICY.allowedSymbols] },
    balance: runningBalance,
    equityPeak,
    trades,
    pendingOrders: [],
    blockedSignals,
    priceAlerts,
    proposal: null,
    messages,
    audit,
    chat: [
      {
        id: "welcome-1",
        role: "assistant",
        at: new Date().toISOString(),
        text:
          "Welcome to AurumDesk Pro. You are viewing the $100,000 Prop-Firm Showcase account (switch to the Clean $10,000 Paper Account anytime in the top bar).\n\n" +
          "Ask me to scan all 6 live markets, analyze XAU/USD, simulate a live setup for approval, adjust risk rules, or run a Monte Carlo backtest.",
      },
    ],
    lastSignalKey: "",
    lastBlockKey: "",
  };
}

export function buildCleanPaperAccount(
  id = "paper-10k",
  name = "$10k Clean Live Paper",
  startingBalance = 10000,
  propFirm = false,
  badge: AccountProfile["badge"] = "Live Paper",
): AccountProfile {
  return {
    id,
    name,
    badge,
    settings: {
      ...DEFAULT_SETTINGS,
      startingBalance,
      propFirm,
      riskPct: propFirm ? 0.5 : 1,
      dailyLossPct: propFirm ? 5 : 2,
      maxDrawdownPct: 10,
      profitTargetPct: 10,
    },
    strategy: defaultStrategy(propFirm ? "prop_shield" : "trend_pullback"),
    policy: { ...DEFAULT_POLICY, allowedSymbols: [...DEFAULT_POLICY.allowedSymbols] },
    balance: startingBalance,
    equityPeak: startingBalance,
    trades: [],
    pendingOrders: [],
    blockedSignals: [],
    priceAlerts: [],
    proposal: null,
    messages: [],
    audit: [
      {
        at: new Date().toISOString(),
        action: "account.ready",
        detail: `${name} initialized at $${startingBalance.toLocaleString()}`,
      },
    ],
    chat: [
      {
        id: `welcome-${id}`,
        role: "assistant",
        at: new Date().toISOString(),
        text: `${name} is active with a clean $${startingBalance.toLocaleString()} balance. Ask "Should I buy or sell gold now?", "Scan all markets", or click "Simulate Setup" in the top bar to test an order approval live.`,
      },
    ],
    lastSignalKey: "",
    lastBlockKey: "",
  };
}
