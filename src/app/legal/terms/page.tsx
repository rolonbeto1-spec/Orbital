export const metadata = { title: "Terms of Service — Metta" };

/**
 * TERMS OF SERVICE — DRAFT.
 *
 * As with the Privacy Policy, this describes the product honestly so that the
 * eventual legal document and the software agree. It is NOT legal advice and
 * has NOT been reviewed by counsel (§38).
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 pb-24">
      <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Draft — not yet reviewed by legal counsel.</strong> This must be
        reviewed by a qualified lawyer before Metta accepts public sign-ups.
      </div>

      <h1 className="font-heading text-2xl font-semibold">Terms of Service</h1>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-heading text-lg font-semibold">What Metta is</h2>
        <p>
          Metta is a personal-finance information tool. It connects to your bank
          accounts through Plaid, reads your balances and transactions, and
          helps you understand where your money goes.
        </p>

        <h2 className="font-heading text-lg font-semibold">What Metta is not</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Metta is <strong>not</strong> a bank, a payment service, or a money
            transmitter. It cannot move money.
          </li>
          <li>
            Metta does <strong>not</strong> provide financial, tax, investment
            or legal advice. Its figures and its assistant are informational.
          </li>
          <li>
            Metta&apos;s numbers come from your bank via Plaid and may be delayed,
            incomplete, or wrong. Your bank&apos;s own records are authoritative.
          </li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">Your account</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>You must give an email address you control, and confirm it.</li>
          <li>
            Keep your password to yourself. Tell us promptly if you think
            someone else has access to your account.
          </li>
          <li>Only connect financial accounts that are yours.</li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">Acceptable use</h2>
        <p>
          Do not attempt to access other people&apos;s data, disrupt the
          service, or use automated means to extract data at scale. Requests are
          rate-limited, and abuse may result in the account being suspended.
        </p>

        <h2 className="font-heading text-lg font-semibold">The AI assistant</h2>
        <p>
          The assistant is powered by a large language model. It can be wrong.
          Check anything that matters before acting on it. Daily usage limits
          apply.
        </p>

        <h2 className="font-heading text-lg font-semibold">Ending your account</h2>
        <p>
          You can delete your account at any time from Settings. See the Privacy
          Policy for exactly what is deleted and what small, non-financial
          record remains.
        </p>

        <h2 className="font-heading text-lg font-semibold">Contact</h2>
        <p>
          Support and privacy enquiries: <em>[support address to be added
          before launch]</em>.
        </p>
      </section>
    </main>
  );
}
