import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at module load.
 *
 * Two jobs:
 *  1. Fail loudly at startup when a production secret is missing, rather than
 *     failing quietly at 3am on the one request that needed it (§28).
 *  2. Be the single place any server code reads process.env, so there is one
 *     obvious file to audit for "is this secret server-only?".
 *
 * Nothing here is ever exported to the browser. There is no NEXT_PUBLIC_*
 * secret; the only browser-visible configuration lives in src/lib/public-config.ts.
 */

/**
 * Treat a variable that is set but blank as absent.
 *
 * Hosting dashboards make it easy to create an empty variable, and
 * `z.coerce.number()` turns "" into 0 — which for AI_DAILY_LIMIT would
 * silently switch the AI off, and for a limit would silently mean "none".
 * Stripping blanks here makes the schema defaults apply instead.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "undefined" || trimmed === "null") continue;
    out[key] = value;
  }
  return out;
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

/** A base64 32-byte key. */
const base64Key = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    },
    { message: "must be a base64-encoded 32-byte key" },
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1),

  // --- Auth ---
  // Signs session tokens and verification tokens. Rotating it invalidates
  // every session, which is the intended emergency behaviour.
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  /** Canonical public origin, e.g. https://metta.example.com */
  APP_URL: z.string().url().optional(),

  // --- Application-layer encryption for Plaid access tokens (§9) ---
  // Multiple generations may be present at once so keys can be rotated
  // without re-linking banks: ENCRYPTION_KEY_V1, _V2, ... plus a pointer at
  // the generation new writes should use.
  ENCRYPTION_KEY_ACTIVE: z.string().regex(/^v\d+$/).default("v1"),
  ENCRYPTION_KEY_V1: base64Key.optional(),
  ENCRYPTION_KEY_V2: base64Key.optional(),
  ENCRYPTION_KEY_V3: base64Key.optional(),

  // --- Plaid ---
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Absolute HTTPS URL Plaid calls with Item updates. */
  PLAID_WEBHOOK_URL: z.string().url().optional(),
  /**
   * Comma-separated allowlist of OAuth redirect URIs. The browser never picks
   * the redirect; we only ever send one of these (§8, §19).
   */
  PLAID_REDIRECT_URIS: z.string().optional(),

  // --- AI ---
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-haiku-4-5"),
  /** Global ceiling across all users, per UTC day. 0 disables AI entirely. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(1000),
  /** Per-user ceiling, per user-local day. */
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(0).default(60),
  /** Tighter ceiling for accounts that have not verified their email. */
  AI_UNVERIFIED_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),

  // --- Email ---
  EMAIL_PROVIDER: z.enum(["resend", "console"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // --- Product flags ---
  /**
   * Public registration. Ships OFF and must stay off until every launch
   * blocker in PRODUCTION_LAUNCH_CHECKLIST.md is cleared (§85).
   */
  PUBLIC_SIGNUP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Comma-separated emails allowed to register while public signup is off.
   * Lets the owner and invited testers in without opening the doors.
   */
  SIGNUP_ALLOWLIST: z.string().optional(),

  /** Set by Vercel. Used to keep preview deployments out of production mode. */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
});

const parsed = schema.safeParse(withoutBlanks(process.env));

if (!parsed.success) {
  // Print only the field names and messages — never the values, which would
  // put secrets into build logs.
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid server environment:\n${issues}`);
}

export const env = parsed.data;

/** True when this process serves real user traffic (not a preview branch). */
export const isProduction = isProd && env.VERCEL_ENV !== "preview";

export const isTestEnv = isTest;

/**
 * Hard requirements for a production deployment. Called from
 * assertProductionSecrets() so a misconfigured deploy fails fast and visibly
 * instead of serving a half-secured app.
 */
function productionProblems(): string[] {
  const problems: string[] = [];

  if (!env.BETTER_AUTH_SECRET) {
    problems.push("BETTER_AUTH_SECRET is required (>=32 chars).");
  }
  if (!env.APP_URL && !env.BETTER_AUTH_URL) {
    problems.push("APP_URL (or BETTER_AUTH_URL) is required.");
  }
  const appUrl = env.APP_URL ?? env.BETTER_AUTH_URL;
  if (appUrl && !appUrl.startsWith("https://")) {
    problems.push("APP_URL must be https:// in production (§27).");
  }
  if (!activeEncryptionKey()) {
    problems.push(
      `ENCRYPTION_KEY_${env.ENCRYPTION_KEY_ACTIVE.toUpperCase()} is required to encrypt Plaid access tokens.`,
    );
  }
  if (env.PLAID_CLIENT_ID || env.PLAID_SECRET) {
    if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
      problems.push("PLAID_CLIENT_ID and PLAID_SECRET must both be set.");
    }
    if (!env.PLAID_WEBHOOK_URL) {
      problems.push("PLAID_WEBHOOK_URL is required so Items stay in sync.");
    }
  }
  if (env.EMAIL_PROVIDER === "console") {
    problems.push(
      "EMAIL_PROVIDER=console cannot deliver verification or password-reset mail; set EMAIL_PROVIDER=resend.",
    );
  }
  if (env.EMAIL_PROVIDER === "resend" && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
    problems.push("RESEND_API_KEY and EMAIL_FROM are required for EMAIL_PROVIDER=resend.");
  }
  if (process.env.APP_PASSWORD) {
    problems.push(
      "APP_PASSWORD is set. The shared-password gate has been removed; delete this variable.",
    );
  }
  return problems;
}

/**
 * Throws in production when a required secret is missing. Imported by the
 * auth module, which every authenticated path loads, so there is no way to
 * serve traffic past a failed check.
 */
export function assertProductionSecrets(): void {
  if (!isProduction) return;
  const problems = productionProblems();
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: production configuration is incomplete.\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
}

/** Non-throwing form, for the health endpoint and the launch checklist script. */
export function productionReadiness(): { ok: boolean; problems: string[] } {
  const problems = productionProblems();
  return { ok: problems.length === 0, problems };
}

/** The raw key material for a given generation, or undefined if absent. */
export function encryptionKey(generation: string): Buffer | undefined {
  const raw = process.env[`ENCRYPTION_KEY_${generation.toUpperCase()}`];
  if (!raw) return undefined;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : undefined;
}

export function activeEncryptionKey(): { id: string; key: Buffer } | undefined {
  const id = env.ENCRYPTION_KEY_ACTIVE;
  const key = encryptionKey(id);
  return key ? { id, key } : undefined;
}

/** Canonical public origin, without a trailing slash. */
export function appOrigin(): string {
  const raw = env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Emails permitted to register while public signup is closed. */
export function signupAllowlist(): Set<string> {
  return new Set(
    (env.SIGNUP_ALLOWLIST ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Application-controlled Plaid OAuth redirect URIs (§8). */
export function plaidRedirectAllowlist(): string[] {
  const configured = (env.PLAID_REDIRECT_URIS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const origin = appOrigin();
  return origin.startsWith("https://") ? [`${origin}/app/plaid/oauth`] : [];
}
