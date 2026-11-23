//+------------------------------------------------------------------+
//| GoldGuardian - MarketStructure.mqh                               |
//| Swing points, trend bias and break of structure per timeframe.   |
//+------------------------------------------------------------------+
#ifndef GG_MARKETSTRUCTURE_MQH
#define GG_MARKETSTRUCTURE_MQH

struct SGGSwing
  {
   double            price;
   datetime          time;
   int               shift;
  };

class CGGStructure
  {
public:
   //--- most recent first; only closed bars are considered
   static int        Swings(const string symbol, const ENUM_TIMEFRAMES tf, const int strength,
                            const int lookback, const bool highs, SGGSwing &out[])
     {
      ArrayResize(out, 0);
      double px[];
      datetime tm[];
      ArraySetAsSeries(px, true);
      ArraySetAsSeries(tm, true);
      int need = lookback + strength + 2;
      int n = highs ? CopyHigh(symbol, tf, 0, need, px) : CopyLow(symbol, tf, 0, need, px);
      if(n < 2 * strength + 3 || CopyTime(symbol, tf, 0, need, tm) != n)
         return 0;
      for(int i = strength + 1; i < n - strength; i++)
        {
         bool ok = true;
         for(int j = 1; j <= strength && ok; j++)
           {
            if(highs)
               ok = px[i] > px[i - j] && px[i] >= px[i + j];
            else
               ok = px[i] < px[i - j] && px[i] <= px[i + j];
           }
         if(!ok)
            continue;
         int k = ArraySize(out);
         ArrayResize(out, k + 1);
         out[k].price = px[i];
         out[k].time  = tm[i];
         out[k].shift = i;
        }
      return ArraySize(out);
     }

   //--- 1 bullish (HH+HL or close above last swing high), -1 bearish, 0 unclear
   static int        Bias(const string symbol, const ENUM_TIMEFRAMES tf, const int strength, const int lookback)
     {
      SGGSwing hs[], ls[];
      if(Swings(symbol, tf, strength, lookback, true, hs) < 2)
         return 0;
      if(Swings(symbol, tf, strength, lookback, false, ls) < 2)
         return 0;
      double lastClose = iClose(symbol, tf, 1);
      if(lastClose <= 0.0)
         return 0;
      bool hh = hs[0].price > hs[1].price;
      bool hl = ls[0].price > ls[1].price;
      bool lh = hs[0].price < hs[1].price;
      bool ll = ls[0].price < ls[1].price;

      if(lastClose > hs[0].price)
         return 1;
      if(lastClose < ls[0].price)
         return -1;
      if(hh && hl)
         return 1;
      if(lh && ll)
         return -1;
      return 0;
     }

   static string     BiasName(const int b)
     {
      if(b > 0) return "bullish";
      if(b < 0) return "bearish";
      return "neutral";
     }
  };

#endif
