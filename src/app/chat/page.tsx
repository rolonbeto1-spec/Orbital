"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { apiPost, useApi } from "@/lib/client";

interface Detail {
  label: string;
  value: string;
}
interface Msg {
  role: "user" | "bot";
  text: string;
  detail?: Detail[];
}

const SUGGESTIONS = [
  "Where's my money going?",
  "Sort my transactions",
  "How much did I spend on food this month?",
  "Am I on budget?",
  "Remind me when I hit half my budget",
  "Save the last charge from Adobe to a folder called Taxes 2026",
  "What's my net worth?",
  "How much should I save to reach $5,000 by December?",
];

export default function ChatPage() {
  const { data: status } = useApi<{ llm: boolean }>("/api/assistant");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "bot",
      text: "Hey — I'm your money assistant. Ask me about your spending, budget, or goals. Try one of the suggestions below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      // Last few turns go along so follow-ups ("and last week?") make sense in AI mode.
      const history = messages.slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await apiPost<{ answer: string; detail?: Detail[] }>("/api/assistant", {
        question: q,
        history,
      });
      setMessages((m) => [...m, { role: "bot", text: res.answer, detail: res.detail }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Something went wrong answering that. Try rephrasing?" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-0 mx-auto flex max-w-[480px] flex-col bg-bg"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 68px)" }}
    >
      <header className="flex items-center gap-2 px-5 pb-3 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Sparkles size={18} />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">Assistant</h1>
          <p className="text-xs text-text-muted">
            {status?.llm
              ? "AI chat · answers from your own data"
              : "Answers from your own data"}
          </p>
        </div>
      </header>

      {/* messages */}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-4 pb-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-snug ${
                m.role === "user"
                  ? "rounded-br-md bg-primary text-white"
                  : "rounded-bl-md border border-border bg-surface"
              }`}
            >
              <p>{m.text}</p>
              {m.detail && m.detail.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                  {m.detail.map((d, j) => (
                    <div key={j} className="flex justify-between gap-4 text-sm">
                      <span className="text-text-muted">{d.label}</span>
                      <span className="font-semibold tabular-nums">{d.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3">
              <span className="flex gap-1">
                <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* suggestions */}
      {messages.length <= 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-2 text-xs font-medium text-text-muted active:scale-95"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your money…"
          className="w-full rounded-full border border-border bg-surface-2 px-4 py-2.5 text-[15px] outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-bounce rounded-full bg-text-faint"
      style={{ animationDelay: delay }}
    />
  );
}
