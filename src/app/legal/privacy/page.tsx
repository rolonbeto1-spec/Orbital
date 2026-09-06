import Link from "next/link";

export const metadata = { title: "Privacy Policy — Metta" };

/**
 * PRIVACY POLICY — DRAFT.
 *
 * This document is written to describe what the software ACTUALLY does, so
 * that the eventual policy and the code agree. It is NOT legal advice and has
 * NOT been reviewed by counsel (§38).
 *
 * It deliberately does not claim "we never share your data", because that
 * would be false: Plaid, Anthropic, the hosting provider, the database
 * provider and the email provider each necessarily receive some data in order
 * for the product to work. Those relationships are named below.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 pb-24">
      <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Draft — not yet reviewed by legal counsel.</strong> This
        describes how the software behaves today. It must be reviewed by a
        qualified lawyer before Metta accepts public sign-ups.
      </div>

      <h1 className="font-heading text-2xl font-semibold">Privacy Policy</h1>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-heading text-lg font-semibold">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your name, email address and the password you choose (stored only as a hash).</li>
          <li>Your timezone, so months and weeks line up with your calendar.</li>
          <li>
            Financial data from the banks you connect: account names and types,
            balances, and transaction dates, descriptions, merchants and
            amounts.
          </li>
          <li>
            Things you create in the app: budgets, goals, folders, notes,
            categories and category corrections.
          </li>
          <li>
            Security records: sign-ins, password changes, and bank connections
            or disconnections, with a coarsened IP address (the last part is
            discarded) and your browser&apos;s user-agent string.
          </li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">What we never collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Your bank username or password.</strong> Those are entered
            directly with Plaid and never reach Metta.
          </li>
          <li>
            <strong>Your email account password.</strong> The cancellation
            helper drafts an email for you to send yourself; Metta never has
            access to your mailbox.
          </li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">What Metta cannot do</h2>
        <p>
          Metta&apos;s access to your bank is read-only. It can see balances and
          transactions. It cannot transfer money, pay bills, make purchases, or
          move funds between accounts — there is no code in the product capable
          of doing so.
        </p>

        <h2 className="font-heading text-lg font-semibold">Who else receives data</h2>
        <p>
          Delivering this product requires sending some data to other
          companies. We do not sell your data, and we do not share it for
          advertising. The companies involved are:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Plaid</strong> — connects to your bank and provides balances
            and transactions. Plaid has its own privacy policy and its own
            relationship with you.
          </li>
          <li>
            <strong>Anthropic</strong> — powers the assistant and the automatic
            categoriser. When you use those features, a summary of your
            finances (amounts, categories, merchant names) is sent to
            Anthropic&apos;s API to produce an answer. It is not sent your name,
            your email, your bank credentials, or any account number.
          </li>
          <li>
            <strong>Our hosting and database providers</strong> — run the
            application and store the data.
          </li>
          <li>
            <strong>Our email provider</strong> — delivers confirmation,
            password-reset and security-notification emails. It receives your
            email address and the contents of those messages, which never
            include financial details.
          </li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">Your data is yours</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Export.</strong> You can download everything Metta holds
            about you as a JSON file, from Settings.
          </li>
          <li>
            <strong>Deletion.</strong> You can delete your account from
            Settings. We revoke your bank connections at Plaid and permanently
            delete your accounts, transactions, budgets, goals, folders,
            settings and categories.
          </li>
        </ul>

        <h2 className="font-heading text-lg font-semibold">
          What remains after deletion, and why
        </h2>
        <p>
          Security audit records — that an account was created, signed in to,
          or deleted, and when — are kept with the link to your account
          removed. They contain no financial information. They exist so that we
          can investigate security incidents, which is not possible if the
          record of an event disappears with the account.
        </p>

        <h2 className="font-heading text-lg font-semibold">Contact</h2>
        <p>
          Questions about this policy or your data:{" "}
          <Link href="/legal/terms" className="underline">
            see the Terms
          </Link>{" "}
          for contact details.
        </p>
      </section>
    </main>
  );
}
