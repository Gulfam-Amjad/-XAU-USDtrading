//+------------------------------------------------------------------+
//| GoldGuardian - Candles.mqh                                       |
//| Candlestick confirmation patterns with measurable ratios.        |
//+------------------------------------------------------------------+
#ifndef GG_CANDLES_MQH
#define GG_CANDLES_MQH

double GG_Body(const MqlRates &c)  { return MathAbs(c.close - c.open); }
double GG_Range(const MqlRates &c) { return c.high - c.low; }

bool GG_BullEngulf(const MqlRates &c, const MqlRates &p, const double minRatio)
  {
   return c.close > c.open && p.close < p.open &&
          c.close >= p.open && c.open <= p.close &&
          GG_Body(c) >= GG_Body(p) * minRatio && GG_Body(c) > 0.0;
  }

bool GG_BearEngulf(const MqlRates &c, const MqlRates &p, const double minRatio)
  {
   return c.close < c.open && p.close > p.open &&
          c.close <= p.open && c.open >= p.close &&
          GG_Body(c) >= GG_Body(p) * minRatio && GG_Body(c) > 0.0;
  }

bool GG_BullPin(const MqlRates &c, const double wickRatio)
  {
   double range = GG_Range(c);
   if(range <= 0.0)
      return false;
   double lowerWick = MathMin(c.open, c.close) - c.low;
   return lowerWick >= range * wickRatio && GG_Body(c) <= range * 0.35 && c.close >= c.low + range * 0.5;
  }

bool GG_BearPin(const MqlRates &c, const double wickRatio)
  {
   double range = GG_Range(c);
   if(range <= 0.0)
      return false;
   double upperWick = c.high - MathMax(c.open, c.close);
   return upperWick >= range * wickRatio && GG_Body(c) <= range * 0.35 && c.close <= c.high - range * 0.5;
  }

bool GG_InsideBar(const MqlRates &c, const MqlRates &p)
  {
   return c.high <= p.high && c.low >= p.low;
  }

//--- returns pattern name or "" when no bullish/bearish confirmation
string GG_ConfirmPattern(const int dir, const MqlRates &c, const MqlRates &p,
                         const double engulfRatio, const double pinRatio)
  {
   if(dir > 0)
     {
      if(GG_BullEngulf(c, p, engulfRatio)) return "bullish engulfing";
      if(GG_BullPin(c, pinRatio))          return "bullish pin bar";
     }
   else
     {
      if(GG_BearEngulf(c, p, engulfRatio)) return "bearish engulfing";
      if(GG_BearPin(c, pinRatio))          return "bearish pin bar";
     }
   return "";
  }

#endif
