/**
 * Redaction for logs, error reports and analytics (§12, §39, §40).
 *
 * The threat this addresses is mundane and extremely common: a developer
 * writes `console.error("sync failed", err, item)` and a Plaid access token,
 * a balance, and a list of the user's merchants land in a log aggregator that
 * a much wider group of people can read than can read the database.
 *
 * So: the logger never accepts a raw object. Everything passes through
 * `redact()`, which works from a deny-list of key names AND a value-shaped
 * detector for credentials, and truncates anything unexpectedly large.
 *
 * This module is deliberately dependency-free and safe to import anywhere,
 * including tests and the edge runtime.
 */

/** Key names whose values must never be logged, matched case-insensitively. */
const SECRET_KEYS = [
  "accesstoken",
  "access_token",
  "accesstokencipher",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "publictoken",
  "public_token",
  "linktoken",
  "link_token",
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "secret",
  "clientsecret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "setcookie",
  "set-cookie",
  "sessiontoken",
  "session_token",
  "token",
  "csrf",
  "signature",
  "encryptionkey",
  "databaseurl",
  "database_url",
  "connectionstring",
];

/** Key names holding financial detail. Logged as a type marker, never a value. */
const FINANCIAL_KEYS = [
  "amount",
  "amountcents",
  "balance",
  "currentbalance",
  "availablebalance",
  "reimbursedamount",
  "targetamount",
  "currentamount",
  "rentincome",
  "mortgage",
  "merchantname",
  "plaidcategory",
  "notes",
  "mask",
  "accountnumber",
  "account_number",
  "routingnumber",
  "iban",
  "holdings",
  "transactions",
  "snapshot",
];

/** Personal identifiers: kept only as a coarse, non-reversible marker. */
const PII_KEYS = ["email", "phone", "phonenumber", "ssn", "taxid", "address", "ip", "ipaddress"];

const MAX_STRING = 200;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

/**
 * Value-shaped credential detection, for secrets that arrive under an
 * innocent key name (a message string, a URL query, a stack frame).
 */
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  // Plaid access + public tokens.
  [/\baccess-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-access-token]"],
  [/\bpublic-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-public-token]"],
  [/\blink-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-link-token]"],
  // Anthropic keys.
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "[redacted:anthropic-key]"],
  // Resend keys.
  [/\bre_[A-Za-z0-9_-]{16,}/g, "[redacted:email-key]"],
  // Postgres/MySQL connection strings with inline credentials.
  [/\b(postgres|postgresql|mysql):\/\/[^\s"']+/gi, "[redacted:connection-string]"],
  // Bearer tokens and JWTs.
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, "[redacted:bearer]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted:jwt]"],
  // Anything that looks like an email address.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted:email]"],
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function keyIn(key: string, list: string[]): boolean {
  const k = normalizeKey(key);
  return list.some((entry) => k === normalizeKey(entry) || k.includes(normalizeKey(entry)));
}

/** Scrub credential-shaped substrings out of free text. */
export function scrubString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

/**
 * Recursively redact a value so it is safe to log.
 *
 * Rules:
 *  - a secret-named key becomes "[redacted]" — the value is never inspected;
 *  - a financial-named key becomes a type marker such as "[number]";
 *  - a PII-named key becomes "[redacted:pii]";
 *  - every remaining string is scrubbed for credential-shaped content;
 *  - depth, array length and string length are bounded, so one stray object
 *    cannot flood the log or the function's memory.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      // Stack traces are kept server-side only and still scrubbed: they
      // routinely contain query strings and config values.
      stack: value.stack ? scrubString(value.stack.split("\n").slice(0, 5).join("\n")) : undefined,
    };
  }

  if (Array.isArray(value)) {
    const shown = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY) shown.push(`[+${value.length - MAX_ARRAY} more]`);
    return shown;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (keyIn(key, SECRET_KEYS)) {
        out[key] = "[redacted]";
      } else if (keyIn(key, FINANCIAL_KEYS)) {
        out[key] = financialMarker(raw);
      } else if (keyIn(key, PII_KEYS)) {
        out[key] = "[redacted:pii]";
      } else {
        out[key] = redact(raw, depth + 1);
      }
    }
    return out;
  }

  return "[unknown]";
}

/**
 * Financial values are replaced by a shape marker. "It was a number" is
 * enough to debug a type error; the number itself is the user's business.
 */
function financialMarker(value: unknown): string {
  if (value === null || value === undefined) return "[empty]";
  if (typeof value === "number") return "[number]";
  if (typeof value === "string") return "[string]";
  if (Array.isArray(value)) return `[array:${value.length}]`;
  return "[value]";
}

/**
 * Safe rendering of a URL for logs: path and known-safe query keys only.
 * Query strings are a favourite hiding place for tokens.
 */
export function redactUrl(input: string): string {
  try {
    const url = new URL(input, "http://internal.invalid");
    const keptParams: string[] = [];
    for (const key of url.searchParams.keys()) {
      keptParams.push(keyIn(key, [...SECRET_KEYS, ...PII_KEYS]) ? `${key}=[redacted]` : `${key}=…`);
    }
    return keptParams.length > 0 ? `${url.pathname}?${keptParams.join("&")}` : url.pathname;
  } catch {
    return "[unparseable-url]";
  }
}
