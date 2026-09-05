import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCategoryIdMap } from "@/lib/db-helpers";
import { learnFromCorrection } from "@/lib/smart-categorize";
import { detectRecurring } from "@/lib/recurring";

// Metta asks: the app notices things it doesn't understand and asks the
// user directly. Answers teach it permanently (same learning path as
// manual corrections). Dismissals and acknowledgements are remembered.

async function readSet(key: string): Promise<Set<string>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  try {
    return new Set(row ? (JSON.parse(row.value) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function writeSet(key: string, set: Set<string>) {
  const value = JSON.stringify([...set].slice(-400)); // bounded memory
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function GET() {
  const [dismissed, acked] = await Promise.all([
    readSet("questionsDismissed"),
    readSet("recurringAcked"),
  ]);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Mystery charges: unsorted or "Other" spending worth asking about.
  const mysteries = await prisma.transaction.findMany({
    where: {
      amount: { gt: 0 },
      date: { gte: since },
      OR: [{ categoryId: null }, { category: { name: "Other" } }],
    },
    orderBy: { amount: "desc" },
    take: 12,
    select: { id: true, name: true, merchantName: true, amount: true, date: true },
  });
  const chargeQuestions = mysteries
    .filter((t) => !dismissed.has(t.id))
    .slice(0, 3)
    .map((t) => ({
      kind: "charge" as const,
      txnId: t.id,
      merchant: t.merchantName || t.name,
      amount: t.amount,
      date: t.date,
    }));

  // Recurring charges the user hasn't acknowledged yet.
  const recurring = await detectRecurring();
  const recurringQuestions = recurring
    .filter((r) => !acked.has(r.merchant.toLowerCase()))
    .slice(0, 3)
    .map((r) => ({
      kind: "recurring" as const,
      merchant: r.merchant,
      amount: r.amount,
      cadence: r.cadence,
      monthlyCost: r.monthlyCost,
    }));

  // Weekly digest invitation: at most once every 7 days.
  const digestRow = await prisma.setting.findUnique({ where: { key: "digestLast" } });
  const digestDue =
    !digestRow || Date.now() - new Date(digestRow.value).getTime() > 7 * 86400_000;
  const digestQuestions = digestDue ? [{ kind: "digest" as const }] : [];

  return NextResponse.json({
    questions: [...digestQuestions, ...chargeQuestions, ...recurringQuestions],
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind: "charge" | "recurring" | "digest";
      txnId?: string;
      categoryName?: string;
      merchant?: string;
    };

    if (body.kind === "digest") {
      const value = new Date().toISOString();
      await prisma.setting.upsert({
        where: { key: "digestLast" },
        update: { value },
        create: { key: "digestLast", value },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "charge" && body.txnId) {
      if (body.categoryName) {
        const categoryMap = await getCategoryIdMap();
        const categoryId = categoryMap[body.categoryName];
        const txn = await prisma.transaction.findUnique({ where: { id: body.txnId } });
        if (!categoryId || !txn) {
          return NextResponse.json({ error: "Unknown category or charge." }, { status: 400 });
        }
        await prisma.transaction.update({
          where: { id: txn.id },
          data: { categoryId },
        });
        // The user's answer is law: learn the merchant permanently.
        await learnFromCorrection(txn.merchantName || txn.name, categoryId, txn.amount);
      }
      const dismissed = await readSet("questionsDismissed");
      dismissed.add(body.txnId);
      await writeSet("questionsDismissed", dismissed);
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "recurring" && body.merchant) {
      const acked = await readSet("recurringAcked");
      acked.add(body.merchant.toLowerCase());
      await writeSet("recurringAcked", acked);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown question." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Couldn't record that." }, { status: 500 });
  }
}
