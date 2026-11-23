//+------------------------------------------------------------------+
//| GoldGuardian - Logger.mqh                                        |
//| Structured event log: Experts journal + events.jsonl.            |
//+------------------------------------------------------------------+
#ifndef GG_LOGGER_MQH
#define GG_LOGGER_MQH

#include "Bridge.mqh"
#include "Sessions.mqh"

class CGGLogger
  {
private:
   CGGBridge        *m_bridge;
   CGGClock         *m_clock;
   string            m_symbol;

public:
                     CGGLogger() : m_bridge(NULL), m_clock(NULL) {}

   void              Init(CGGBridge *bridge, CGGClock *clock, const string symbol)
     {
      m_bridge = bridge;
      m_clock  = clock;
      m_symbol = symbol;
     }

   //--- fields: comma-separated JSON members built with JStr/JNum/...
   void              Event(const string type, const string fields = "")
     {
      datetime srv = m_clock.NowServer();
      string json = "{" + JStr("type", type) + "," +
                    JStr("symbol", m_symbol) + "," +
                    JStr("server_time", TimeToString(srv, TIME_DATE | TIME_SECONDS)) + "," +
                    JInt("ts_utc", (long)m_clock.ServerToGMT(srv));
      if(fields != "")
         json += "," + fields;
      json += "}";
      Print("[GG] ", type, (fields != "" ? " " + fields : ""));
      if(m_bridge != NULL)
         m_bridge.AppendEvent(json);
     }

   void              Info(const string msg)  { Event("info", JStr("message", msg)); }
   void              Warn(const string msg)  { Event("warning", JStr("message", msg)); }
  };

#endif
