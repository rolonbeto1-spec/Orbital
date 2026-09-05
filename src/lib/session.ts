// Signed session tokens for the login gate. Uses Web Crypto only, so the
// same code runs in the proxy (edge) and in route handlers.
//
// Token shape: "<expiresAtMs>.<hmac>" — the HMAC covers the expiry, so tokens
// can't be forged or extended without AUTH_SECRET.

export const SESSION_COOKIE = "budget_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return b64url(sig);
}

export function sessionSecret(): string {
  // AUTH_SECRET is preferred; falling back to the password still signs
  // tokens, just ties their validity to the password itself.
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || "";
}

export async function createSessionToken(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sig = await hmac(`session:${exp}`, secret);
  return `${exp}.${sig}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(`session:${exp}`, secret);
  const given = token.slice(dot + 1);
  // constant-time-ish compare
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
