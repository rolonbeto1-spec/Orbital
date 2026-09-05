import { NextResponse } from "next/server";
import { ask } from "@/lib/assistant";
import { maybeAction } from "@/lib/assistant-actions";
import { askLLM, llmConfigured, type ChatTurn } from "@/lib/assistant-llm";

// The sort-my-transactions action runs several AI batches — give it a full
// minute instead of the platform's ~10s default before it gets killed.
export const maxDuration = 60;

// Reports whether the natural-language upgrade is active (ANTHROPIC_API_KEY set).
export async function GET() {
  return NextResponse.json({ llm: llmConfigured() });
}

export async function POST(req: Request) {
  try {
    const { question, history } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // Commands run first — deterministic, works with or without an API key.
    const action = await maybeAction(question);
    if (action) return NextResponse.json({ ...action, mode: "action" });

    if (llmConfigured()) {
      try {
        const result = await askLLM(question, sanitizeHistory(history));
        return NextResponse.json({ ...result, mode: "ai" });
      } catch (err) {
        // Bad key, network hiccup, rate limit — the rule engine still answers.
        console.error("LLM assistant failed, falling back to rules:", err);
      }
    }

    const result = await ask(question);
    return NextResponse.json({ ...result, mode: "rules" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to answer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sanitizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (t): t is ChatTurn =>
        !!t &&
        typeof t === "object" &&
        (t.role === "user" || t.role === "bot") &&
        typeof t.text === "string",
    )
    .slice(-8);
}
