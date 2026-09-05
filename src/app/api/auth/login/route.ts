import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSessionToken,
  sessionSecret,
} from "@/lib/session";

// Sign in with the app password. Wrong guesses are slowed down hard
// (per-runtime backoff) so brute-forcing the password isn't practical.

const attempts = new Map<string, { count: number; last: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || "local";
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json({ ok: true, note: "Auth is not enabled" });
  }

  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.last < WINDOW_MS && rec.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a few minutes." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const given = typeof body.password === "string" ? body.password : "";

  // small fixed delay makes every guess expensive
  await new Promise((r) => setTimeout(r, 350));

  if (!constantTimeEqual(given, password)) {
    const cur = rec && now - rec.last < WINDOW_MS ? rec.count : 0;
    attempts.set(key, { count: cur + 1, last: now });
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  attempts.delete(key);
  const token = await createSessionToken(sessionSecret());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}
