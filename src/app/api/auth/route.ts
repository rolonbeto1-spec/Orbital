import { NextResponse } from "next/server";

// Whether the login gate is on (APP_PASSWORD set). Lets the UI show or hide
// the Sign out control.
export async function GET() {
  return NextResponse.json({ enabled: !!process.env.APP_PASSWORD });
}
