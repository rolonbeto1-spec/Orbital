import { NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { plaidClient, plaidConfigured } from "@/lib/plaid";
import { prisma } from "@/lib/prisma";
import { syncItem } from "@/lib/sync";
import { retireDemoData } from "@/lib/db-helpers";

// Exchanges the public token from Plaid Link for a permanent access token,
// stores the Item, then runs an initial sync.
export async function POST(req: Request) {
  if (!plaidConfigured || !plaidClient) {
    return NextResponse.json({ error: "Plaid is not configured." }, { status: 400 });
  }

  try {
    const { public_token } = await req.json();
    if (!public_token) {
      return NextResponse.json({ error: "Missing public_token" }, { status: 400 });
    }

    // The first real bank replaces any demo data still hanging around.
    await retireDemoData();

    const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchange.data.access_token;
    const plaidItemId = exchange.data.item_id;

    // Look up institution name for a nicer label.
    let institutionName = "Bank";
    let institutionId: string | null = null;
    try {
      const itemRes = await plaidClient.itemGet({ access_token: accessToken });
      institutionId = itemRes.data.item.institution_id ?? null;
      if (institutionId) {
        const inst = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = inst.data.institution.name;
      }
    } catch {
      // non-fatal
    }

    const item = await prisma.item.upsert({
      where: { plaidItemId },
      create: { plaidItemId, accessToken, institutionId, institutionName },
      update: { accessToken, institutionId, institutionName },
    });

    const result = await syncItem(item.id);

    return NextResponse.json({ ok: true, institutionName, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
