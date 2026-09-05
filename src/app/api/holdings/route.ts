import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account");
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });

  const holdings = await prisma.holding.findMany({
    where: { accountId },
    orderBy: { value: "desc" },
  });
  return NextResponse.json({ holdings });
}
