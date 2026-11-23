//+------------------------------------------------------------------+
//| GoldGuardian - Executor.mqh                                      |
//| Order placement with retries, duplicate protection, stop checks, |
//| break-even, partial close and close-all.                         |
//+------------------------------------------------------------------+
#ifndef GG_EXECUTOR_MQH
#define GG_EXECUTOR_MQH

#include <Trade\Trade.mqh>
#include "RiskManager.mqh"

class CGGExecutor
  {
private:
   CTrade            m_trade;
   string            m_symbol;
   long              m_magic;
   CGGRisk          *m_risk;

   double            NormPrice(const double p) const
     {
      double ts = SymbolInfoDouble(m_symbol, SYMBOL_TRADE_TICK_SIZE);
      int digits = (int)SymbolInfoInteger(m_symbol, SYMBOL_DIGITS);
      if(ts > 0.0)
         return NormalizeDouble(MathRound(p / ts) * ts, digits);
      return NormalizeDouble(p, digits);
     }

   double            NormVolume(const double v) const
     {
      double step = SymbolInfoDouble(m_symbol, SYMBOL_VOLUME_STEP);
      if(step <= 0.0)
         step = 0.01;
      int digits = (int)MathMax(0, MathCeil(-MathLog10(step)));
      return NormalizeDouble(MathFloor(v / step + 1e-9) * step, digits);
     }

   bool              Retryable(const uint rc) const
     {
      return rc == TRADE_RETCODE_REQUOTE || rc == TRADE_RETCODE_PRICE_CHANGED ||
             rc == TRADE_RETCODE_PRICE_OFF || rc == TRADE_RETCODE_TIMEOUT ||
             rc == TRADE_RETCODE_CONNECTION || rc == TRADE_RETCODE_TOO_MANY_REQUESTS;
     }

   //--- duplicate guard: a position with this comment already exists
   ulong             FindByComment(const string comment) const
     {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if(PositionGetString(POSITION_SYMBOL) == m_symbol &&
            PositionGetInteger(POSITION_MAGIC) == m_magic &&
            PositionGetString(POSITION_COMMENT) == comment)
            return t;
        }
      return 0;
     }

public:
                     CGGExecutor() : m_risk(NULL) {}

   void              Init(const string symbol, const long magic, const int slippagePoints, CGGRisk *risk)
     {
      m_symbol = symbol;
      m_magic  = magic;
      m_risk   = risk;
      m_trade.SetExpertMagicNumber((ulong)magic);
      m_trade.SetDeviationInPoints((ulong)slippagePoints);
      m_trade.SetTypeFillingBySymbol(symbol);
      m_trade.SetMarginMode();
      m_trade.LogLevel(LOG_LEVEL_ERRORS);
     }

   double            SpreadPoints() const
     {
      return (double)SymbolInfoInteger(m_symbol, SYMBOL_SPREAD);
     }

   bool              ValidateStops(const int dir, const double price, const double sl, const double tp, string &why) const
     {
      why = "";
      double point = SymbolInfoDouble(m_symbol, SYMBOL_POINT);
      double minDist = (double)SymbolInfoInteger(m_symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;
      if(sl <= 0.0)
        { why = "stop loss missing"; return false; }
      if(dir > 0)
        {
         if(sl >= price - minDist) { why = "stop loss too close or above price"; return false; }
         if(tp > 0.0 && tp <= price + minDist) { why = "take profit too close or below price"; return false; }
        }
      else
        {
         if(sl <= price + minDist) { why = "stop loss too close or below price"; return false; }
         if(tp > 0.0 && tp >= price - minDist) { why = "take profit too close or above price"; return false; }
        }
      return true;
     }

   //--- returns position ticket (0 on failure). Every order carries SL.
   ulong             Open(const int dir, const double lots, const double sl, const double tp,
                          const string comment, string &err)
     {
      err = "";
      ulong existing = FindByComment(comment);
      if(existing > 0)
        {
         err = "duplicate: position already open for this signal";
         return 0;
        }
      double nsl = NormPrice(sl);
      double ntp = (tp > 0.0) ? NormPrice(tp) : 0.0;
      double vol = NormVolume(lots);
      if(vol <= 0.0)
        {
         err = "invalid volume";
         return 0;
        }

      for(int attempt = 0; attempt < 3; attempt++)
        {
         MqlTick tick;
         if(!SymbolInfoTick(m_symbol, tick))
           {
            err = "no price";
            Sleep(300);
            continue;
           }
         double price = (dir > 0) ? tick.ask : tick.bid;
         string why;
         if(!ValidateStops(dir, price, nsl, ntp, why))
           {
            err = why;
            return 0;
           }
         bool sent = (dir > 0) ? m_trade.Buy(vol, m_symbol, price, nsl, ntp, comment)
                               : m_trade.Sell(vol, m_symbol, price, nsl, ntp, comment);
         uint rc = m_trade.ResultRetcode();
         if(sent && (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED))
           {
            ulong pos = FindByComment(comment);
            return (pos > 0) ? pos : m_trade.ResultOrder();
           }
         err = "retcode " + IntegerToString(rc) + " " + m_trade.ResultRetcodeDescription();
         if(!Retryable(rc))
            return 0;
         Sleep(400);
         //--- a timed-out request may still have been filled
         ulong filled = FindByComment(comment);
         if(filled > 0)
            return filled;
        }
      return 0;
     }

   int               CloseAll(string &report)
     {
      report = "";
      int closed = 0;
      for(int pass = 0; pass < 3; pass++)
        {
         int remaining = 0;
         for(int i = PositionsTotal() - 1; i >= 0; i--)
           {
            ulong t = PositionGetTicket(i);
            if(t == 0)
               continue;
            if(PositionGetString(POSITION_SYMBOL) != m_symbol || PositionGetInteger(POSITION_MAGIC) != m_magic)
               continue;
            if(m_trade.PositionClose(t))
               closed++;
            else
               remaining++;
           }
         if(remaining == 0)
            break;
         Sleep(500);
        }
      int left = m_risk.OpenPositions();
      report = IntegerToString(closed) + " closed" + (left > 0 ? ", " + IntegerToString(left) + " could not be closed" : "");
      return left;
     }

   //--- break-even and partial close; fills events[] with human-readable actions
   void              Manage(const bool useBE, const double beAtR, const double partialPct,
                            const double partialAtR, string &events[])
     {
      ArrayResize(events, 0);
      double point = SymbolInfoDouble(m_symbol, SYMBOL_POINT);
      double vmin  = SymbolInfoDouble(m_symbol, SYMBOL_VOLUME_MIN);
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if(PositionGetString(POSITION_SYMBOL) != m_symbol || PositionGetInteger(POSITION_MAGIC) != m_magic)
            continue;
         ulong posId = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
         int dir     = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
         double open = PositionGetDouble(POSITION_PRICE_OPEN);
         double sl   = PositionGetDouble(POSITION_SL);
         double tp   = PositionGetDouble(POSITION_TP);
         double vol  = PositionGetDouble(POSITION_VOLUME);
         double cur  = PositionGetDouble(POSITION_PRICE_CURRENT);
         double riskPrice = m_risk.PositionRiskPrice(posId);
         if(riskPrice <= 0.0)
            continue;
         double r = (cur - open) * dir / riskPrice;

         if(partialPct > 0.0 && r >= partialAtR && !m_risk.PartialDone(posId))
           {
            double closeVol = NormVolume(vol * partialPct / 100.0);
            if(closeVol >= vmin && vol - closeVol >= vmin - 1e-9)
              {
               if(m_trade.PositionClosePartial(t, closeVol))
                 {
                  m_risk.MarkPartialDone(posId);
                  int k = ArraySize(events);
                  ArrayResize(events, k + 1);
                  events[k] = "partial close " + DoubleToString(closeVol, 2) + " lots on #" + IntegerToString((long)posId);
                 }
              }
            else
               m_risk.MarkPartialDone(posId);
           }

         if(useBE && r >= beAtR)
           {
            double spread = SymbolInfoInteger(m_symbol, SYMBOL_SPREAD) * point;
            double be = NormPrice(open + dir * spread);
            bool needs = (dir > 0) ? (sl < be) : (sl > be || sl == 0.0);
            if(needs)
              {
               string why;
               if(ValidateStops(dir, cur, be, tp, why) && m_trade.PositionModify(t, be, tp))
                 {
                  int k = ArraySize(events);
                  ArrayResize(events, k + 1);
                  events[k] = "stop moved to break-even on #" + IntegerToString((long)posId);
                 }
              }
           }
        }
     }
  };

#endif
