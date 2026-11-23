//+------------------------------------------------------------------+
//|                                             AurumDesk_Bridge.mq5 |
//|                     AurumDesk Pro — MetaTrader 5 Execution Bridge|
//|   Connects your private MT5 Broker Terminal to AurumDesk Pro     |
//+------------------------------------------------------------------+
#property copyright "AurumDesk Pro"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>

input string InpApiEndpoint    = "http://localhost:3000/api/mt5"; // AurumDesk Pro Bridge URL
input string InpBridgeToken    = "PASTE_BRIDGE_TOKEN_HERE";       // Bridge Token from AurumDesk UI
input int    InpPollSeconds    = 3;                               // Poll interval (seconds)
input ulong  InpMagicNumber    = 202611;                          // EA Magic Number
input ulong  InpMaxSlippagePts = 30;                              // Max allowed slippage in points
input double InpMaxLotsCap     = 5.0;                             // Hard local lot cap safety

CTrade trade;

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpMaxSlippagePts);
   EventSetTimer(MathMax(1, InpPollSeconds));
   Print("[AurumDesk Bridge] Initialized. Add ", InpApiEndpoint, " under Tools -> Options -> Expert Advisors -> Allow WebRequest.");
   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SendHeartbeat();
}

void SendHeartbeat()
{
   string broker  = AccountInfoString(ACCOUNT_COMPANY);
   long   login   = AccountInfoInteger(ACCOUNT_LOGIN);
   string server  = AccountInfoString(ACCOUNT_SERVER);
   int    build   = TerminalInfoInteger(TERMINAL_BUILD);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);

   string payload = StringFormat(
      "{\"token\":\"%s\",\"brokerName\":\"%s\",\"accountLogin\":\"%I64d\",\"accountServer\":\"%s\",\"terminalBuild\":\"%d\",\"balance\":%.2f,\"equity\":%.2f}",
      InpBridgeToken, broker, login, server, build, balance, equity
   );

   char postData[];
   char resultData[];
   string resultHeaders;
   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);

   string headers = "Content-Type: application/json\r\nx-aurum-token: " + InpBridgeToken + "\r\n";
   int res = WebRequest("POST", InpApiEndpoint, headers, 4000, postData, resultData, resultHeaders);

   if(res == 200)
   {
      string json = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      ProcessServerResponse(json);
   }
   else if(res == -1)
   {
      Print("[AurumDesk Bridge] WebRequest blocked (Error ", GetLastError(), "). Whitelist URL in Tools -> Options -> Expert Advisors.");
   }
}

void CloseAllMagicPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetInteger(POSITION_MAGIC) == (long)InpMagicNumber)
      {
         trade.PositionClose(ticket);
      }
   }
}

void ProcessServerResponse(const string json)
{
   if(StringFind(json, "\"type\":\"CLOSE_ALL\"") >= 0)
   {
      Print("[AurumDesk Bridge] Emergency CLOSE_ALL received — flattening EA positions.");
      CloseAllMagicPositions();
      return;
   }

   if(StringFind(json, "\"type\":\"OPEN\"") >= 0)
   {
      string sym  = ExtractString(json, "symbol", _Symbol);
      string side = ExtractString(json, "side", "");
      double lots = MathMin(InpMaxLotsCap, ExtractNumber(json, "lots", 0.01));
      double sl   = ExtractNumber(json, "stopLoss", 0.0);
      double tp   = ExtractNumber(json, "takeProfit", 0.0);

      if(sl <= 0.0)
      {
         Print("[AurumDesk Bridge] Refused order without mandatory Stop Loss.");
         return;
      }

      SymbolSelect(sym, true);
      bool ok = false;
      if(side == "BUY")
         ok = trade.Buy(lots, sym, 0.0, sl, tp, "AurumDesk Pro");
      else if(side == "SELL")
         ok = trade.Sell(lots, sym, 0.0, sl, tp, "AurumDesk Pro");

      Print("[AurumDesk Bridge] Order ", side, " ", lots, " ", sym, " result=", ok, " retcode=", trade.ResultRetcodeDescription());
   }
}

string ExtractString(const string src, const string key, const string fallback)
{
   string pat = "\"" + key + "\":\"";
   int pos = StringFind(src, pat);
   if(pos < 0) return fallback;
   int start = pos + StringLen(pat);
   int end   = StringFind(src, "\"", start);
   if(end < 0) return fallback;
   return StringSubstr(src, start, end - start);
}

double ExtractNumber(const string src, const string key, const double fallback)
{
   string pat = "\"" + key + "\":";
   int pos = StringFind(src, pat);
   if(pos < 0) return fallback;
   int start = pos + StringLen(pat);
   int end   = start;
   while(end < StringLen(src))
   {
      ushort ch = StringGetCharacter(src, end);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-') end++;
      else break;
   }
   if(end == start) return fallback;
   return StringToDouble(StringSubstr(src, start, end - start));
}
//+------------------------------------------------------------------+
