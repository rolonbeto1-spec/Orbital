import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getReimbursements } from "@/lib/queries";

export async function GET() {
  const data = await getReimbursements();
  return NextResponse.json(data);
}

// Record a repayment against an owed-back purchase.
// Body: { id, amount } (adds to reimbursed) or { id, full: true } (mark fully paid back).
export async function POST(req: Request) {
  const body = await req.json();
  const { id, amount, full } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let reimbursed = txn.reimbursedAmount;
  if (full) reimbursed = txn.amount;
  else if (typeof amount === "number") reimbursed = Math.min(txn.amount, Math.max(0, reimbursed + amount));

  const updated = await prisma.transaction.update({
    where: { id },
    data: { owedBack: true, reimbursedAmount: reimbursed },
  });
  return NextResponse.json({ ok: true, reimbursedAmount: updated.reimbursedAmount });
}
