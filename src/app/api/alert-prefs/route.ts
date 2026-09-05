import { NextResponse } from "next/server";
import { getAlertPrefs, setAlertPrefs } from "@/lib/alert-prefs";

export async function GET() {
  return NextResponse.json(await getAlertPrefs());
}

export async function POST(req: Request) {
  const body = await req.json();
  const patch: Record<string, boolean> = {};
  for (const k of ["half", "full", "weekly"] as const) {
    if (k in body) patch[k] = Boolean(body[k]);
  }
  return NextResponse.json(await setAlertPrefs(patch));
}
