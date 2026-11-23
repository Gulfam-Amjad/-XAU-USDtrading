//+------------------------------------------------------------------+
//| GoldGuardian - NewsFilter.mqh                                    |
//| High-impact news blackout.                                       |
//|  Live   : MT5 built-in economic calendar.                        |
//|  Tester : CSV in Common\Files, one event per line:               |
//|           YYYY.MM.DD HH:MM,CURRENCY,Event name   (time in GMT)   |
//+------------------------------------------------------------------+
#ifndef GG_NEWSFILTER_MQH
#define GG_NEWSFILTER_MQH

#include "Sessions.mqh"

struct SGGNewsEvent
  {
   datetime          timeServer;
   string            currency;
   string            name;
  };

class CGGNews
  {
private:
   CGGClock         *m_clock;
   bool              m_enabled;
   string            m_currencies[];
   int               m_before, m_after;
   string            m_csvFile;
   SGGNewsEvent      m_events[];
   datetime          m_lastRefresh;
   bool              m_calendarOk;
   bool              m_csvLoaded;

   bool              CurrencyWanted(const string cur) const
     {
      for(int i = 0; i < ArraySize(m_currencies); i++)
         if(m_currencies[i] == cur)
            return true;
      return false;
     }

   void              Add(const datetime t, const string cur, const string name)
     {
      int k = ArraySize(m_events);
      ArrayResize(m_events, k + 1, 256);
      m_events[k].timeServer = t;
      m_events[k].currency   = cur;
      m_events[k].name       = name;
     }

   void              LoadCsv()
     {
      m_csvLoaded = true;
      int h = FileOpen(m_csvFile, FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI | FILE_SHARE_READ, '\t', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         Print("[GG] News CSV not found (", m_csvFile, "). Tester runs without news filter.");
         return;
        }
      while(!FileIsEnding(h))
        {
         string line = FileReadString(h);
         StringTrimLeft(line);
         StringTrimRight(line);
         if(line == "" || StringGetCharacter(line, 0) == '#')
            continue;
         string f[];
         if(StringSplit(line, ',', f) < 2)
            continue;
         datetime gmt = StringToTime(f[0]);
         if(gmt == 0)
            continue;
         string cur = f[1];
         StringTrimLeft(cur);
         StringTrimRight(cur);
         StringToUpper(cur);
         if(!CurrencyWanted(cur))
            continue;
         Add(m_clock.GMTToServer(gmt), cur, ArraySize(f) > 2 ? f[2] : "News");
        }
      FileClose(h);
      Print("[GG] Loaded ", ArraySize(m_events), " news events from CSV.");
     }

   void              LoadCalendar()
     {
      ArrayResize(m_events, 0);
      datetime now  = m_clock.NowServer();
      datetime from = now - 86400;
      datetime to   = now + 7 * 86400;
      bool anyOk = false;
      for(int c = 0; c < ArraySize(m_currencies); c++)
        {
         MqlCalendarValue vals[];
         ResetLastError();
         int n = CalendarValueHistory(vals, from, to, NULL, m_currencies[c]);
         if(n < 0 || (n == 0 && GetLastError() != 0))
            continue;
         anyOk = true;
         for(int i = 0; i < n; i++)
           {
            MqlCalendarEvent ev;
            if(!CalendarEventById(vals[i].event_id, ev))
               continue;
            if(ev.importance != CALENDAR_IMPORTANCE_HIGH)
               continue;
            Add(vals[i].time, m_currencies[c], ev.name);
           }
        }
      m_calendarOk = anyOk;
     }

public:
                     CGGNews() : m_clock(NULL), m_enabled(false), m_lastRefresh(0),
                     m_calendarOk(false), m_csvLoaded(false) {}

   void              Init(CGGClock *clock, const bool enabled, const string currencies,
                          const int minutesBefore, const int minutesAfter, const string csvFile)
     {
      m_clock   = clock;
      m_enabled = enabled;
      m_before  = minutesBefore;
      m_after   = minutesAfter;
      m_csvFile = csvFile;
      string parts[];
      int n = StringSplit(currencies, ',', parts);
      ArrayResize(m_currencies, 0);
      for(int i = 0; i < n; i++)
        {
         string c = parts[i];
         StringTrimLeft(c);
         StringTrimRight(c);
         StringToUpper(c);
         if(c == "")
            continue;
         int k = ArraySize(m_currencies);
         ArrayResize(m_currencies, k + 1);
         m_currencies[k] = c;
        }
      Refresh(true);
     }

   bool              Enabled() const { return m_enabled; }
   bool              CalendarOk() const { return m_clock.IsTester() ? m_csvLoaded : m_calendarOk; }

   void              Refresh(const bool force = false)
     {
      if(!m_enabled)
         return;
      if(m_clock.IsTester())
        {
         if(!m_csvLoaded)
            LoadCsv();
         return;
        }
      datetime now = m_clock.NowServer();
      if(!force && now - m_lastRefresh < 900)
         return;
      m_lastRefresh = now;
      LoadCalendar();
     }

   bool              IsBlocked(const datetime nowServer, string &why) const
     {
      why = "";
      if(!m_enabled)
         return false;
      for(int i = 0; i < ArraySize(m_events); i++)
        {
         datetime t = m_events[i].timeServer;
         if(nowServer >= t - m_before * 60 && nowServer <= t + m_after * 60)
           {
            why = "news: " + m_events[i].currency + " " + m_events[i].name + " at " + TimeToString(t, TIME_MINUTES);
            return true;
           }
        }
      return false;
     }

   int               Upcoming(const datetime nowServer, const int hours, SGGNewsEvent &out[]) const
     {
      ArrayResize(out, 0);
      for(int i = 0; i < ArraySize(m_events); i++)
        {
         datetime t = m_events[i].timeServer;
         if(t >= nowServer - m_after * 60 && t <= nowServer + hours * 3600)
           {
            int k = ArraySize(out);
            ArrayResize(out, k + 1);
            out[k] = m_events[i];
           }
        }
      return ArraySize(out);
     }
  };

#endif
