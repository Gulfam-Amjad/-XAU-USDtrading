//+------------------------------------------------------------------+
//| GoldGuardian - Strategy.mqh                                      |
//| IStrategy: the only part that changes when the course rules are  |
//| finalised. StrategyKeyLevelRetest is v0, a PLACEHOLDER built     |
//| from the course topic names. It is not a validated strategy.     |
//+------------------------------------------------------------------+
#ifndef GG_STRATEGY_MQH
#define GG_STRATEGY_MQH

#include "Config.mqh"
#include "KeyLevels.mqh"
#include "MarketStructure.mqh"
#include "Candles.mqh"

struct SGGSignal
  {
   bool              valid;
   string            id;
   int               dir;        // 1 buy, -1 sell
   double            entry;
   double            sl;
   double            tp;
   double            rr;
   string            level;
   string            reason;
   datetime          barTime;
  };

class IStrategy
  {
public:
   virtual          ~IStrategy() {}
   virtual bool      Init(const string symbol) = 0;
   virtual string    Name() const = 0;
   virtual ENUM_TIMEFRAMES Timeframe() const = 0;
   //--- called once per closed bar of Timeframe()
   virtual bool      Evaluate(SGGSignal &sig) = 0;
  };

//+------------------------------------------------------------------+
//| v0: Daily bias + momentum re-test of a key level + candle        |
//|  1. Daily structure gives bias; H4 must not oppose it.           |
//|  2. A key level was broken within the lookback with displacement |
//|  3. The last closed candle re-tests the level and closes back    |
//|     on the trend side with an engulfing or pin bar.              |
//|  4. Stop beyond the level / candle; target = next opposing level |
//|     if reward:risk >= MinRR, otherwise DefaultRR if no level.    |
//+------------------------------------------------------------------+
class CGGStrategyKeyLevelRetest : public IStrategy
  {
private:
   string            m_symbol;
   CGGKeyLevels      m_levels;
   int               m_atrEntry;
   int               m_atrH4;

   double            Atr(const int handle) const
     {
      double b[];
      if(CopyBuffer(handle, 0, 1, 1, b) != 1)
         return 0.0;
      return b[0];
     }

   bool              BrokeAndHeld(const MqlRates &r[], const int dir, const double lvl,
                                  const double minDisplacement, const int lookback) const
     {
      int n = MathMin(ArraySize(r), lookback);
      int breakIdx = -1;
      for(int k = 2; k < n; k++)
        {
         bool otherSide = (dir > 0) ? (r[k].close < lvl) : (r[k].close > lvl);
         if(otherSide)
           {
            breakIdx = k;
            break;
           }
        }
      if(breakIdx <= 2)
         return false;
      double extreme = (dir > 0) ? r[1].high : r[1].low;
      for(int k = 2; k < breakIdx; k++)
         extreme = (dir > 0) ? MathMax(extreme, r[k].high) : MathMin(extreme, r[k].low);
      return (dir > 0) ? (extreme - lvl >= minDisplacement) : (lvl - extreme >= minDisplacement);
     }

public:
                     CGGStrategyKeyLevelRetest() : m_atrEntry(INVALID_HANDLE), m_atrH4(INVALID_HANDLE) {}

                    ~CGGStrategyKeyLevelRetest()
     {
      if(m_atrEntry != INVALID_HANDLE) IndicatorRelease(m_atrEntry);
      if(m_atrH4 != INVALID_HANDLE)    IndicatorRelease(m_atrH4);
     }

   virtual bool      Init(const string symbol)
     {
      m_symbol = symbol;
      m_levels.Init(symbol);
      m_atrEntry = iATR(symbol, InpEntryTF, 14);
      m_atrH4    = iATR(symbol, PERIOD_H4, 14);
      return m_atrEntry != INVALID_HANDLE && m_atrH4 != INVALID_HANDLE;
     }

   virtual string    Name() const { return "KeyLevelRetest v0 (placeholder)"; }
   virtual ENUM_TIMEFRAMES Timeframe() const { return InpEntryTF; }

   virtual bool      Evaluate(SGGSignal &sig)
     {
      sig.valid = false;
      int biasD1 = CGGStructure::Bias(m_symbol, PERIOD_D1, InpSwingStrength, InpStructureLookback);
      if(biasD1 == 0)
         return false;
      int biasH4 = CGGStructure::Bias(m_symbol, PERIOD_H4, InpSwingStrength, InpStructureLookback);
      if(InpRequireH4Agree && biasH4 == -biasD1)
         return false;

      double atr = Atr(m_atrEntry);
      double atrH4 = Atr(m_atrH4);
      if(atr <= 0.0 || atrH4 <= 0.0)
         return false;

      MqlRates r[];
      ArraySetAsSeries(r, true);
      int need = InpRetestLookback + 3;
      if(CopyRates(m_symbol, InpEntryTF, 0, need, r) < need)
         return false;
      MqlRates c = r[1];
      MqlRates p = r[2];

      if(m_levels.Build(atrH4 * InpClusterAtrMult, true, InpSwingStrength, InpStructureLookback) == 0)
         return false;

      int dir = biasD1;
      double tol = atr * InpRetestTolAtr;
      string pattern = GG_ConfirmPattern(dir, c, p, InpEngulfMinRatio, InpPinWickRatio);
      if(pattern == "")
         return false;

      MqlTick tick;
      if(!SymbolInfoTick(m_symbol, tick))
         return false;
      double entry = (dir > 0) ? tick.ask : tick.bid;

      //--- nearest qualifying level to price first
      int best = -1;
      double bestDist = DBL_MAX;
      for(int i = 0; i < m_levels.Count(); i++)
        {
         double lvl = m_levels.Price(i);
         bool touched = (dir > 0) ? (c.low <= lvl + tol && c.close > lvl)
                                  : (c.high >= lvl - tol && c.close < lvl);
         if(!touched)
            continue;
         if(!BrokeAndHeld(r, dir, lvl, atr * InpBreakMinAtr, InpRetestLookback))
            continue;
         double dist = MathAbs(entry - lvl);
         if(dist < bestDist)
           {
            bestDist = dist;
            best = i;
           }
        }
      if(best < 0)
         return false;

      double lvl = m_levels.Price(best);
      double sl = (dir > 0) ? MathMin(c.low, lvl - tol) - atr * InpSlBufferAtr
                            : MathMax(c.high, lvl + tol) + atr * InpSlBufferAtr;
      double risk = (entry - sl) * dir;
      double minRisk = atr * InpMinSlAtr;
      if(risk < minRisk)
        {
         sl = entry - dir * minRisk;
         risk = minRisk;
        }
      if(risk <= 0.0)
         return false;

      double target = 0.0;
      string targetLabel = "";
      double nextLvl;
      string nextLabel;
      bool hasNext = (dir > 0) ? m_levels.NearestAbove(entry + tol, nextLvl, nextLabel)
                               : m_levels.NearestBelow(entry - tol, nextLvl, nextLabel);
      if(hasNext)
        {
         double rr = (nextLvl - entry) * dir / risk;
         if(rr < InpMinRR)
            return false;
         target = nextLvl;
         targetLabel = nextLabel;
        }
      else
        {
         target = entry + dir * risk * InpDefaultRR;
         targetLabel = IntegerToString((int)InpDefaultRR) + "R";
        }

      sig.valid   = true;
      sig.dir     = dir;
      sig.entry   = entry;
      sig.sl      = sl;
      sig.tp      = target;
      sig.rr      = (target - entry) * dir / risk;
      sig.level   = m_levels.Label(best) + " " + DoubleToString(lvl, _Digits);
      sig.barTime = c.time;
      sig.id      = IntegerToString((long)c.time) + (dir > 0 ? "B" : "S");
      sig.reason  = "Daily " + CGGStructure::BiasName(biasD1) +
                    ", H4 " + CGGStructure::BiasName(biasH4) +
                    ", re-test of " + sig.level +
                    " + " + pattern + " on " + EnumToString(InpEntryTF) +
                    ", target " + targetLabel;
      return true;
     }
  };

#endif
