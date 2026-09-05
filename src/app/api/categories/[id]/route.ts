import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Category customization — today that's whether it counts toward the budget.
// inBudget: true = counted, false = excluded, null = back to the default.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (!("inBudget" in body)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const inBudget = body.inBudget === null ? null : Boolean(body.inBudget);
  try {
    const updated = await prisma.category.update({ where: { id }, data: { inBudget } });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
