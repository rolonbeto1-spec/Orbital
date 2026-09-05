import { NextResponse } from "next/server";
import { plaidConfigured, PLAID_ENV } from "@/lib/plaid";

// Lets the UI know whether real bank connections are available.
export async function GET() {
  return NextResponse.json({ configured: plaidConfigured, env: PLAID_ENV });
}
