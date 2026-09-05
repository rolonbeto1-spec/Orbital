import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const goals = await prisma.goal.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, targetAmount, currentAmount, targetDate, icon, color } = body;
  if (!name || typeof targetAmount !== "number" || targetAmount <= 0) {
    return NextResponse.json({ error: "name and targetAmount required" }, { status: 400 });
  }
  const goal = await prisma.goal.create({
    data: {
      name,
      targetAmount,
      currentAmount: typeof currentAmount === "number" ? currentAmount : 0,
      targetDate: targetDate ? new Date(targetDate) : null,
      icon: icon || "target",
      color: color || "#6366f1",
    },
  });
  return NextResponse.json(goal);
}
