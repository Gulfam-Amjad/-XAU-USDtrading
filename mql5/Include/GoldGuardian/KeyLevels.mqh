//+------------------------------------------------------------------+
//| GoldGuardian - KeyLevels.mqh                                     |
//| Previous day / week / quarter levels, quarterly open, H4 swing   |
//| levels, merged into zones when closer than a tolerance.          |
//+------------------------------------------------------------------+
#ifndef GG_KEYLEVELS_MQH
#define GG_KEYLEVELS_MQH

#include "MarketStructure.mqh"

struct SGGLevel
  {
   double            price;
   string            label;
   int               touches;
  };

class CGGKeyLevels
  {
private:
   string            m_symbol;
   SGGLevel          m_raw[];
   SGGLevel          m_levels[];

   void              AddRaw(const double p, const string label)
     {
      if(p <= 0.0)
         return;
      int k = ArraySize(m_raw);
      ArrayResize(m_raw, k + 1);
      m_raw[k].price   = p;
      m_raw[k].label   = label;
      m_raw[k].touches = 1;
     }

   void              SortRaw()
     {
      int n = ArraySize(m_raw);
      for(int i = 1; i < n; i++)
        {
         SGGLevel key = m_raw[i];
         int j = i - 1;
         while(j >= 0 && m_raw[j].price > key.price)
           {
            m_raw[j + 1] = m_raw[j];
            j--;
           }
         m_raw[j + 1] = key;
        }
     }

   void              AddQuarterLevels()
     {
      MqlDateTime d;
      TimeToStruct(iTime(m_symbol, PERIOD_MN1, 0), d);
      if(d.year < 1980)
         return;
      int k = (d.mon - 1) % 3;
      double qOpen = iOpen(m_symbol, PERIOD_MN1, k);
      AddRaw(qOpen, "QO");
      double hi = 0.0, lo = 0.0;
      for(int s = k + 1; s <= k + 3; s++)
        {
         double h = iHigh(m_symbol, PERIOD_MN1, s);
         double l = iLow(m_symbol, PERIOD_MN1, s);
         if(h <= 0.0 || l <= 0.0)
            return;
         hi = (hi == 0.0) ? h : MathMax(hi, h);
         lo = (lo == 0.0) ? l : MathMin(lo, l);
        }
      AddRaw(hi, "PQH");
      AddRaw(lo, "PQL");
     }

public:
   void              Init(const string symbol) { m_symbol = symbol; }

   int               Build(const double clusterTol, const bool includeSwings,
                           const int swingStrength, const int swingLookback)
     {
      ArrayResize(m_raw, 0);
      ArrayResize(m_levels, 0);

      AddRaw(iHigh(m_symbol, PERIOD_D1, 1), "PDH");
      AddRaw(iLow(m_symbol, PERIOD_D1, 1), "PDL");
      AddRaw(iHigh(m_symbol, PERIOD_W1, 1), "PWH");
      AddRaw(iLow(m_symbol, PERIOD_W1, 1), "PWL");
      AddQuarterLevels();

      if(includeSwings)
        {
         SGGSwing hs[], ls[];
         int nh = CGGStructure::Swings(m_symbol, PERIOD_H4, swingStrength, swingLookback, true, hs);
         int nl = CGGStructure::Swings(m_symbol, PERIOD_H4, swingStrength, swingLookback, false, ls);
         for(int i = 0; i < MathMin(nh, 4); i++)
            AddRaw(hs[i].price, "H4 swing high");
         for(int i = 0; i < MathMin(nl, 4); i++)
            AddRaw(ls[i].price, "H4 swing low");
        }

      SortRaw();
      int n = ArraySize(m_raw);
      for(int i = 0; i < n; i++)
        {
         int k = ArraySize(m_levels);
         if(k > 0 && clusterTol > 0.0 && m_raw[i].price - m_levels[k - 1].price <= clusterTol)
           {
            int t = m_levels[k - 1].touches;
            m_levels[k - 1].price = (m_levels[k - 1].price * t + m_raw[i].price) / (t + 1);
            m_levels[k - 1].touches = t + 1;
            if(StringFind(m_levels[k - 1].label, m_raw[i].label) < 0)
               m_levels[k - 1].label += "+" + m_raw[i].label;
            continue;
           }
         ArrayResize(m_levels, k + 1);
         m_levels[k] = m_raw[i];
        }
      return ArraySize(m_levels);
     }

   int               Count() const { return ArraySize(m_levels); }
   double            Price(const int i) const { return m_levels[i].price; }
   string            Label(const int i) const { return m_levels[i].label; }
   int               Touches(const int i) const { return m_levels[i].touches; }

   bool              NearestAbove(const double price, double &lvl, string &label) const
     {
      for(int i = 0; i < ArraySize(m_levels); i++)
         if(m_levels[i].price > price)
           {
            lvl = m_levels[i].price;
            label = m_levels[i].label;
            return true;
           }
      return false;
     }

   bool              NearestBelow(const double price, double &lvl, string &label) const
     {
      for(int i = ArraySize(m_levels) - 1; i >= 0; i--)
         if(m_levels[i].price < price)
           {
            lvl = m_levels[i].price;
            label = m_levels[i].label;
            return true;
           }
      return false;
     }
  };

#endif
