import { NextResponse } from "next/server";
import { detectRecurring } from "@/lib/recurring";

export async function GET() {
  const recurring = await detectRecurring();
  const monthlyTotal = Math.round(recurring.reduce((s, r) => s + r.monthlyCost, 0) * 100) / 100;
  return NextResponse.json({ recurring, monthlyTotal });
}
