export type SymbolCode = "XAUUSD" | "XAGUSD" | "EURUSD" | "GBPUSD" | "USDJPY" | "BTCUSD";
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type Side = "BUY" | "SELL";
export type Mode = "signal" | "semi" | "auto";
export type DirectionLock = "both" | "buy" | "sell" | "paused";
export type OrderType = "MARKET" | "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP";
export type StrategyId = "trend_pullback" | "key_level_pa" | "killzone_breakout" | "prop_shield";
export type SessionId = "asian" | "london" | "ny_overlap" | "ny" | "rollover";
export type WorkspaceId =
  | "terminal"
  | "copilot"
  | "strategy"
  | "backtest"
  | "analytics"
  | "intel"
  | "hub"
  | "bridge";

/** Client-controlled authority limits applied to AI/automated trading (Mandate). */
export interface TradingPolicy {
  allowedSymbols: SymbolCode[];
  maxLotsPerTrade: number; // hard cap; automation clamps lots to this value
  maxTradesPerDay: number; // automated entries per UTC day
  maxOpenRiskPct: number; // total open risk (all positions) as % of balance
  tradingWindowEnabled: boolean;
  windowStartUtc: number; // 0-23
  windowEndUtc: number; // 0-23 (exclusive), may wrap past midnight
  autoApprovalMaxRiskUsd: number; // in Auto mode, trades risking more than this need human approval (0 = off)
}

export interface SymbolSpec {
  code: SymbolCode;
  name: string;
  shortName: string;
  category: "Precious Metal" | "Major FX" | "Crypto";
  decimals: number;
  pipSize: number;
  contractSize: number;
  defaultMaxSpread: number;
  leverage: number;
  minLot: number;
  maxLot: number;
  quoteCurrency: "USD" | "JPY";
}

export interface Bar {
  time: number; // unix seconds UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isOpen: boolean;
}

export interface Quote {
  symbol: SymbolCode;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  high: number;
  low: number;
  dayChangePct: number;
  timestamp: string;
  source: string;
  marketState: string;
  fallback: boolean;
}

export interface NewsEvent {
  id: string;
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | string;
  time: string; // ISO UTC
  forecast: string;
  previous: string;
  actual?: string;
  goldNote?: string;
  source?: "live" | "cached" | "curated";
}

export interface Settings {
  mode: Mode;
  direction: DirectionLock;
  riskPct: number;
  dailyLossPct: number;
  maxDrawdownPct: number;
  profitTargetPct: number;
  maxOpenTrades: number;
  maxSpread: number;
  killSwitch: boolean;
  startingBalance: number;
  propFirm: boolean;
}

export interface StrategyConfig {
  activeStrategy: StrategyId;
  emaFast: number;
  emaSlow: number;
  emaMacro: number;
  rsiPeriod: number;
  rsiBuyMin: number;
  rsiBuyMax: number;
  rsiSellMin: number;
  rsiSellMax: number;
  atrMultiplierStop: number;
  rewardRatio: number;
  minRoomR: number;
  partialTpEnabled: boolean;
  tp1R: number;
  trailingStopAtr: number;
  allowedSessions: Array<"asian" | "london" | "ny_overlap" | "ny">;
  newsBlackoutBeforeMin: number;
  newsBlackoutAfterMin: number;
  newsOfflinePolicy: "fail_closed" | "warn_only";
  cooldownAfterLosses: number;
}

export interface TradePlan {
  symbol: SymbolCode;
  side: Side;
  entry: number;
  stopLoss: number;
  tp1Price: number | null;
  takeProfit: number;
  riskDistance: number;
  rewardRatio: number;
  lots: number;
  riskAmount: number;
  marginRequired: number;
  trailingDistance: number | null;
}

export interface GateResult {
  id: number;
  name: string;
  pass: boolean;
  weight: number;
  detail: string;
}

export interface ChartIndicators {
  pdh: number | null;
  pdl: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  candlePattern: string | null;
}

export interface Decision {
  symbol: SymbolCode;
  strategyId: StrategyId;
  strategyName: string;
  verdict: Side | "DO NOT TRADE";
  score: number;
  gates: GateResult[];
  plan: TradePlan | null;
  bullCase: string[];
  bearCase: string[];
  reasons: string[];
  generatedAt: string;
  trendDirection: Side | null;
  nearestSupport: number | null;
  nearestResistance: number | null;
  atr: number;
  rsi: number;
  sessionId: SessionId;
  sessionName: string;
  indicators: ChartIndicators;
}

export interface Trade {
  id: string;
  symbol: SymbolCode;
  side: Side;
  entry: number;
  stopLoss: number;
  tp1Price: number | null;
  tp1Hit: boolean;
  takeProfit: number;
  initialLots: number;
  lots: number;
  realizedPartialPnl: number;
  breakEvenMoved: boolean;
  trailingDistance: number | null;
  riskAmount: number;
  marginUsed: number;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  pnl: number;
  rMultiple: number;
  status: "open" | "closed";
  closeReason: string;
  approvedBy: "auto" | "you" | "manual" | "simulated";
  strategyId: StrategyId;
  session: string;
  reason: string;
  tags: string[];
  notes: string;
}

export interface PendingOrder {
  id: string;
  symbol: SymbolCode;
  orderType: Exclude<OrderType, "MARKET">;
  side: Side;
  triggerPrice: number;
  stopLoss: number;
  tp1Price: number | null;
  takeProfit: number;
  lots: number;
  riskAmount: number;
  trailingDistance: number | null;
  createdAt: string;
  expiresAt: string | null;
  reason: string;
  source: "manual" | "ai";
}

export interface BlockedSignal {
  id: string;
  at: string;
  symbol: SymbolCode;
  intendedSide: Side | "NONE";
  price: number;
  score: number;
  blockingGates: string[];
  savedRiskUsd: number;
  summary: string;
}

export interface PriceAlert {
  id: string;
  symbol: SymbolCode;
  condition: "ABOVE" | "BELOW";
  targetPrice: number;
  note: string;
  active: boolean;
  triggeredAt: string | null;
  createdAt: string;
}

export interface Proposal {
  id: string;
  symbol: SymbolCode;
  plan: TradePlan;
  strategyId: StrategyId;
  strategyName: string;
  score: number;
  createdAt: string;
  expiresAt: string;
  reason: string;
  simulated?: boolean;
  gatesSummary: string[];
}

export type MessageKind =
  | "BUY_ALERT"
  | "SELL_ALERT"
  | "DO_NOT_BUY"
  | "RISK_GUARD"
  | "TRADE_OPENED"
  | "TRADE_CLOSED"
  | "PRICE_ALERT"
  | "INFO"
  | "BRIEFING";

export interface Message {
  id: string;
  at: string;
  symbol?: SymbolCode;
  kind: MessageKind;
  text: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
}

export interface MarketScanRow {
  symbol: SymbolCode;
  shortName: string;
  mid: number;
  dayChangePct: number;
  spread: number;
  verdict: Side | "DO NOT TRADE";
  score: number;
  trend: Side | "MIXED";
  rsi: number;
  topBlocker: string;
}

export type ChatCard =
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "decision"; symbol: SymbolCode; verdict: Side | "DO NOT TRADE"; score: number; mid: number; spread: number; plan: TradePlan | null; gates: GateResult[] }
  | { kind: "scanner"; rows: MarketScanRow[] }
  | { kind: "revenue"; balance: number; equity: number; stats: Stats };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  card?: ChatCard;
}

export interface AccountProfile {
  id: string;
  name: string;
  badge: "Prop Showcase" | "Live Paper" | "Custom";
  settings: Settings;
  strategy: StrategyConfig;
  policy: TradingPolicy;
  balance: number;
  equityPeak: number;
  trades: Trade[];
  pendingOrders: PendingOrder[];
  blockedSignals: BlockedSignal[];
  priceAlerts: PriceAlert[];
  proposal: Proposal | null;
  messages: Message[];
  audit: AuditEntry[];
  chat: ChatMessage[];
  lastSignalKey: string;
  lastBlockKey: string;
}

export interface Mt5Command {
  id: string;
  createdAt: string;
  type: "OPEN" | "CLOSE_ALL" | "MODIFY_SLTP";
  symbol: SymbolCode;
  side?: Side;
  lots?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
  delivered: boolean;
}

export interface Mt5ExecutionReport {
  at: string;
  ticket: string;
  symbol: string;
  action: string;
  price: number;
  lots: number;
  detail: string;
}

export interface Mt5BridgeState {
  token: string;
  enabled: boolean;
  autoForwardApproved: boolean;
  lastHeartbeatAt: string | null;
  brokerName: string;
  accountLogin: string;
  accountServer: string;
  terminalBuild: string;
  brokerBalance: number | null;
  brokerEquity: number | null;
  queuedCommands: Mt5Command[];
  executedLog: Mt5ExecutionReport[];
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  forwardSignals: boolean;
  forwardTrades: boolean;
  lastSentAt: string | null;
}

export interface PlatformStore {
  version: number;
  activeAccountId: string;
  accounts: AccountProfile[];
  mt5Bridge: Mt5BridgeState;
  telegram: TelegramConfig;
}

// Backwards-compatible alias for active account view in Snapshot
export type StoredState = AccountProfile;

export interface DailyPnlCell {
  date: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
  wins: number;
}

export interface SessionPerf {
  session: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
}

export interface Stats {
  closedCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  profitFactor: number;
  expectancyUsd: number;
  sharpeRatio: number;
  avgWinUsd: number;
  avgLossUsd: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  currentLossStreak: number;
  tradingDays: number;
  longTrades: number;
  longWinRate: number;
  shortTrades: number;
  shortWinRate: number;
  netPnl: number;
  netReturnPct: number;
  todayPnl: number;
  pnl7d: number;
  pnl30d: number;
  averageR: number;
  maxDrawdownPct: number;
  openFloating: number;
  usedMargin: number;
  freeMargin: number;
  marginLevelPct: number;
  dailyCalendar: DailyPnlCell[];
  sessionBreakdown: SessionPerf[];
}

export interface AccountSummary {
  id: string;
  name: string;
  badge: AccountProfile["badge"];
  balance: number;
  startingBalance: number;
  propFirm: boolean;
}

export interface Snapshot {
  symbol: SymbolCode;
  quote: Quote | null;
  watchlist: Quote[];
  decision: Decision | null;
  chartBars: Bar[];
  chartTf: Timeframe;
  news: NewsEvent[];
  newsSource: "live" | "cached" | "curated";
  error: string | null;
  state: AccountProfile;
  accounts: AccountSummary[];
  mt5Bridge: Mt5BridgeState;
  telegram: Omit<TelegramConfig, "botToken"> & { hasBotToken: boolean };
  stats: Stats;
  equity: number;
  dailyPnlPct: number;
  drawdownPct: number;
  claudeConfigured: boolean;
  generatedAt: string;
}
