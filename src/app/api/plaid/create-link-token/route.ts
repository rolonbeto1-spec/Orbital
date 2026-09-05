import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient, plaidConfigured } from "@/lib/plaid";

// Creates a Plaid Link token used by the frontend to launch the bank-connect flow.
export async function POST() {
  if (!plaidConfigured || !plaidClient) {
    return NextResponse.json(
      { error: "Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env." },
      { status: 400 }
    );
  }

  try {
    const res = await plaidClient.linkTokenCreate({
      user: { client_user_id: "local-user" },
      client_name: "Metta",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (err: unknown) {
    // Surface Plaid's own reason (e.g. INVALID_API_KEYS) instead of a bare 400.
    const plaidErr = (
      err as { response?: { data?: { error_code?: string; error_message?: string } } }
    )?.response?.data;
    const message = plaidErr?.error_code
      ? `Plaid says ${plaidErr.error_code}: ${plaidErr.error_message ?? ""}`
      : err instanceof Error
        ? err.message
        : "Failed to create link token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
