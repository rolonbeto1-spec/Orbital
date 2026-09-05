import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { monthRange } from "@/lib/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM
  const categoryId = searchParams.get("category");
  const accountId = searchParams.get("account");
  const bankId = searchParams.get("bank"); // an Item id — all accounts at one institution
  const search = searchParams.get("search");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  const where: Prisma.TransactionWhereInput = {};

  if (month) {
    const [y, m] = month.split("-").map(Number);
    if (y && m) {
      const { start, end } = monthRange(y, m - 1);
      where.date = { gte: start, lt: end };
    }
  }
  const days = Number(searchParams.get("days"));
  if (!month && days > 0) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    where.date = { gte: start };
  }
  if (categoryId) where.categoryId = categoryId;
  if (accountId) where.accountId = accountId;
  else if (bankId) where.account = { itemId: bankId };
  if (search) {
    const or: Prisma.TransactionWhereInput[] = [
      { name: { contains: search } },
      { merchantName: { contains: search } },
      { notes: { contains: search } },
    ];
    // "44.74" or "$44.74" finds the purchase by amount too.
    const asAmount = parseFloat(search.replace(/[$,]/g, ""));
    if (!isNaN(asAmount) && asAmount > 0) {
      or.push({ amount: { gte: asAmount - 0.005, lte: asAmount + 0.005 } });
      or.push({ amount: { gte: -asAmount - 0.005, lte: -asAmount + 0.005 } });
    }
    where.OR = or;
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { category: true, account: { select: { name: true, mask: true } } },
      orderBy: { date: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({ transactions, total, limit, offset });
}
