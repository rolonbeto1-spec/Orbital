import { route, safeJson } from "@/lib/security/api";
import { assistantRequest } from "@/lib/validation";
import { maybeAction } from "@/lib/assistant-actions";
import { askLLM, llmConfigured } from "@/lib/assistant-llm";
import { ask } from "@/lib/assistant";
import { AiBudgetExceeded } from "@/lib/ai/guard";
import { log } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Ask screen (§30-§33).
 *
 * Three layers, tried in order, exactly as before — but every layer is now
 * handed the authenticated user and reads only that user's data:
 *
 *   1. deterministic actions (token-free, pattern-matched from the user's own
 *      text — the model never chooses an action or its parameters);
 *   2. Claude, with a snapshot built from this user's finances alone;
 *   3. the built-in rule engine, so chat still answers when the AI is
 *      unavailable, out of budget, or not configured.
 *
 * The response is plain text. It is rendered as text by the client, never as
 * HTML — model output is untrusted data (§16).
 */
/**
 * Whether the AI layer is configured, so the Ask screen can say which engine
 * is answering rather than guessing.
 *
 * The screen has always asked for this; the route only accepted POST, so the
 * request came back 405 on every visit and the badge silently fell back to
 * its "no AI" state. The answer is a single boolean about server
 * configuration and contains no user data — but it is still behind `auth`,
 * because configuration detail is not something to hand to anonymous callers.
 */
export const GET = route({ auth: "user", limits: ["read"] }, async () => {
  return safeJson({ llm: llmConfigured() });
});

export const POST = route(
  { auth: "user", limits: ["ai", "aiSustained"], body: assistantRequest },
  async (ctx) => {
    const question = ctx.body.message;

    // Layer 1 — deterministic, free, and fully authorized server-side.
    try {
      const action = await maybeAction(ctx.user, question);
      if (action) return safeJson({ ...action, source: "action" });
    } catch (error) {
      log.warn("Assistant action failed", { error });
    }

    // Layer 2 — the model.
    if (llmConfigured()) {
      try {
        const answer = await askLLM(ctx.user, question);
        return safeJson({ ...answer, source: "ai" });
      } catch (error) {
        if (error instanceof AiBudgetExceeded) {
          // Out of allowance: fall through to the rule engine rather than
          // failing. The user still gets an answer (§33 "graceful failure").
          log.info("AI budget exhausted; using rule engine", { scope: error.scope });
        } else {
          log.warn("Assistant LLM failed; using rule engine", { error });
        }
      }
    }

    // Layer 3 — never break chat.
    const answer = await ask(ctx.user, question);
    return safeJson({ ...answer, source: "rules" });
  },
);
