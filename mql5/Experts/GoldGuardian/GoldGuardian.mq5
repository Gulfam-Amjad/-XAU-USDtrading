//+------------------------------------------------------------------+
//| GoldGuardian.mq5                                                 |
//| XAU/USD rule-based trading system with hard risk limits,         |
//| three permission modes and a Telegram bridge.                    |
//+------------------------------------------------------------------+
#property copyright "Hammad Muntazir"
#property version   "0.10"
#property description "GoldGuardian - XAU/USD system with strict risk limits."
#property description "Modes: Signal only, Semi-automatic (approval), Fully automatic within limits."
#property description "Strategy v0 is a placeholder until the course rules are finalised."

#include <GoldGuardian\Config.mqh>
#include <GoldGuardian\Sessions.mqh>
#include <GoldGuardian\Bridge.mqh>
#include <GoldGuardian\Logger.mqh>
#include <GoldGuardian\NewsFilter.mqh>
#include <GoldGuardian\RiskManager.mqh>
#include <GoldGuardian\Executor.mqh>
#include <GoldGuardian\Strategy.mqh>

CGGClock     g_clock;
CGGSessions  g_sess;
CGGBridge    g_bridge;
CGGLogger    g_log;
CGGNews      g_news;
CGGRisk      g_risk;
CGGExecutor  g_exec;
IStrategy   *g_strategy = NULL;

SGGSignal    g_pending;
datetime     g_pendingExpire = 0;
string       g_lastSignalId  = "";
datetime     g_lastBar       = 0;
datetime     g_lastStateWrite = 0;
int          g_weekendClosedKey = 0;
bool         g_calendarWarned = false;

void WriteState(const bool force);

//+------------------------------------------------------------------+
string RuntimeGV(const string k) { return "GG_" + IntegerToString(InpMagic) + "_rt_" + k; }

void SaveRuntime()
  {
   GlobalVariableSet(RuntimeGV("paused"), g_rt.paused ? 1.0 : 0.0);
   GlobalVariableSet(RuntimeGV("kill"), g_rt.killSwitch ? 1.0 : 0.0);
  }

void LoadRuntime()
  {
   g_rt.mode      = (int)InpMode;
   g_rt.direction = (int)InpDirection;
   g_rt.riskPct   = MathMin(InpRiskPercent, InpMaxRiskPercent);
   g_rt.paused    = GlobalVariableCheck(RuntimeGV("paused")) && GlobalVariableGet(RuntimeGV("paused")) > 0.5;
   g_rt.killSwitch= GlobalVariableCheck(RuntimeGV("kill")) && GlobalVariableGet(RuntimeGV("kill")) > 0.5;
   if(InpResetKillSwitch && g_rt.killSwitch)
     {
      g_rt.killSwitch = false;
      Print("[GG] Kill switch reset by input on start.");
     }
   if(GG_IsTester())
     {
      g_rt.paused = false;
      g_rt.killSwitch = false;
     }
   SaveRuntime();
  }

int EffectiveMode()
  {
   if(GG_IsTester() && InpTesterAutoApprove && g_rt.mode == GG_MODE_SEMI)
      return GG_MODE_AUTO;
   return g_rt.mode;
  }

//+------------------------------------------------------------------+
string SignalFields(const SGGSignal &s, const double lots, const double riskMoney)
  {
   int d = _Digits;
   return JStr("signal_id", s.id) + "," +
          JStr("side", s.dir > 0 ? "BUY" : "SELL") + "," +
          JNum("entry", s.entry, d) + "," +
          JNum("sl", s.sl, d) + "," +
          JNum("tp", s.tp, d) + "," +
          JNum("rr", s.rr, 2) + "," +
          JNum("lots", lots, 2) + "," +
          JNum("risk_money", riskMoney, 2) + "," +
          JNum("risk_pct", g_rt.riskPct, 2) + "," +
          JStr("level", s.level) + "," +
          JStr("reason", s.reason) + "," +
          JStr("strategy", g_strategy != NULL ? g_strategy.Name() : "");
  }

//--- every non-risk filter. Risk limits are checked by g_risk.CheckNewTrade.
bool CheckFilters(const int dir, string &why)
  {
   why = "";
   if(g_rt.killSwitch)                 { why = "kill switch active"; return false; }
   if(g_rt.paused)                     { why = "paused"; return false; }
   if(g_rt.direction == GG_DIR_BUY_ONLY && dir < 0)  { why = "direction set to BUY only"; return false; }
   if(g_rt.direction == GG_DIR_SELL_ONLY && dir > 0) { why = "direction set to SELL only"; return false; }
   if(!g_sess.IsTradingWindow())       { why = "outside trading sessions"; return false; }
   if(g_sess.IsRollover())             { why = "rollover window"; return false; }
   if(g_sess.IsFridayCutoff())         { why = "Friday cut-off"; return false; }
   if(g_news.IsBlocked(g_clock.NowServer(), why)) return false;
   if(g_exec.SpreadPoints() > InpMaxSpreadPoints)
     {
      why = "spread too wide (" + DoubleToString(g_exec.SpreadPoints(), 0) + " points)";
      return false;
     }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
     {
      if(!GG_IsTester())
        { why = "algo trading disabled in terminal"; return false; }
     }
   return true;
  }

//+------------------------------------------------------------------+
bool ExecuteSignal(SGGSignal &s, const string source, string &why)
  {
   why = "";
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
     { why = "no price"; return false; }
   double price = (s.dir > 0) ? tick.ask : tick.bid;
   if(MathAbs(price - s.entry) > InpMaxEntryDriftPts * _Point)
     { why = "price moved too far since the signal"; return false; }
   if((s.dir > 0 && price <= s.sl) || (s.dir < 0 && price >= s.sl))
     { why = "price already beyond the stop"; return false; }
   if(!CheckFilters(s.dir, why))
      return false;

   double riskMoney;
   double lots = g_risk.LotsForRisk(s.dir, price, s.sl, g_rt.riskPct, riskMoney);
   if(!g_risk.CheckNewTrade(s.dir, price, s.sl, lots, riskMoney, why))
      return false;

   string err;
   ulong pos = g_exec.Open(s.dir, lots, s.sl, s.tp, "GG " + s.id, err);
   if(pos == 0)
     {
      why = "order failed: " + err;
      return false;
     }
   double riskPrice = MathAbs(price - s.sl);
   g_risk.StorePositionRisk(pos, riskMoney, riskPrice);
   g_log.Event("trade_opened", JInt("position_id", (long)pos) + "," + JStr("source", source) + "," +
               SignalFields(s, lots, riskMoney));
   return true;
  }

void ClearPending()
  {
   g_pending.valid = false;
   g_pendingExpire = 0;
   g_bridge.ClearSignal();
  }

//+------------------------------------------------------------------+
void HandleSignal(SGGSignal &s)
  {
   if(s.id == g_lastSignalId)
      return;
   g_lastSignalId = s.id;

   string why;
   double riskMoney;
   double lots = g_risk.LotsForRisk(s.dir, s.entry, s.sl, g_rt.riskPct, riskMoney);
   string fields = SignalFields(s, lots, riskMoney);

   if(!CheckFilters(s.dir, why) || !g_risk.CheckNewTrade(s.dir, s.entry, s.sl, lots, riskMoney, why))
     {
      g_log.Event("signal_blocked", fields + "," + JStr("why", why));
      return;
     }

   int mode = EffectiveMode();
   if(mode == GG_MODE_SIGNAL)
     {
      g_log.Event("signal", fields + "," + JStr("mode", "signal"));
      return;
     }
   if(mode == GG_MODE_SEMI)
     {
      g_pending = s;
      g_pendingExpire = g_clock.NowServer() + InpSignalExpiryMin * 60;
      string body = "{" + fields + "," + JInt("expires_utc", (long)g_clock.ServerToGMT(g_pendingExpire)) + "}";
      g_bridge.WriteSignal(body);
      g_log.Event("approval_request", fields + "," + JInt("expires_utc", (long)g_clock.ServerToGMT(g_pendingExpire)));
      return;
     }
   if(!ExecuteSignal(s, "auto", why))
      g_log.Event("trade_rejected", fields + "," + JStr("why", why));
  }

//+------------------------------------------------------------------+
void Ack(const SGGCommand &c, const bool ok, const string message)
  {
   g_log.Event("command_ack", JStr("command_id", c.id) + "," + JStr("cmd", c.cmd) + "," +
               JBool("ok", ok) + "," + JStr("message", message));
  }

void DoCloseAll(const string reason)
  {
   string report;
   int left = g_exec.CloseAll(report);
   g_log.Event(left > 0 ? "close_all_incomplete" : "close_all", JStr("reason", reason) + "," + JStr("result", report));
  }

void ProcessCommand(const SGGCommand &c)
  {
   string v = c.value;
   StringToLower(v);
   if(c.cmd == "pause")
     {
      g_rt.paused = true;
      SaveRuntime();
      Ack(c, true, "Trading paused. Open trades keep their stops and targets.");
     }
   else if(c.cmd == "resume")
     {
      if(g_rt.killSwitch)
        { Ack(c, false, "Kill switch is active. Use resetkill CONFIRM first."); return; }
      g_rt.paused = false;
      SaveRuntime();
      Ack(c, true, "Trading resumed.");
     }
   else if(c.cmd == "closeall")
     {
      DoCloseAll("remote command");
      Ack(c, true, "Close-all executed.");
     }
   else if(c.cmd == "mode")
     {
      if(v == "signal")    g_rt.mode = GG_MODE_SIGNAL;
      else if(v == "semi") g_rt.mode = GG_MODE_SEMI;
      else if(v == "auto") g_rt.mode = GG_MODE_AUTO;
      else { Ack(c, false, "Unknown mode. Use signal, semi or auto."); return; }
      if(g_rt.mode != GG_MODE_SEMI)
         ClearPending();
      Ack(c, true, "Mode set to " + GG_ModeName(g_rt.mode) + ".");
     }
   else if(c.cmd == "direction")
     {
      if(v == "both")      g_rt.direction = GG_DIR_BOTH;
      else if(v == "buy")  g_rt.direction = GG_DIR_BUY_ONLY;
      else if(v == "sell") g_rt.direction = GG_DIR_SELL_ONLY;
      else { Ack(c, false, "Unknown direction. Use both, buy or sell."); return; }
      Ack(c, true, "Direction set to " + GG_DirectionName(g_rt.direction) + ".");
     }
   else if(c.cmd == "risk")
     {
      double r = StringToDouble(v);
      if(r < 0.1 || r > InpMaxRiskPercent)
        {
         Ack(c, false, "Risk must be between 0.10% and the hard cap of " + DoubleToString(InpMaxRiskPercent, 2) + "%.");
         return;
        }
      g_rt.riskPct = r;
      Ack(c, true, "Risk per trade set to " + DoubleToString(r, 2) + "%.");
     }
   else if(c.cmd == "approve" || c.cmd == "reject")
     {
      if(!g_pending.valid || g_pending.id != c.signalId)
        { Ack(c, false, "No pending signal with that id (it may have expired)."); return; }
      if(c.cmd == "reject")
        {
         g_log.Event("signal_rejected", JStr("signal_id", g_pending.id) + "," + JStr("by", c.source));
         ClearPending();
         Ack(c, true, "Signal rejected.");
         return;
        }
      string why;
      SGGSignal s = g_pending;
      ClearPending();
      if(ExecuteSignal(s, "approved", why))
         Ack(c, true, "Trade placed.");
      else
        {
         g_log.Event("trade_rejected", JStr("signal_id", s.id) + "," + JStr("why", why));
         Ack(c, false, "Trade not placed: " + why);
        }
     }
   else if(c.cmd == "resetkill")
     {
      if(c.value != "CONFIRM")
        { Ack(c, false, "Send resetkill CONFIRM to reset the kill switch."); return; }
      if(g_risk.DrawdownLimitHit())
        { Ack(c, false, "Drawdown is still beyond the limit. Raise the limit in EA settings or deposit first."); return; }
      g_rt.killSwitch = false;
      g_rt.paused = true;
      SaveRuntime();
      Ack(c, true, "Kill switch reset. Trading is paused; send resume when ready.");
     }
   else if(c.cmd == "status")
     {
      WriteState(true);
      Ack(c, true, "State refreshed.");
     }
   else
      Ack(c, false, "Unknown command.");
  }

void ProcessCommands()
  {
   SGGCommand cmds[];
   int n = g_bridge.ReadCommands(cmds);
   for(int i = 0; i < n; i++)
      ProcessCommand(cmds[i]);
   if(n > 0)
      WriteState(true);
  }

//+------------------------------------------------------------------+
void SafetyChecks()
  {
   g_risk.Update();

   if(!g_rt.killSwitch && g_risk.DrawdownLimitHit())
     {
      g_rt.killSwitch = true;
      SaveRuntime();
      ClearPending();
      DoCloseAll("overall drawdown limit");
      g_log.Event("kill_switch", JNum("drawdown_pct", g_risk.DrawdownPct(), 2) + "," +
                  JNum("limit_pct", InpMaxDrawdownPct, 2));
     }

   int day = g_risk.CurrentDayKey();
   if(g_risk.DailyLimitHit() && (int)g_risk.GetFlag("dailyStop") != day)
     {
      g_risk.SetFlag("dailyStop", day);
      ClearPending();
      DoCloseAll("daily loss limit");
      g_log.Event("daily_limit", JNum("daily_loss_pct", g_risk.DailyLossPct(), 2) + "," +
                  JNum("limit_pct", InpDailyLossPct, 2));
     }

   if(InpCloseBeforeWeekend && g_sess.IsWeekendCloseTime() && g_risk.OpenPositions() > 0 && g_weekendClosedKey != day)
     {
      g_weekendClosedKey = day;
      DoCloseAll("weekend close");
     }

   if(g_pending.valid && g_clock.NowServer() > g_pendingExpire)
     {
      g_log.Event("signal_expired", JStr("signal_id", g_pending.id));
      ClearPending();
     }
  }

void ManagePositions()
  {
   string events[];
   g_exec.Manage(InpUseBreakEven, InpBreakEvenAtR, InpPartialClosePct, InpPartialCloseAtR, events);
   for(int i = 0; i < ArraySize(events); i++)
      g_log.Event("trade_managed", JStr("action", events[i]));
  }

//+------------------------------------------------------------------+
string PositionsJson()
  {
   string out = "[";
   bool first = true;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      if(!first)
         out += ",";
      first = false;
      out += "{" + JInt("position_id", PositionGetInteger(POSITION_IDENTIFIER)) + "," +
             JStr("side", PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL") + "," +
             JNum("lots", PositionGetDouble(POSITION_VOLUME), 2) + "," +
             JNum("open", PositionGetDouble(POSITION_PRICE_OPEN), _Digits) + "," +
             JNum("sl", PositionGetDouble(POSITION_SL), _Digits) + "," +
             JNum("tp", PositionGetDouble(POSITION_TP), _Digits) + "," +
             JNum("profit", PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2) + "}";
     }
   return out + "]";
  }

string NewsJson()
  {
   SGGNewsEvent ev[];
   int n = g_news.Upcoming(g_clock.NowServer(), 36, ev);
   string out = "[";
   for(int i = 0; i < n && i < 10; i++)
     {
      if(i > 0)
         out += ",";
      out += "{" + JInt("ts_utc", (long)g_clock.ServerToGMT(ev[i].timeServer)) + "," +
             JStr("currency", ev[i].currency) + "," + JStr("name", ev[i].name) + "}";
     }
   return out + "]";
  }

void WriteState(const bool force)
  {
   if(!g_bridge.Enabled())
      return;
   datetime now = g_clock.NowServer();
   if(!force && now - g_lastStateWrite < InpStateIntervalSec)
      return;
   g_lastStateWrite = now;

   double asiaHi = 0.0, asiaLo = 0.0;
   g_sess.AsiaRange(asiaHi, asiaLo);
   string why = "";
   bool newsBlocked = g_news.IsBlocked(now, why);

   string json = "{" +
      JStr("version", GG_VERSION) + "," +
      JStr("symbol", _Symbol) + "," +
      JStr("strategy", g_strategy != NULL ? g_strategy.Name() : "") + "," +
      JStr("server_time", TimeToString(now, TIME_DATE | TIME_SECONDS)) + "," +
      JInt("ts_utc", (long)g_clock.ServerToGMT(now)) + "," +
      JStr("mode", GG_ModeName(g_rt.mode)) + "," +
      JStr("direction", GG_DirectionName(g_rt.direction)) + "," +
      JNum("risk_pct", g_rt.riskPct, 2) + "," +
      JNum("max_risk_pct", InpMaxRiskPercent, 2) + "," +
      JBool("paused", g_rt.paused) + "," +
      JBool("kill_switch", g_rt.killSwitch) + "," +
      JStr("currency", AccountInfoString(ACCOUNT_CURRENCY)) + "," +
      JNum("balance", AccountInfoDouble(ACCOUNT_BALANCE), 2) + "," +
      JNum("equity", AccountInfoDouble(ACCOUNT_EQUITY), 2) + "," +
      JNum("day_reference", g_risk.DayReference(), 2) + "," +
      JNum("daily_loss_pct", g_risk.DailyLossPct(), 2) + "," +
      JNum("daily_limit_pct", InpDailyLossPct, 2) + "," +
      JNum("drawdown_pct", g_risk.DrawdownPct(), 2) + "," +
      JNum("drawdown_limit_pct", InpMaxDrawdownPct, 2) + "," +
      JInt("open_trades", g_risk.OpenPositions()) + "," +
      JInt("max_open_trades", InpMaxOpenTrades) + "," +
      JInt("trades_today", g_risk.TradesToday()) + "," +
      JInt("max_trades_per_day", InpMaxTradesPerDay) + "," +
      JNum("spread_points", g_exec.SpreadPoints(), 0) + "," +
      JStr("session", g_sess.CurrentSessionName()) + "," +
      JBool("trading_window", g_sess.IsTradingWindow()) + "," +
      JBool("news_blocked", newsBlocked) + "," +
      JStr("news_reason", why) + "," +
      JBool("news_calendar_ok", g_news.CalendarOk()) + "," +
      JNum("asia_high", asiaHi, _Digits) + "," +
      JNum("asia_low", asiaLo, _Digits) + "," +
      JNum("pdh", iHigh(_Symbol, PERIOD_D1, 1), _Digits) + "," +
      JNum("pdl", iLow(_Symbol, PERIOD_D1, 1), _Digits) + "," +
      JNum("pwh", iHigh(_Symbol, PERIOD_W1, 1), _Digits) + "," +
      JNum("pwl", iLow(_Symbol, PERIOD_W1, 1), _Digits) + "," +
      JBool("pending_signal", g_pending.valid) + "," +
      JRaw("positions", PositionsJson()) + "," +
      JRaw("upcoming_news", NewsJson()) +
      "}";
   g_bridge.WriteState(json);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      Print("[GG] Warning: designed for XAU/USD, attached to ", _Symbol);

   g_clock.Init(InpTesterGMTOffset);
   if(!g_sess.Init(GetPointer(g_clock), _Symbol, InpSession1Start, InpSession1End, InpSession2Start, InpSession2End,
                   InpAsiaStart, InpAsiaEnd, InpRolloverStart, InpRolloverEnd, InpFridayCutoff, InpWeekendClose))
      return INIT_PARAMETERS_INCORRECT;
   if(InpRiskPercent <= 0.0 || InpMaxRiskPercent <= 0.0 || InpDailyLossPct <= 0.0 || InpMaxDrawdownPct <= 0.0)
     {
      Print("[GG] Risk inputs must be positive.");
      return INIT_PARAMETERS_INCORRECT;
     }

   g_bridge.Init(InpBridgeFolder, !GG_IsTester() || InpBridgeInTester);
   g_log.Init(GetPointer(g_bridge), GetPointer(g_clock), _Symbol);
   g_news.Init(GetPointer(g_clock), InpNewsFilter, InpNewsCurrencies, InpNewsMinutesBefore, InpNewsMinutesAfter, InpNewsCsvFile);
   g_risk.Init(_Symbol, InpMagic, GetPointer(g_clock));
   g_exec.Init(_Symbol, InpMagic, InpMaxSlippagePoints, GetPointer(g_risk));

   g_strategy = new CGGStrategyKeyLevelRetest();
   if(!g_strategy.Init(_Symbol))
     {
      Print("[GG] Strategy init failed.");
      return INIT_FAILED;
     }

   LoadRuntime();
   g_pending.valid = false;
   g_bridge.ClearSignal();
   EventSetTimer(1);

   g_log.Event("started", JStr("version", GG_VERSION) + "," + JStr("mode", GG_ModeName(g_rt.mode)) + "," +
               JNum("risk_pct", g_rt.riskPct, 2) + "," + JBool("paused", g_rt.paused) + "," +
               JBool("kill_switch", g_rt.killSwitch) + "," + JStr("strategy", g_strategy.Name()));
   WriteState(true);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   g_log.Event("stopped", JInt("reason", reason));
   if(g_strategy != NULL)
     {
      delete g_strategy;
      g_strategy = NULL;
     }
  }

void OnTick()
  {
   SafetyChecks();
   ManagePositions();

   datetime bar = iTime(_Symbol, g_strategy.Timeframe(), 0);
   if(bar == 0 || bar == g_lastBar)
      return;
   g_lastBar = bar;

   if(g_rt.killSwitch || g_rt.paused)
      return;
   SGGSignal s;
   s.valid = false;
   if(g_strategy.Evaluate(s) && s.valid)
      HandleSignal(s);
  }

void OnTimer()
  {
   ProcessCommands();
   SafetyChecks();
   g_news.Refresh();
   if(!GG_IsTester() && g_news.Enabled() && !g_news.CalendarOk() && !g_calendarWarned)
     {
      g_calendarWarned = true;
      g_log.Warn("Economic calendar unavailable; news filter cannot see events. Check broker/terminal calendar.");
     }
   WriteState(false);
  }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   if(!HistoryDealSelect(trans.deal))
      return;
   if(HistoryDealGetString(trans.deal, DEAL_SYMBOL) != _Symbol)
      return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic)
      return;
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY)
      return;

   ulong posId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   if(PositionSelectByTicket(posId))
      return; // partial close; final result is reported when fully closed

   long dealReason = HistoryDealGetInteger(trans.deal, DEAL_REASON);
   string why = "closed";
   if(dealReason == DEAL_REASON_SL)          why = "stop loss";
   else if(dealReason == DEAL_REASON_TP)     why = "take profit";
   else if(dealReason == DEAL_REASON_SO)     why = "stop out";
   else if(dealReason == DEAL_REASON_EXPERT) why = "closed by system";
   else if(dealReason == DEAL_REASON_CLIENT || dealReason == DEAL_REASON_MOBILE || dealReason == DEAL_REASON_WEB)
      why = "closed manually";

   double net = 0.0, volIn = 0.0, openPrice = 0.0;
   string side = "";
   if(HistorySelectByPosition(posId))
     {
      for(int i = 0; i < HistoryDealsTotal(); i++)
        {
         ulong d = HistoryDealGetTicket(i);
         if(d == 0)
            continue;
         net += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) +
                HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_FEE);
         if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
           {
            volIn += HistoryDealGetDouble(d, DEAL_VOLUME);
            openPrice = HistoryDealGetDouble(d, DEAL_PRICE);
            side = (HistoryDealGetInteger(d, DEAL_TYPE) == DEAL_TYPE_BUY) ? "BUY" : "SELL";
           }
        }
     }
   double riskMoney = g_risk.PositionRiskMoney(posId);
   double r = (riskMoney > 0.0) ? net / riskMoney : 0.0;
   g_log.Event("trade_closed",
               JInt("position_id", (long)posId) + "," +
               JStr("side", side) + "," +
               JNum("lots", volIn, 2) + "," +
               JNum("open", openPrice, _Digits) + "," +
               JNum("close", HistoryDealGetDouble(trans.deal, DEAL_PRICE), _Digits) + "," +
               JNum("net", net, 2) + "," +
               JNum("r", r, 2) + "," +
               JNum("risk_money", riskMoney, 2) + "," +
               JStr("close_reason", why) + "," +
               JNum("balance", AccountInfoDouble(ACCOUNT_BALANCE), 2));
   g_risk.ForgetPosition(posId);
   WriteState(true);
  }

double OnTester()
  {
   double pf = TesterStatistics(STAT_PROFIT_FACTOR);
   double dd = TesterStatistics(STAT_EQUITY_DDREL_PERCENT);
   return (dd > 0.0) ? pf / dd : pf;
  }
//+------------------------------------------------------------------+
