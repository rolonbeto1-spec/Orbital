import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Account settings — today: mark an account as a business account, which
// gives it its own breakdown screen and keeps it out of personal budgets.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (!("isBusiness" in body)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  try {
    const updated = await prisma.account.update({
      where: { id },
      data: { isBusiness: Boolean(body.isBusiness) },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
