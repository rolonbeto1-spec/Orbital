import { NextResponse } from "next/server";
import { getNudges } from "@/lib/nudges";

export async function GET() {
  const nudges = await getNudges();
  return NextResponse.json({ nudges });
}
