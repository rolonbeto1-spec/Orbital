import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCategories } from "@/lib/db-helpers";

export async function GET() {
  await ensureCategories();
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ categories });
}
