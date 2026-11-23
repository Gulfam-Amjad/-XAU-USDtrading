//+------------------------------------------------------------------+
//| GoldGuardian - Sessions.mqh                                      |
//| Server / GMT / UK time conversion and session windows.           |
//| No dependency on EA inputs so the indicator can include it.      |
//+------------------------------------------------------------------+
#ifndef GG_SESSIONS_MQH
#define GG_SESSIONS_MQH

int GG_ParseHHMM(const string s)
  {
   string parts[];
   if(StringSplit(s, ':', parts) != 2)
      return -1;
   int h = (int)StringToInteger(parts[0]);
   int m = (int)StringToInteger(parts[1]);
   if(h < 0 || h > 23 || m < 0 || m > 59)
      return -1;
   return h * 60 + m;
  }

bool GG_InWindow(const int minuteOfDay, const int startMin, const int endMin)
  {
   if(startMin < 0 || endMin < 0)
      return false;
   if(startMin <= endMin)
      return minuteOfDay >= startMin && minuteOfDay < endMin;
   return minuteOfDay >= startMin || minuteOfDay < endMin;
  }

int GG_MinuteOfDay(const datetime t)
  {
   MqlDateTime d;
   TimeToStruct(t, d);
   return d.hour * 60 + d.min;
  }

datetime GG_DateOnly(const datetime t)
  {
   return t - (t % 86400);
  }

//+------------------------------------------------------------------+
class CGGClock
  {
private:
   int               m_testerOffsetHours;

   datetime          LastSundayOfMonth(const int year, const int mon) const
     {
      MqlDateTime s;
      ZeroMemory(s);
      s.year = (mon == 12) ? year + 1 : year;
      s.mon  = (mon == 12) ? 1 : mon + 1;
      s.day  = 1;
      datetime lastDay = StructToTime(s) - 86400;
      MqlDateTime l;
      TimeToStruct(lastDay, l);
      return lastDay - l.day_of_week * 86400;
     }

public:
                     CGGClock() : m_testerOffsetHours(2) {}

   void              Init(const int testerOffsetHours) { m_testerOffsetHours = testerOffsetHours; }

   bool              IsTester() const { return (bool)MQLInfoInteger(MQL_TESTER); }

   datetime          NowServer() const
     {
      if(IsTester())
         return TimeCurrent();
      datetime t = TimeTradeServer();
      return (t > 0) ? t : TimeCurrent();
     }

   int               ServerOffsetSeconds() const
     {
      if(IsTester())
         return m_testerOffsetHours * 3600;
      long diff = (long)TimeTradeServer() - (long)TimeGMT();
      return (int)(MathRound((double)diff / 1800.0) * 1800.0);
     }

   datetime          ServerToGMT(const datetime srv) const { return srv - ServerOffsetSeconds(); }
   datetime          GMTToServer(const datetime gmt) const { return gmt + ServerOffsetSeconds(); }

   //--- UK summer time: last Sunday of March 01:00 GMT to last Sunday of October 01:00 GMT
   bool              IsBST(const datetime gmt) const
     {
      MqlDateTime d;
      TimeToStruct(gmt, d);
      if(d.mon < 3 || d.mon > 10)
         return false;
      if(d.mon > 3 && d.mon < 10)
         return true;
      datetime change = LastSundayOfMonth(d.year, d.mon) + 3600;
      if(d.mon == 3)
         return gmt >= change;
      return gmt < change;
     }

   datetime          GMTToUK(const datetime gmt) const { return gmt + (IsBST(gmt) ? 3600 : 0); }
   datetime          ServerToUK(const datetime srv) const { return GMTToUK(ServerToGMT(srv)); }
   datetime          NowUK() const { return ServerToUK(NowServer()); }

   datetime          UKToServer(const datetime uk) const
     {
      datetime gmt = uk - (IsBST(uk - 3600) ? 3600 : 0);
      return GMTToServer(gmt);
     }
  };

//+------------------------------------------------------------------+
class CGGSessions
  {
private:
   CGGClock         *m_clock;
   string            m_symbol;
   int               m_s1Start, m_s1End, m_s2Start, m_s2End;
   int               m_asiaStart, m_asiaEnd;
   int               m_rollStart, m_rollEnd;
   int               m_fridayCutoff, m_weekendClose;

public:
                     CGGSessions() : m_clock(NULL) {}

   bool              Init(CGGClock *clock, const string symbol,
                          const string s1Start, const string s1End,
                          const string s2Start, const string s2End,
                          const string asiaStart, const string asiaEnd,
                          const string rollStart, const string rollEnd,
                          const string fridayCutoff, const string weekendClose)
     {
      m_clock        = clock;
      m_symbol       = symbol;
      m_s1Start      = GG_ParseHHMM(s1Start);
      m_s1End        = GG_ParseHHMM(s1End);
      m_s2Start      = GG_ParseHHMM(s2Start);
      m_s2End        = GG_ParseHHMM(s2End);
      m_asiaStart    = GG_ParseHHMM(asiaStart);
      m_asiaEnd      = GG_ParseHHMM(asiaEnd);
      m_rollStart    = GG_ParseHHMM(rollStart);
      m_rollEnd      = GG_ParseHHMM(rollEnd);
      m_fridayCutoff = GG_ParseHHMM(fridayCutoff);
      m_weekendClose = GG_ParseHHMM(weekendClose);
      if(m_s1Start < 0 || m_s1End < 0 || m_s2Start < 0 || m_s2End < 0 ||
         m_asiaStart < 0 || m_asiaEnd < 0 || m_rollStart < 0 || m_rollEnd < 0 ||
         m_fridayCutoff < 0 || m_weekendClose < 0)
        {
         Print("[GG] Invalid session time format. Use HH:MM.");
         return false;
        }
      return true;
     }

   int               UKDayOfWeek() const
     {
      MqlDateTime d;
      TimeToStruct(m_clock.NowUK(), d);
      return d.day_of_week;
     }

   string            CurrentSessionName() const
     {
      int m = GG_MinuteOfDay(m_clock.NowUK());
      if(GG_InWindow(m, m_s1Start, m_s1End)) return "session1";
      if(GG_InWindow(m, m_s2Start, m_s2End)) return "session2";
      if(GG_InWindow(m, m_asiaStart, m_asiaEnd)) return "asia";
      return "closed";
     }

   bool              IsTradingWindow() const
     {
      int dow = UKDayOfWeek();
      if(dow == 0 || dow == 6)
         return false;
      int m = GG_MinuteOfDay(m_clock.NowUK());
      return GG_InWindow(m, m_s1Start, m_s1End) || GG_InWindow(m, m_s2Start, m_s2End);
     }

   bool              IsRollover() const
     {
      return GG_InWindow(GG_MinuteOfDay(m_clock.NowUK()), m_rollStart, m_rollEnd);
     }

   bool              IsFridayCutoff() const
     {
      return UKDayOfWeek() == 5 && GG_MinuteOfDay(m_clock.NowUK()) >= m_fridayCutoff;
     }

   bool              IsWeekendCloseTime() const
     {
      int dow = UKDayOfWeek();
      if(dow == 6 || dow == 0)
         return true;
      return dow == 5 && GG_MinuteOfDay(m_clock.NowUK()) >= m_weekendClose;
     }

   //--- high/low of a UK-time window for the current UK day, from M5 bars
   bool              RangeTodayUK(const int startMin, const int endMin, double &hi, double &lo) const
     {
      hi = 0.0;
      lo = 0.0;
      MqlRates r[];
      ArraySetAsSeries(r, true);
      int n = CopyRates(m_symbol, PERIOD_M5, 0, 300, r);
      if(n <= 0)
         return false;
      datetime todayUK = GG_DateOnly(m_clock.NowUK());
      bool found = false;
      for(int i = 0; i < n; i++)
        {
         datetime uk = m_clock.ServerToUK(r[i].time);
         if(GG_DateOnly(uk) != todayUK)
           {
            if(uk < todayUK)
               break;
            continue;
           }
         if(!GG_InWindow(GG_MinuteOfDay(uk), startMin, endMin))
            continue;
         if(!found)
           {
            hi = r[i].high;
            lo = r[i].low;
            found = true;
           }
         else
           {
            hi = MathMax(hi, r[i].high);
            lo = MathMin(lo, r[i].low);
           }
        }
      return found;
     }

   bool              AsiaRange(double &hi, double &lo) const { return RangeTodayUK(m_asiaStart, m_asiaEnd, hi, lo); }
   int               AsiaStartMin() const { return m_asiaStart; }
   int               AsiaEndMin() const { return m_asiaEnd; }
   int               S1StartMin() const { return m_s1Start; }
   int               S1EndMin() const { return m_s1End; }
   int               S2StartMin() const { return m_s2Start; }
   int               S2EndMin() const { return m_s2End; }
  };

#endif
