import type { Prisma } from "@/generated/prisma";
import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { ownedBy } from "@/lib/security/ownership";
import { transactionListQuery } from "@/lib/validation";
import { parseMonthKey, trailingDays } from "@/lib/time";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Activity list.
 *
 * Tenancy: `ownedBy(user.id)` is the first thing in the WHERE clause, and the
 * filters the client supplies (account, bank, category, folder) are ANDed
 * with it. A client passing another user's account id gets an empty list, not
 * an error and not somebody else's data — the scope makes it unmatchable
 * rather than needing a separate check (§7).
 *
 * Resource limits (§51, §52): `limit` is capped at 200 by the schema, search
 * text at 80 characters, and the date window at three years. There is no way
 * to ask this endpoint for an unbounded scan.
 */
export const GET = route(
  { auth: "user", limits: ["read"], query: transactionListQuery },
  async (ctx) => {
    const { month, days, category, account, bank, folder, search, limit, offset } = ctx.query;

    const where: Prisma.TransactionWhereInput = { ...ownedBy(ctx.user.id) };

    // Period boundaries are computed in the user's own timezone (§50).
    if (month) {
      const range = parseMonthKey(ctx.user.timezone, month);
      if (range) where.date = { gte: range.start, lt: range.end };
    } else if (days) {
      const range = trailingDays(ctx.user.timezone, days);
      where.date = { gte: range.start };
    }

    if (category) where.categoryId = category;
    if (folder) where.folderId = folder;
    if (account) where.accountId = account;
    else if (bank) where.account = { itemId: bank, userId: ctx.user.id };

    if (search) {
      // Prisma's `contains` is a parameterised LIKE — the value is never
      // interpolated into SQL, and it is not compiled as a regex, so there is
      // no injection and no ReDoS surface (§15, §52).
      const or: Prisma.TransactionWhereInput[] = [
        { name: { contains: search } },
        { merchantName: { contains: search } },
        { notes: { contains: search } },
      ];
      // "44.74" or "$44.74" also finds the purchase by amount. With integer
      // cents this is an exact equality rather than the epsilon window a float
      // column needed — searching for 44.74 now finds exactly 4474 cents.
      const asAmount = Number.parseFloat(search.replace(/[$,]/g, ""));
      if (Number.isFinite(asAmount) && asAmount > 0) {
        const cents = dollarsToCents(asAmount);
        or.push({ amountCents: cents });
        or.push({ amountCents: -cents });
      }
      where.OR = or;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        // Explicit select rather than a bare include: the browser gets exactly
        // the fields the list renders and nothing that happens to be on the
        // row (§59).
        select: {
          id: true,
          amountCents: true,
          date: true,
          name: true,
          merchantName: true,
          categoryId: true,
          logoUrl: true,
          pending: true,
          currencyCode: true,
          notes: true,
          owedBack: true,
          reimbursedAmountCents: true,
          folderId: true,
          category: { select: { id: true, name: true, icon: true, color: true, group: true } },
          account: { select: { name: true, mask: true } },
        },
        orderBy: { date: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.transaction.count({ where }),
    ]);

    // The money boundary: `*Cents` integers become dollar numbers here, once,
    // for display. Everything above this line was exact (§49).
    return safeJson({
      transactions: transactions.map((t) => serializeMoneyFields(t)),
      total,
      limit,
      offset,
    });
  },
);
