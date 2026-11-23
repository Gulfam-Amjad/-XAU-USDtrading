//+------------------------------------------------------------------+
//| GoldGuardian - Bridge.mqh                                        |
//| File bridge to the Python companion in Terminal\Common\Files.    |
//|  EA writes : state.json, signals.json, events.jsonl              |
//|  EA reads  : commands\*.json (one file per command, deleted      |
//|              after processing)                                   |
//+------------------------------------------------------------------+
#ifndef GG_BRIDGE_MQH
#define GG_BRIDGE_MQH

//--- minimal JSON helpers
string GG_JsonEscape(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\t", " ");
   return s;
  }

string JStr(const string key, const string val)  { return "\"" + key + "\":\"" + GG_JsonEscape(val) + "\""; }
string JNum(const string key, const double val, const int digits = 2) { return "\"" + key + "\":" + DoubleToString(val, digits); }
string JInt(const string key, const long val)    { return "\"" + key + "\":" + IntegerToString(val); }
string JBool(const string key, const bool val)   { return "\"" + key + "\":" + (val ? "true" : "false"); }
string JRaw(const string key, const string raw)  { return "\"" + key + "\":" + raw; }

//--- extracts a top-level string or scalar value; returns "" when missing
string GG_JsonGet(const string json, const string key)
  {
   string needle = "\"" + key + "\"";
   int p = StringFind(json, needle);
   if(p < 0)
      return "";
   p = StringFind(json, ":", p + StringLen(needle));
   if(p < 0)
      return "";
   p++;
   int n = StringLen(json);
   while(p < n)
     {
      ushort c = StringGetCharacter(json, p);
      if(c != ' ' && c != '\t' && c != '\r' && c != '\n')
         break;
      p++;
     }
   if(p >= n)
      return "";
   if(StringGetCharacter(json, p) == '"')
     {
      string out = "";
      p++;
      while(p < n)
        {
         ushort c = StringGetCharacter(json, p);
         if(c == '\\' && p + 1 < n)
           {
            out += ShortToString(StringGetCharacter(json, p + 1));
            p += 2;
            continue;
           }
         if(c == '"')
            break;
         out += ShortToString(c);
         p++;
        }
      return out;
     }
   int e = p;
   while(e < n)
     {
      ushort c = StringGetCharacter(json, e);
      if(c == ',' || c == '}' || c == ' ' || c == '\r' || c == '\n')
         break;
      e++;
     }
   return StringSubstr(json, p, e - p);
  }

struct SGGCommand
  {
   string            id;
   string            cmd;
   string            value;
   string            signalId;
   string            source;
  };

//+------------------------------------------------------------------+
class CGGBridge
  {
private:
   string            m_dir;
   bool              m_enabled;

   string            ReadAll(const string path) const
     {
      int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI | FILE_SHARE_READ, '\t', CP_UTF8);
      if(h == INVALID_HANDLE)
         return "";
      string out = "";
      while(!FileIsEnding(h))
         out += FileReadString(h);
      FileClose(h);
      return out;
     }

   void              SortStrings(string &arr[]) const
     {
      int n = ArraySize(arr);
      for(int i = 1; i < n; i++)
        {
         string key = arr[i];
         int j = i - 1;
         while(j >= 0 && StringCompare(arr[j], key) > 0)
           {
            arr[j + 1] = arr[j];
            j--;
           }
         arr[j + 1] = key;
        }
     }

public:
                     CGGBridge() : m_enabled(false) {}

   bool              Init(const string dir, const bool enabled)
     {
      m_dir = dir;
      m_enabled = enabled;
      if(!m_enabled)
         return true;
      FolderCreate(m_dir, FILE_COMMON);
      FolderCreate(m_dir + "\\commands", FILE_COMMON);
      return true;
     }

   bool              Enabled() const { return m_enabled; }

   bool              WriteAtomic(const string name, const string content)
     {
      if(!m_enabled)
         return false;
      string tmp = m_dir + "\\" + name + ".tmp";
      int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI, '\t', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         Print("[GG] Bridge cannot write ", tmp, " err=", GetLastError());
         return false;
        }
      FileWriteString(h, content);
      FileClose(h);
      return FileMove(tmp, FILE_COMMON, m_dir + "\\" + name, FILE_COMMON | FILE_REWRITE);
     }

   bool              AppendEvent(const string json)
     {
      if(!m_enabled)
         return false;
      string path = m_dir + "\\events.jsonl";
      int h = FileOpen(path, FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI | FILE_SHARE_READ, '\t', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         Print("[GG] Bridge cannot open events file err=", GetLastError());
         return false;
        }
      FileSeek(h, 0, SEEK_END);
      FileWriteString(h, json + "\n");
      FileClose(h);
      return true;
     }

   bool              WriteState(const string json)  { return WriteAtomic("state.json", json); }
   bool              WriteSignal(const string json) { return WriteAtomic("signals.json", json); }
   bool              ClearSignal()                  { return WriteAtomic("signals.json", "{}"); }

   //--- reads and deletes pending command files, oldest first
   int               ReadCommands(SGGCommand &out[])
     {
      ArrayResize(out, 0);
      if(!m_enabled)
         return 0;
      string names[];
      string fname;
      long h = FileFindFirst(m_dir + "\\commands\\*.json", fname, FILE_COMMON);
      if(h == INVALID_HANDLE)
         return 0;
      do
        {
         int k = ArraySize(names);
         ArrayResize(names, k + 1);
         names[k] = fname;
        }
      while(FileFindNext(h, fname));
      FileFindClose(h);
      SortStrings(names);

      for(int i = 0; i < ArraySize(names); i++)
        {
         string path = m_dir + "\\commands\\" + names[i];
         string body = ReadAll(path);
         FileDelete(path, FILE_COMMON);
         if(body == "")
            continue;
         SGGCommand c;
         c.id       = GG_JsonGet(body, "id");
         c.cmd      = GG_JsonGet(body, "cmd");
         c.value    = GG_JsonGet(body, "value");
         c.signalId = GG_JsonGet(body, "signal_id");
         c.source   = GG_JsonGet(body, "source");
         StringToLower(c.cmd);
         if(c.cmd == "")
            continue;
         int k = ArraySize(out);
         ArrayResize(out, k + 1);
         out[k] = c;
        }
      return ArraySize(out);
     }
  };

#endif
