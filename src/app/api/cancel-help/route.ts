import { route, safeJson } from "@/lib/security/api";
import { getJsonSetting, setJsonSetting } from "@/lib/db-helpers";
import { cancelHelpRequest } from "@/lib/validation";
import {
  askClaude,
  claimAiCall,
  parseJsonResponse,
  untrusted,
  untrustedBlock,
  aiConfigured,
  AiBudgetExceeded,
} from "@/lib/ai/guard";
import { isSafeDisplayUrl } from "@/lib/security/url-guard";
import { log } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cancel helper: how to actually cancel a recurring charge.
 *
 * Two security properties worth stating explicitly:
 *
 * 1. READ-ONLY, STILL (§1). This produces instructions and a *draft* email.
 *    The user presses Send from their own mail app. Metta never holds email
 *    credentials and never sends anything on the user's behalf.
 *
 * 2. NO SSRF (§20). The URL the model suggests is validated as an https
 *    display URL and handed to the browser as a link. The server never
 *    fetches it. An AI-generated URL is exactly the kind of input that turns
 *    a helpful feature into a request forgery against the internal network,
 *    so the answer is simply not to dereference it.
 *
 * Plans are cached per merchant, per user, so the model is consulted once per
 * service rather than once per view.
 */

interface CancelPlan {
  steps: string[];
  url: string | null;
  supportEmail: string | null;
  emailSubject: string;
  emailBody: string;
}

const FALLBACK: CancelPlan = {
  steps: [
    "Log into your account on the service's website or app.",
    "Open Account or Billing settings and look for Manage subscription.",
    "Choose Cancel and decline any keep-me offers.",
    "Screenshot the confirmation, and watch Metta to confirm the charge stops.",
  ],
  url: null,
  supportEmail: null,
  emailSubject: "Cancel my subscription",
  emailBody:
    "Hello,\n\nPlease cancel my subscription effective immediately and confirm by reply.\n\nName on the account: {{name}}\nAccount email: {{email}}\n\nPlease also confirm no further charges will be made.\n\nThank you,\n{{name}}",
};

/** Bound what the model can put in a plan, so a hostile answer stays inert. */
function sanitizePlan(parsed: Partial<CancelPlan> | null): CancelPlan {
  if (!parsed) return FALLBACK;

  const steps =
    Array.isArray(parsed.steps) && parsed.steps.length > 0
      ? parsed.steps
          .filter((s): s is string => typeof s === "string")
          .slice(0, 8)
          .map((s) => s.slice(0, 300))
      : FALLBACK.steps;

  // https only, and never fetched by us — just rendered as a link (§16, §20).
  const url =
    typeof parsed.url === "string" && isSafeDisplayUrl(parsed.url) ? parsed.url : null;

  // Shape-checked so it cannot become a header-injection payload in a mailto.
  const supportEmail =
    typeof parsed.supportEmail === "string" &&
    /^[^\s<>",;:\\@]+@[^\s<>",;:\\@]+\.[A-Za-z]{2,}$/.test(parsed.supportEmail) &&
    parsed.supportEmail.length <= 254
      ? parsed.supportEmail
      : null;

  return {
    steps: steps.length > 0 ? steps : FALLBACK.steps,
    url,
    supportEmail,
    emailSubject:
      typeof parsed.emailSubject === "string" && parsed.emailSubject.trim()
        ? parsed.emailSubject.replace(/[\r\n]+/g, " ").slice(0, 200)
        : FALLBACK.emailSubject,
    emailBody:
      typeof parsed.emailBody === "string" && parsed.emailBody.trim()
        ? parsed.emailBody.slice(0, 4000)
        : FALLBACK.emailBody,
  };
}

async function getPlan(
  user: { id: string; timezone: string; emailVerified: boolean; aiDailyLimit: number | null },
  merchant: string,
): Promise<CancelPlan> {
  const key = `cancelHelp:${merchant.toLowerCase()}`;

  const cached = await getJsonSetting<CancelPlan | null>(user.id, key, null);
  if (cached && Array.isArray(cached.steps)) return cached;

  if (!aiConfigured()) return FALLBACK;

  try {
    await claimAiCall(user);

    const text = await askClaude({
      system:
        'You help people cancel subscriptions. Given a merchant name, reply with ONLY a JSON object: {"steps": [3-5 short concrete steps to cancel], "url": "direct cancellation or account-management URL (https only), or null if unsure", "supportEmail": "official billing/support email, or null if unsure", "emailSubject": "...", "emailBody": "polite firm cancellation email; use {{name}} and {{email}} placeholders for the account holder\'s name and account email; ask for written confirmation and that no further charges be made"}. Never invent URLs or emails — use null when not confident.',
      // The merchant string came from a bank feed: untrusted input (§31).
      userContent: `Merchant: ${untrustedBlock(untrusted(merchant, 100))}`,
      maxTokens: 700,
    });

    const plan = sanitizePlan(parseJsonResponse<Partial<CancelPlan>>(text));
    await setJsonSetting(user.id, key, plan);
    return plan;
  } catch (error) {
    if (!(error instanceof AiBudgetExceeded)) {
      log.warn("Cancel-help generation failed", { error });
    }
    return FALLBACK;
  }
}

export const POST = route(
  { auth: "user", limits: ["cancelHelper"], body: cancelHelpRequest },
  async (ctx) => {
    const merchant = ctx.body.merchant.trim();
    const plan = await getPlan(ctx.user, merchant);

    // The placeholders are filled from the SERVER-side session, not from
    // request fields. The old version accepted `name` and `email` in the body,
    // which let a caller put arbitrary text into the drafted email (§3, §14).
    const fill = (template: string) =>
      template
        .replaceAll("{{name}}", ctx.user.name || "[your name]")
        .replaceAll("{{email}}", ctx.user.email);

    return safeJson({
      merchant,
      steps: plan.steps,
      url: plan.url,
      supportEmail: plan.supportEmail,
      emailSubject: fill(plan.emailSubject),
      emailBody: fill(plan.emailBody),
    });
  },
);
