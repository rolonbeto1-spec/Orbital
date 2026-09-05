import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBudgetsWithSpend } from "@/lib/queries";

export async function GET() {
  const budgets = await getBudgetsWithSpend();
  return NextResponse.json({ budgets });
}

// Create or update a budget for a category (one budget per category).
export async function POST(req: Request) {
  const { categoryId, amount } = await req.json();
  if (!categoryId || typeof amount !== "number" || amount < 0) {
    return NextResponse.json({ error: "categoryId and amount required" }, { status: 400 });
  }
  const budget = await prisma.budget.upsert({
    where: { categoryId },
    create: { categoryId, amount },
    update: { amount },
    include: { category: true },
  });
  return NextResponse.json(budget);
}
