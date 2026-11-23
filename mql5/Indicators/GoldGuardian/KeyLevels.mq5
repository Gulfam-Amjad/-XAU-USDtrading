//+------------------------------------------------------------------+
//| KeyLevels.mq5 - GoldGuardian chart indicator                     |
//| Draws previous day/week/quarter levels, quarterly open, H4 swing |
//| levels and today's Asian / London / New York session boxes.      |
//+------------------------------------------------------------------+
#property copyright "Hammad Muntazir"
#property version   "0.10"
#property indicator_chart_window
#property indicator_plots 0

#include <GoldGuardian\Sessions.mqh>
#include <GoldGuardian\KeyLevels.mqh>

input bool   InpShowSwings      = true;    // Show H4 swing levels
input int    InpSwingStrength   = 2;       // Swing strength
input int    InpSwingLookback   = 120;     // H4 bars for swings
input double InpMergePoints     = 150;     // Merge levels closer than (points)
input bool   InpShowSessions    = true;    // Show session boxes (today)
input string InpAsiaStart       = "00:00"; // Asian start (UK)
input string InpAsiaEnd         = "07:00"; // Asian end (UK)
input string InpLondonStart     = "08:00"; // London start (UK)
input string InpLondonEnd       = "11:30"; // London end (UK)
input string InpNYStart         = "13:30"; // New York start (UK)
input string InpNYEnd           = "16:30"; // New York end (UK)
input int    InpTesterGMTOffset = 2;       // Tester server GMT offset
input color  InpDailyColor      = clrDodgerBlue;
input color  InpWeeklyColor     = clrOrange;
input color  InpQuarterColor    = clrMagenta;
input color  InpSwingColor      = clrSilver;
input color  InpAsiaColor       = C'40,40,70';
input color  InpLondonColor     = C'30,60,40';
input color  InpNYColor         = C'70,40,30';

#define GGKL_PREFIX "GGKL_"

CGGClock     g_clock;
CGGSessions  g_sess;
CGGKeyLevels g_levels;
datetime     g_lastDraw = 0;

color LevelColor(const string label)
  {
   if(StringFind(label, "PQ") >= 0 || StringFind(label, "QO") >= 0) return InpQuarterColor;
   if(StringFind(label, "PW") >= 0) return InpWeeklyColor;
   if(StringFind(label, "PD") >= 0) return InpDailyColor;
   return InpSwingColor;
  }

void DrawLevel(const int i)
  {
   string name = GGKL_PREFIX + "L" + IntegerToString(i);
   double p = g_levels.Price(i);
   string label = g_levels.Label(i);
   ObjectCreate(0, name, OBJ_HLINE, 0, 0, p);
   ObjectSetDouble(0, name, OBJPROP_PRICE, p);
   ObjectSetInteger(0, name, OBJPROP_COLOR, LevelColor(label));
   ObjectSetInteger(0, name, OBJPROP_STYLE, StringFind(label, "swing") >= 0 ? STYLE_DOT : STYLE_SOLID);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, g_levels.Touches(i) > 1 ? 2 : 1);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TEXT, label + " " + DoubleToString(p, _Digits));
   ObjectSetString(0, name, OBJPROP_TOOLTIP, label + " " + DoubleToString(p, _Digits));

   string tname = GGKL_PREFIX + "T" + IntegerToString(i);
   datetime t = iTime(_Symbol, _Period, 0) + PeriodSeconds() * 3;
   ObjectCreate(0, tname, OBJ_TEXT, 0, t, p);
   ObjectMove(0, tname, 0, t, p);
   ObjectSetString(0, tname, OBJPROP_TEXT, label);
   ObjectSetInteger(0, tname, OBJPROP_COLOR, LevelColor(label));
   ObjectSetInteger(0, tname, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, tname, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
   ObjectSetInteger(0, tname, OBJPROP_SELECTABLE, false);
  }

void DrawSession(const string id, const string startS, const string endS, const color clr)
  {
   int sm = GG_ParseHHMM(startS);
   int em = GG_ParseHHMM(endS);
   if(sm < 0 || em < 0)
      return;
   double hi, lo;
   if(!g_sess.RangeTodayUK(sm, em, hi, lo))
      return;
   datetime dayUK = GG_DateOnly(g_clock.NowUK());
   datetime t1 = g_clock.UKToServer(dayUK + sm * 60);
   datetime t2 = g_clock.UKToServer(dayUK + em * 60);
   string name = GGKL_PREFIX + "S_" + id;
   ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, hi, t2, lo);
   ObjectMove(0, name, 0, t1, hi);
   ObjectMove(0, name, 1, t2, lo);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, id + " H " + DoubleToString(hi, _Digits) + " L " + DoubleToString(lo, _Digits));
  }

void Redraw()
  {
   ObjectsDeleteAll(0, GGKL_PREFIX);
   int n = g_levels.Build(InpMergePoints * _Point, InpShowSwings, InpSwingStrength, InpSwingLookback);
   for(int i = 0; i < n; i++)
      DrawLevel(i);
   if(InpShowSessions)
     {
      DrawSession("Asia", InpAsiaStart, InpAsiaEnd, InpAsiaColor);
      DrawSession("London", InpLondonStart, InpLondonEnd, InpLondonColor);
      DrawSession("NewYork", InpNYStart, InpNYEnd, InpNYColor);
     }
   ChartRedraw();
  }

int OnInit()
  {
   g_clock.Init(InpTesterGMTOffset);
   g_sess.Init(GetPointer(g_clock), _Symbol, InpLondonStart, InpLondonEnd, InpNYStart, InpNYEnd,
               InpAsiaStart, InpAsiaEnd, "21:45", "23:15", "18:00", "20:30");
   g_levels.Init(_Symbol);
   IndicatorSetString(INDICATOR_SHORTNAME, "GoldGuardian Key Levels");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, GGKL_PREFIX);
   ChartRedraw();
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
  {
   datetime now = TimeCurrent();
   if(prev_calculated == 0 || now - g_lastDraw >= 30)
     {
      g_lastDraw = now;
      Redraw();
     }
   return rates_total;
  }
//+------------------------------------------------------------------+
