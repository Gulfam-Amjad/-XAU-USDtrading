//+------------------------------------------------------------------+
//| GoldGuardian - RiskManager.mqh                                   |
//| Position sizing, loss limits, exposure limits, kill switch data. |
//| Daily and overall loss include floating P/L (prop-firm style).   |
//+------------------------------------------------------------------+
#ifndef GG_RISKMANAGER_MQH
#define GG_RISKMANAGER_MQH

#include "Config.mqh"
#include "Sessions.mqh"

class CGGRisk
  {
private:
   string            m_symbol;
   long              m_magic;
   CGGClock         *m_clock;
   int               m_dayKey;
   double            m_dayRef;
   double            m_startBalance;
   double            m_peakEquity;

   string            GV(const string k) const { return "GG_" + IntegerToString(m_magic) + "_" + k; }

   int               DayKey(const datetime srv) const
     {
      MqlDateTime d;
      TimeToStruct(srv, d);
      return d.year * 10000 + d.mon * 100 + d.day;
     }

   double            LossPerLot(const int dir, const double entry, const double sl) const
     {
      double profit = 0.0;
      ENUM_ORDER_TYPE t = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcProfit(t, m_symbol, 1.0, entry, sl, profit) && profit < 0.0)
         return -profit;
      double tickSize  = SymbolInfoDouble(m_symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(m_symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tickValue <= 0.0)
         tickValue = SymbolInfoDouble(m_symbol, SYMBOL_TRADE_TICK_VALUE);
      if(tickSize <= 0.0 || tickValue <= 0.0)
         return 0.0;
      return MathAbs(entry - sl) / tickSize * tickValue;
     }

public:
                     CGGRisk() : m_clock(NULL), m_dayKey(0), m_dayRef(0), m_startBalance(0), m_peakEquity(0) {}

   void              Init(const string symbol, const long magic, CGGClock *clock)
     {
      m_symbol = symbol;
      m_magic  = magic;
      m_clock  = clock;
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      double eq  = AccountInfoDouble(ACCOUNT_EQUITY);

      if(InpStartingBalance > 0.0)
         m_startBalance = InpStartingBalance;
      else if(GlobalVariableCheck(GV("startBal")))
         m_startBalance = GlobalVariableGet(GV("startBal"));
      else
         m_startBalance = bal;
      GlobalVariableSet(GV("startBal"), m_startBalance);

      m_peakEquity = GlobalVariableCheck(GV("peakEq")) ? GlobalVariableGet(GV("peakEq")) : MathMax(bal, eq);

      if(GlobalVariableCheck(GV("dayKey")) && GlobalVariableCheck(GV("dayRef")))
        {
         m_dayKey = (int)GlobalVariableGet(GV("dayKey"));
         m_dayRef = GlobalVariableGet(GV("dayRef"));
        }
      Update();
     }

   //--- call on every tick / timer
   void              Update()
     {
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
      int key = DayKey(m_clock.NowServer());
      if(key != m_dayKey || m_dayRef <= 0.0)
        {
         m_dayKey = key;
         m_dayRef = InpPropMode ? MathMax(bal, eq) : bal;
         GlobalVariableSet(GV("dayKey"), m_dayKey);
         GlobalVariableSet(GV("dayRef"), m_dayRef);
        }
      if(eq > m_peakEquity)
        {
         m_peakEquity = eq;
         GlobalVariableSet(GV("peakEq"), m_peakEquity);
        }
     }

   int               CurrentDayKey() const { return m_dayKey; }
   double            DayReference() const { return m_dayRef; }
   double            StartBalance() const { return m_startBalance; }
   double            PeakEquity() const { return m_peakEquity; }

   double            DailyLossMoney() const
     {
      return MathMax(0.0, m_dayRef - AccountInfoDouble(ACCOUNT_EQUITY));
     }

   double            DailyLossPct() const
     {
      return (m_dayRef > 0.0) ? DailyLossMoney() / m_dayRef * 100.0 : 0.0;
     }

   double            DrawdownRef() const
     {
      return (InpDrawdownMode == GG_DD_TRAILING) ? m_peakEquity : m_startBalance;
     }

   double            DrawdownMoney() const
     {
      return MathMax(0.0, DrawdownRef() - AccountInfoDouble(ACCOUNT_EQUITY));
     }

   double            DrawdownPct() const
     {
      double ref = DrawdownRef();
      return (ref > 0.0) ? DrawdownMoney() / ref * 100.0 : 0.0;
     }

   bool              DailyLimitHit() const { return DailyLossPct() >= InpDailyLossPct; }
   bool              DrawdownLimitHit() const { return DrawdownPct() >= InpMaxDrawdownPct; }

   int               OpenPositions() const
     {
      int n = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if(PositionGetString(POSITION_SYMBOL) == m_symbol && PositionGetInteger(POSITION_MAGIC) == m_magic)
            n++;
        }
      return n;
     }

   //--- money lost if every open position hits its current stop
   double            OpenRiskMoney() const
     {
      double total = 0.0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if(PositionGetString(POSITION_SYMBOL) != m_symbol || PositionGetInteger(POSITION_MAGIC) != m_magic)
            continue;
         double sl    = PositionGetDouble(POSITION_SL);
         double open  = PositionGetDouble(POSITION_PRICE_OPEN);
         double vol   = PositionGetDouble(POSITION_VOLUME);
         int    dir   = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
         if(sl <= 0.0)
           {
            total += AccountInfoDouble(ACCOUNT_BALANCE) * InpMaxRiskPercent / 100.0;
            continue;
           }
         if((dir > 0 && sl >= open) || (dir < 0 && sl <= open))
            continue;
         total += LossPerLot(dir, open, sl) * vol;
        }
      return total;
     }

   int               TradesToday() const
     {
      datetime now = m_clock.NowServer();
      datetime dayStart = GG_DateOnly(now);
      if(!HistorySelect(dayStart, now + 60))
         return 0;
      int n = 0;
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong d = HistoryDealGetTicket(i);
         if(d == 0)
            continue;
         if(HistoryDealGetString(d, DEAL_SYMBOL) != m_symbol)
            continue;
         if(HistoryDealGetInteger(d, DEAL_MAGIC) != m_magic)
            continue;
         if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
            n++;
        }
      return n;
     }

   //--- returns 0 when the broker minimum lot would exceed the allowed risk
   double            LotsForRisk(const int dir, const double entry, const double sl,
                                 const double riskPct, double &riskMoney) const
     {
      riskMoney = 0.0;
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double budget  = balance * riskPct / 100.0;
      double perLot  = LossPerLot(dir, entry, sl);
      if(perLot <= 0.0 || budget <= 0.0)
         return 0.0;

      double step = SymbolInfoDouble(m_symbol, SYMBOL_VOLUME_STEP);
      double vmin = SymbolInfoDouble(m_symbol, SYMBOL_VOLUME_MIN);
      double vmax = SymbolInfoDouble(m_symbol, SYMBOL_VOLUME_MAX);
      if(step <= 0.0)
         step = 0.01;

      double lots = MathFloor((budget / perLot) / step + 1e-9) * step;
      lots = MathMin(lots, MathMin(vmax, InpMaxLots));
      if(lots < vmin - 1e-9)
         return 0.0;

      int digits = (int)MathMax(0, MathCeil(-MathLog10(step)));
      lots = NormalizeDouble(lots, digits);
      riskMoney = perLot * lots;
      return lots;
     }

   //--- final gate before any order: limits including the new trade's worst case
   bool              CheckNewTrade(const int dir, const double entry, const double sl,
                                   const double lots, const double riskMoney, string &why) const
     {
      why = "";
      if(sl <= 0.0)
        { why = "no stop loss"; return false; }
      if((dir > 0 && sl >= entry) || (dir < 0 && sl <= entry))
        { why = "stop loss on wrong side of entry"; return false; }
      if(lots <= 0.0)
        { why = "lot size below broker minimum for the allowed risk"; return false; }
      if(OpenPositions() >= InpMaxOpenTrades)
        { why = "max open trades reached"; return false; }
      if(TradesToday() >= InpMaxTradesPerDay)
        { why = "max trades per day reached"; return false; }
      if(DailyLimitHit())
        { why = "daily loss limit reached"; return false; }
      if(DrawdownLimitHit())
        { why = "overall drawdown limit reached"; return false; }

      double worstDaily = DailyLossMoney() + OpenRiskMoney() + riskMoney;
      if(m_dayRef > 0.0 && worstDaily > m_dayRef * InpDailyLossPct / 100.0)
        { why = "trade could breach the daily loss limit if all stops are hit"; return false; }

      double ref = DrawdownRef();
      double worstDD = DrawdownMoney() + OpenRiskMoney() + riskMoney;
      if(ref > 0.0 && worstDD > ref * InpMaxDrawdownPct / 100.0)
        { why = "trade could breach the overall drawdown limit if all stops are hit"; return false; }

      double margin = 0.0;
      ENUM_ORDER_TYPE t = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcMargin(t, m_symbol, lots, entry, margin))
        {
         double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
         if(freeMargin <= 0.0 || margin > freeMargin * InpMaxMarginUsePct / 100.0)
           { why = "not enough free margin within the margin-use limit"; return false; }
        }
      return true;
     }

   //--- per-position stored data (initial risk, partial-close flag)
   void              StorePositionRisk(const ulong posId, const double riskMoney, const double riskPrice)
     {
      GlobalVariableSet(GV("rm_" + IntegerToString((long)posId)), riskMoney);
      GlobalVariableSet(GV("rp_" + IntegerToString((long)posId)), riskPrice);
     }

   double            PositionRiskMoney(const ulong posId) const
     {
      string k = GV("rm_" + IntegerToString((long)posId));
      return GlobalVariableCheck(k) ? GlobalVariableGet(k) : 0.0;
     }

   double            PositionRiskPrice(const ulong posId) const
     {
      string k = GV("rp_" + IntegerToString((long)posId));
      return GlobalVariableCheck(k) ? GlobalVariableGet(k) : 0.0;
     }

   bool              PartialDone(const ulong posId) const { return GlobalVariableCheck(GV("pc_" + IntegerToString((long)posId))); }
   void              MarkPartialDone(const ulong posId) { GlobalVariableSet(GV("pc_" + IntegerToString((long)posId)), 1.0); }

   void              ForgetPosition(const ulong posId)
     {
      string id = IntegerToString((long)posId);
      GlobalVariableDel(GV("rm_" + id));
      GlobalVariableDel(GV("rp_" + id));
      GlobalVariableDel(GV("pc_" + id));
     }

   //--- persisted flags
   void              SetFlag(const string name, const double v) { GlobalVariableSet(GV(name), v); }
   double            GetFlag(const string name, const double def = 0.0) const
     {
      return GlobalVariableCheck(GV(name)) ? GlobalVariableGet(GV(name)) : def;
     }
  };

#endif
