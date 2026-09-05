import { NextResponse } from "next/server";
import { getHive } from "@/lib/hive";
import { ensureDemoData } from "@/lib/db-helpers";

export async function GET(req: Request) {
  await ensureDemoData();
  const { searchParams } = new URL(req.url);
  const hive = await getHive(searchParams.get("window"));
  return NextResponse.json(hive);
}
