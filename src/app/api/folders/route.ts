import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Bookkeeping folders: list with counts/totals, create by name.
export async function GET() {
  const folders = await prisma.folder.findMany({
    include: { transactions: { select: { amount: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      count: f.transactions.length,
      total: Math.round(f.transactions.reduce((s, t) => s + Math.max(0, t.amount), 0) * 100) / 100,
    })),
  });
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }
  const folder = await prisma.folder.upsert({
    where: { name: name.trim() },
    update: {},
    create: { name: name.trim() },
  });
  return NextResponse.json(folder);
}
