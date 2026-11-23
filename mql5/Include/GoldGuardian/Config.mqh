//+------------------------------------------------------------------+
//| GoldGuardian - Config.mqh                                        |
//| All user-facing inputs and shared runtime state.                 |
//+------------------------------------------------------------------+
#ifndef GG_CONFIG_MQH
#define GG_CONFIG_MQH

#define GG_VERSION "0.1.0"

enum ENUM_GG_MODE
  {
   GG_MODE_SIGNAL = 0, // Signal only (alerts, no trading)
   GG_MODE_SEMI   = 1, // Semi-automatic (trade after approval)
   GG_MODE_AUTO   = 2  // Fully automatic (within limits)
  };

enum ENUM_GG_DIRECTION
  {
   GG_DIR_BOTH      = 0, // Buy and Sell
   GG_DIR_BUY_ONLY  = 1, // Buy only
   GG_DIR_SELL_ONLY = 2  // Sell only
  };

enum ENUM_GG_DD_MODE
  {
   GG_DD_STATIC   = 0, // From starting balance
   GG_DD_TRAILING = 1  // From highest equity
  };

input group "=== Operating mode ==="
input ENUM_GG_MODE      InpMode              = GG_MODE_SEMI;   // Mode
input ENUM_GG_DIRECTION InpDirection         = GG_DIR_BOTH;    // Allowed direction
input long              InpMagic             = 20261123;       // Magic number
input int               InpSignalExpiryMin   = 10;             // Approval request expiry (minutes)
input bool              InpTesterAutoApprove = true;           // Strategy Tester: treat Semi-auto as Auto

input group "=== Risk limits ==="
input double            InpRiskPercent       = 0.5;   // Risk per trade (% of balance)
input double            InpMaxRiskPercent    = 1.0;   // Hard cap for risk per trade (remote changes cannot exceed)
input double            InpMaxLots           = 5.0;   // Hard cap for lot size
input double            InpDailyLossPct      = 2.0;   // Daily loss limit (%), closes all and stops for the day
input double            InpMaxDrawdownPct    = 8.0;   // Overall drawdown limit (%), kill switch
input ENUM_GG_DD_MODE   InpDrawdownMode      = GG_DD_STATIC; // Drawdown measured from
input double            InpStartingBalance   = 0.0;   // Starting balance for drawdown (0 = auto)
input bool              InpPropMode          = false; // Prop-firm mode (daily reference = max(balance, equity) at day start)
input int               InpMaxOpenTrades     = 2;     // Max open trades
input int               InpMaxTradesPerDay   = 3;     // Max new trades per day
input double            InpMaxMarginUsePct   = 30.0;  // Max share of free margin a new trade may use (%)
input bool              InpResetKillSwitch   = false; // Reset kill switch on start (manual restart)

input group "=== Execution ==="
input int               InpMaxSpreadPoints   = 60;    // Max spread (points)
input int               InpMaxSlippagePoints = 30;    // Max slippage (points)
input int               InpMaxEntryDriftPts  = 150;   // Max price move between signal and execution (points)

input group "=== Trade management ==="
input bool              InpUseBreakEven      = true;  // Move stop to break-even
input double            InpBreakEvenAtR      = 1.0;   // Break-even trigger (R multiple)
input double            InpPartialClosePct   = 0.0;   // Partial close size (% of volume, 0 = off)
input double            InpPartialCloseAtR   = 1.0;   // Partial close trigger (R multiple)
input bool              InpCloseBeforeWeekend= true;  // Close all trades before the weekend

input group "=== Sessions (UK time, HH:MM) ==="
input string            InpSession1Start     = "08:00"; // Session 1 start (London)
input string            InpSession1End       = "11:30"; // Session 1 end
input string            InpSession2Start     = "13:30"; // Session 2 start (New York)
input string            InpSession2End       = "16:30"; // Session 2 end
input string            InpAsiaStart         = "00:00"; // Asian range start
input string            InpAsiaEnd           = "07:00"; // Asian range end
input string            InpRolloverStart     = "21:45"; // No-trade rollover window start
input string            InpRolloverEnd       = "23:15"; // No-trade rollover window end
input string            InpFridayCutoff      = "18:00"; // No new trades on Friday after
input string            InpWeekendClose      = "20:30"; // Friday close-all time (if enabled)
input int               InpTesterGMTOffset   = 2;       // Strategy Tester: broker server GMT offset (hours)

input group "=== News filter ==="
input bool              InpNewsFilter        = true;    // Block trading around high-impact news
input string            InpNewsCurrencies    = "USD";   // Currencies (comma separated)
input int               InpNewsMinutesBefore = 30;      // Minutes before news
input int               InpNewsMinutesAfter  = 30;      // Minutes after news
input string            InpNewsCsvFile       = "GoldGuardian\\news_history.csv"; // Tester news file (Common\Files)

input group "=== Strategy v0: Key Level Re-test (placeholder) ==="
input ENUM_TIMEFRAMES   InpEntryTF           = PERIOD_M15; // Entry timeframe
input int               InpSwingStrength     = 2;     // Swing strength (bars each side)
input int               InpStructureLookback = 120;   // Bars used for market structure
input int               InpRetestLookback    = 48;    // Bars to look back for the level break
input double            InpRetestTolAtr      = 0.25;  // Re-test tolerance (x ATR entry TF)
input double            InpBreakMinAtr       = 0.5;   // Minimum break displacement (x ATR)
input double            InpClusterAtrMult    = 0.25;  // Merge levels closer than (x ATR H4)
input double            InpSlBufferAtr       = 0.2;   // Stop buffer beyond level (x ATR)
input double            InpMinSlAtr          = 0.6;   // Minimum stop distance (x ATR)
input double            InpMinRR             = 1.5;   // Minimum reward:risk
input double            InpDefaultRR         = 2.0;   // Target R when no level in the way
input double            InpEngulfMinRatio    = 1.0;   // Engulfing body vs previous body
input double            InpPinWickRatio      = 0.6;   // Pin bar wick share of range
input bool              InpRequireH4Agree    = true;  // H4 structure must not oppose Daily bias

input group "=== Bridge (Telegram companion) ==="
input string            InpBridgeFolder      = "GoldGuardian"; // Folder in Terminal\Common\Files
input bool              InpBridgeInTester    = false;          // Write bridge files in Strategy Tester
input int               InpStateIntervalSec  = 5;              // State file update interval

//--- runtime state that remote commands can change
struct SGGRuntime
  {
   int               mode;
   int               direction;
   double            riskPct;
   bool              paused;
   bool              killSwitch;
  };

SGGRuntime g_rt;

string GG_ModeName(const int mode)
  {
   if(mode == GG_MODE_SIGNAL) return "signal";
   if(mode == GG_MODE_SEMI)   return "semi";
   return "auto";
  }

string GG_DirectionName(const int dir)
  {
   if(dir == GG_DIR_BUY_ONLY)  return "buy";
   if(dir == GG_DIR_SELL_ONLY) return "sell";
   return "both";
  }

bool GG_IsTester()
  {
   return (bool)MQLInfoInteger(MQL_TESTER) || (bool)MQLInfoInteger(MQL_OPTIMIZATION);
  }

#endif
