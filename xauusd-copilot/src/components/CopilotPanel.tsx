"use client";

import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/symbols";
import type { ChatCard, Snapshot, SymbolCode } from "@/lib/types";

const QUICK_PROMPTS: Array<{ label: string; text: string }> = [
  { label: "Buy or sell now?", text: "Should I buy or sell right now?" },
  { label: "Scan 6 Markets", text: "/scan" },
  { label: "Simulate Buy Setup", text: "Simulate a buy setup" },
  { label: "Simulate Sell Setup", text: "Simulate a sell setup" },
  { label: "My Revenue & KPIs", text: "Show my revenue" },
  { label: "Upcoming News", text: "Upcoming news" },
  { label: "Monte Carlo 4H", text: "Backtest on 4H" },
  { label: "Move to Break-Even", text: "Move stop to break-even" },
  { label: "Close 50%", text: "Close half" },
  { label: "Why last trade?", text: "Why did my last trade close?" },
  { label: "Daily Briefing", text: "Daily briefing" },
  { label: "All Commands", text: "/help" },
];

export default function CopilotPanel({
  snap,
  busy,
  fullScreen = false,
  onSend,
  onAct,
  onSelectSymbol,
}: {
  snap: Snapshot;
  busy: boolean;
  fullScreen?: boolean;
  onSend: (text: string) => Promise<void>;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onSelectSymbol: (sym: SymbolCode) => void;
}) {
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [speakAloud, setSpeakAloud] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSpokenId = useRef<string>("");

  const chat = snap.state.chat;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (!speakAloud || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const last = chat[chat.length - 1];
    if (last && last.role === "assistant" && last.id !== lastSpokenId.current) {
      lastSpokenId.current = last.id;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(last.text.slice(0, 360));
      utter.rate = 1.04;
      window.speechSynthesis.speak(utter);
    }
  }, [chat, speakAloud]);

  const toggleMic = () => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
      };
    };
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) {
      alert("Voice input requires Chrome or Microsoft Edge.");
      return;
    }
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const txt = ev.results?.[0]?.[0]?.transcript ?? "";
      if (txt) {
        setDraft(txt);
        void onSend(txt);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
  };

  return (
    <section className={`card copilot-card ${fullScreen ? "full" : ""}`}>
      <div className="card-h">
        <div>
          <h2>AI Command Copilot</h2>
          <div className="small muted">
            {snap.claudeConfigured ? "Claude Sonnet 5.5 + Guarded Tools" : "Deterministic Copilot Engine Ready"}
          </div>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className={`btn xs ${speakAloud ? "active" : ""}`}
            onClick={() => {
              if (speakAloud && typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
              setSpeakAloud((v) => !v);
            }}
          >
            {speakAloud ? "Voice Out: ON" : "Voice Out"}
          </button>
        </div>
      </div>

      <div className="chat-stream">
        {chat.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="small muted" style={{ fontSize: 10.5, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
              <span>{m.role === "user" ? "Edward / Trader" : "AurumDesk Pro AI"}</span>
              <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div>{m.text}</div>
            {m.card && (
              <EmbeddedCard
                card={m.card}
                activeProposalId={snap.state.proposal?.id ?? null}
                busy={busy}
                onAct={onAct}
                onSelectSymbol={onSelectSymbol}
              />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="chips-scroll">
        {QUICK_PROMPTS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => void onSend(c.text)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <form
        style={{ display: "flex", gap: 6, marginTop: 4 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          const msg = draft;
          setDraft("");
          void onSend(msg);
        }}
      >
        <button
          type="button"
          className={`btn ${listening ? "red" : ""}`}
          title="Speak a command"
          onClick={toggleMic}
        >
          {listening ? "Listening..." : "Mic"}
        </button>
        <input
          className="inp"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='Ask or command: "/scan", "Simulate buy", "Risk 0.5%"...'
          disabled={busy}
        />
        <button className="btn gold" type="submit" disabled={busy || !draft.trim()}>
          {busy ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}

function EmbeddedCard({
  card,
  activeProposalId,
  busy,
  onAct,
  onSelectSymbol,
}: {
  card: ChatCard;
  activeProposalId: string | null;
  busy: boolean;
  onAct: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onSelectSymbol: (sym: SymbolCode) => void;
}) {
  if (card.kind === "proposal") {
    const p = card.proposal.plan;
    const isLive = activeProposalId === card.proposal.id;
    return (
      <div className="chat-card-embed">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <strong className="gold-txt">
            {p.symbol} {p.side} Ticket · {p.lots.toFixed(2)} Lots
          </strong>
          <span className={`pill ${isLive ? "warn" : ""}`}>{isLive ? "Awaiting Decision" : "Processed"}</span>
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Entry {formatPrice(p.symbol, p.entry)} · SL {formatPrice(p.symbol, p.stopLoss)} · TP{" "}
          {formatPrice(p.symbol, p.takeProfit)} ({p.rewardRatio}R) · Risk ${p.riskAmount.toFixed(2)}
        </div>
        {isLive && (
          <div className="btn-row">
            <button className="btn xs green" disabled={busy} onClick={() => void onAct("approve")}>
              Approve Full ({p.lots.toFixed(2)}L)
            </button>
            <button className="btn xs amber" disabled={busy} onClick={() => void onAct("approveHalf")}>
              Approve 50% Risk
            </button>
            <button className="btn xs red" disabled={busy} onClick={() => void onAct("reject")}>
              Reject
            </button>
          </div>
        )}
      </div>
    );
  }

  if (card.kind === "scanner") {
    return (
      <div className="chat-card-embed">
        <div style={{ fontWeight: 700, marginBottom: 6 }} className="gold-txt">
          Multi-Market 8-Gate Scanner
        </div>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>Score</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r) => (
              <tr key={r.symbol} style={{ cursor: "pointer" }} onClick={() => onSelectSymbol(r.symbol)}>
                <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                <td>{formatPrice(r.symbol, r.mid)}</td>
                <td>{r.score}/100</td>
                <td className={r.verdict === "BUY" ? "pos" : r.verdict === "SELL" ? "neg" : "muted"}>
                  {r.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (card.kind === "decision") {
    const passed = card.gates.filter((g) => g.pass).length;
    return (
      <div className="chat-card-embed">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>
            {card.symbol}:{" "}
            <span className={card.verdict === "BUY" ? "pos" : card.verdict === "SELL" ? "neg" : "gold-txt"}>
              {card.verdict}
            </span>
          </strong>
          <span className="pill">
            {passed}/{card.gates.length} Gates ({card.score}/100)
          </span>
        </div>
      </div>
    );
  }

  if (card.kind === "revenue") {
    const st = card.stats;
    return (
      <div className="chat-card-embed">
        <div className="grid-2">
          <div>
            <div className="small muted">Net Revenue</div>
            <div className={st.netPnl >= 0 ? "pos" : "neg"} style={{ fontWeight: 800 }}>
              {st.netPnl >= 0 ? "+" : "-"}${Math.abs(st.netPnl).toFixed(2)} ({st.netReturnPct.toFixed(2)}%)
            </div>
          </div>
          <div>
            <div className="small muted">Win Rate / PF</div>
            <div style={{ fontWeight: 800 }}>
              {st.winRate.toFixed(1)}% · PF {st.profitFactor.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
