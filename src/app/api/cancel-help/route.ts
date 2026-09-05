import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { spendOneDailyCall } from "@/lib/assistant-llm";

// Cancel helper: for a recurring charge, work out how to actually cancel it
// — the direct link, the steps, and a ready-to-send cancellation email. The
// email is delivered via a mailto: draft in the user's own mail app, so
// Metta never touches their email account. Plans are cached per merchant so
// the AI is consulted once, ever, per service.

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

async function getPlan(merchant: string): Promise<CancelPlan> {
  const key = `cancelHelp:${merchant.toLowerCase()}`;
  const cached = await prisma.setting.findUnique({ where: { key } });
  if (cached) {
    try {
      return JSON.parse(cached.value) as CancelPlan;
    } catch {
      /* regenerate below */
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) return FALLBACK;

  try {
    await spendOneDailyCall();
    const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system:
        'You help people cancel subscriptions. Given a merchant name, reply with ONLY a JSON object: {"steps": [3-5 short concrete steps to cancel], "url": "direct cancellation or account-management URL, or null if unsure", "supportEmail": "official billing/support email, or null if unsure", "emailSubject": "...", "emailBody": "polite firm cancellation email; use {{name}} and {{email}} placeholders for the account holder\'s name and account email; ask for written confirmation and that no further charges be made"}. Never invent URLs or emails — use null when not confident.',
      messages: [{ role: "user", content: `Merchant: ${merchant}` }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return FALLBACK;
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<CancelPlan>;
    const plan: CancelPlan = {
      steps:
        Array.isArray(parsed.steps) && parsed.steps.length > 0 ? parsed.steps : FALLBACK.steps,
      url: typeof parsed.url === "string" && parsed.url.startsWith("http") ? parsed.url : null,
      supportEmail:
        typeof parsed.supportEmail === "string" && parsed.supportEmail.includes("@")
          ? parsed.supportEmail
          : null,
      emailSubject: parsed.emailSubject || FALLBACK.emailSubject,
      emailBody: parsed.emailBody || FALLBACK.emailBody,
    };
    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(plan) },
      create: { key, value: JSON.stringify(plan) },
    });
    return plan;
  } catch (err) {
    console.error("Cancel-help generation failed:", err);
    return FALLBACK;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { merchant?: string; name?: string; email?: string };
    const merchant = body.merchant?.trim();
    if (!merchant) return NextResponse.json({ error: "Missing merchant." }, { status: 400 });

    const plan = await getPlan(merchant);
    const fill = (s: string) =>
      s
        .replaceAll("{{name}}", body.name?.trim() || "[your name]")
        .replaceAll("{{email}}", body.email?.trim() || "[account email]");

    return NextResponse.json({
      merchant,
      steps: plan.steps,
      url: plan.url,
      supportEmail: plan.supportEmail,
      emailSubject: fill(plan.emailSubject),
      emailBody: fill(plan.emailBody),
    });
  } catch {
    return NextResponse.json({ error: "Couldn't build a cancel plan." }, { status: 500 });
  }
}
