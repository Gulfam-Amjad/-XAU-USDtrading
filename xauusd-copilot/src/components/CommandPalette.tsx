"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  const exec = (c: PaletteCommand | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "14vh",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 92vw)", padding: 0, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
      >
        <input
          ref={inputRef}
          className="inp"
          placeholder="Type a command… (switch workspace, change symbol, kill switch, reports)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              exec(filtered[index]);
            }
          }}
          style={{ width: "100%", border: "none", borderBottom: "1px solid var(--line)", borderRadius: 0, padding: "12px 14px", fontSize: 14 }}
        />
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {filtered.length === 0 && <div className="small muted" style={{ padding: 14 }}>No matching command.</div>}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => exec(c)}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                background: i === index ? "var(--gold-dim)" : "transparent",
                borderLeft: `3px solid ${i === index ? "var(--gold)" : "transparent"}`,
              }}
            >
              <span style={{ fontSize: 13 }}>{c.label}</span>
              {c.hint && <span className="small muted">{c.hint}</span>}
            </div>
          ))}
        </div>
        <div className="small muted" style={{ padding: "6px 14px", borderTop: "1px solid var(--line)" }}>
          ↑↓ navigate · Enter run · Esc close · Ctrl+K toggle
        </div>
      </div>
    </div>
  );
}
