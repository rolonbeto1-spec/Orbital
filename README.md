# Metta

A personal budgeting app that pulls **all your bank accounts onto one screen** —
balances, transactions, budgets, savings goals, and spending insights. Built
mobile-first so it lives on your phone's home screen like a real app.

Bank connections use [Plaid](https://plaid.com). The app ships in **demo mode**
with realistic sample data so you can use every feature immediately, then
connect your real banks whenever you're ready — no code changes, just keys.

<br>

## What's inside

| Screen | What it does |
| --- | --- |
| **Home** | Net worth, this month's income vs spending, all accounts, budgets, top spending, goals, and recent activity — one glance. |
| **Activity** | Every transaction across all your banks and cards in one combined statement. Search, filter by category, or narrow to one bank or one card (all combined is the default). Tap any item to recategorize it or add a note. |
| **Budgets** | Set a monthly limit per category and watch progress bars fill as you spend. |
| **Goals** | Savings targets (emergency fund, trip, down payment…) with progress. |
| **Insights** | Donut of where your money went + a 6-month income-vs-spending chart. |
| **Ask** | A chat assistant that answers from your own data — "How much did I spend on food this week?", "Am I on budget?", "What's my net worth?", "How much to save for $5,000 by December?". Works with no external API (see `src/lib/assistant.ts`); add a Claude API key to unlock full natural-language chat (see below). |
| **Rentals** | Per-house profit & loss: rent vs mortgage/utilities/HOA, whether tenants cover it, and a sweat-equity ledger (put in vs gotten out). |
| **Monthly report** | One month summarized: came in / went out / you kept (+ savings rate), Needs-vs-Wants split, every category vs last month, top merchants, biggest purchase, subscriptions total, rentals net. Flip back through past months. |

Plus, woven through the app:

- **Truly available** — the Home headline shows cash minus card balances you
  haven't paid yet, so an un-hit statement doesn't inflate your number.
- **Heads up nudges** — the app notices things: budget pace, unusually big
  purchases, eating out on a day you usually don't, money still owed to you.
- **Smart categorization** — a $8 gas-station charge is snacks, a $60 one is
  fuel; and every manual recategorization teaches it your preferences
  (`src/lib/smart-categorize.ts`).
- **Reimbursements** — mark a purchase "owed back" and it nets out of your
  spending as repayments (Cash App/Venmo/Zelle) come in.
- **Budget front and center** — the budget hex is the middle of the hive
  (it's why you check in), showing what's left this month; your total money
  sits in its own hex with an up/down read. Tapping the budget opens the full
  breakdown.
- **Make it yours** — drag any hexagon where you want it (dotted strings keep
  everything connected to its tier); the arrangement is saved, with one-tap
  reset. And the budget itself is customizable: every category can be pulled
  into or out of your budget — bills and necessities stay out unless you say
  otherwise.
- **Pick your window** — the hive can show the past 35 days, this week, this
  month, or any specific month; every hexagon, trend badge, and purchase list
  follows along.
- **Subscription radar** — charges that repeat on a schedule at a steady price
  (rent, utilities, Netflix…) are spotted automatically, with the monthly
  total and when each will hit next (`src/lib/recurring.ts`).
- **Investment holdings** — brokerage and crypto accounts show what's inside
  them (shares, coins, value, allocation) right from the hive.
- **Business mode** — mark any account as a business account and it gets its
  own breakdown (earnings, expenses, net profit by month, top costs) while
  staying out of your personal budget and hive.
- **Folders for bookkeeping** — save any charge into a folder ("Taxes 2026");
  at tax time the Folders screen lists every saved charge with its card, date,
  and month.
- **Budget reminders** — customizable heads-ups: halfway-mark alert, over-budget
  alert, weekly "week 2 of 4" pace check-ins.
- **An assistant that acts** — "save this Adobe charge to my tax folder",
  "remind me when I hit half my budget" — the chat does it, no key needed.

Works in light & dark mode, and installs to your phone home screen (PWA).

<br>

## Run it locally

```bash
npm install          # also generates the database client
npm run seed         # loads demo data (accounts, ~220 transactions, budgets, goals)
npm run dev          # open http://localhost:3000
```

That's the whole app, working, with sample data.

<br>

## Connect your real banks (Plaid)

The app runs fine without this — but here's how to see *your* money.

1. **Get free Plaid keys.** Sign up at
   [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup). Go to
   **Team Settings → Keys** and copy your **client_id** and the **Sandbox**
   secret.
2. **Add them to `.env`** (copy `.env.example` to `.env` if needed):
   ```env
   PLAID_CLIENT_ID=your_client_id
   PLAID_SECRET=your_sandbox_secret
   PLAID_ENV=sandbox
   ```
3. **Restart** the app, open it, and tap **Connect a bank**. In Sandbox, log in
   with the test credentials:
   - username: `user_good`
   - password: `pass_good`

   You'll see fake accounts and transactions flow in through the real Plaid
   pipeline.

### Linking your *actual* banks

Sandbox uses fake banks. To link a handful of your own real accounts, switch to
Plaid's **Development** environment:

- In the Plaid dashboard, request Development access (free, near-instant) and
  copy your **Development** secret.
- Set `PLAID_SECRET=your_development_secret` and `PLAID_ENV=development`.
- Reconnect your banks. Real balances and transactions now appear.

> Full **Production** access requires a short Plaid application, but for personal
> use Development is usually all you need.

<br>

## Unlock natural-language chat (Claude API key)

The **Ask** screen works out of the box with a built-in engine that handles the
common questions. Adding a Claude API key upgrades it to a real AI assistant
that can answer *anything* about your money — follow-up questions, comparisons,
"why", "what if" — using a live snapshot of your accounts, spending, budgets,
goals, rentals, and reimbursements.

1. **Create an account** at [console.anthropic.com](https://console.anthropic.com)
   (billing is pay-as-you-go; each chat answer costs a fraction of a cent).
2. Go to **API Keys → Create Key**, name it anything (e.g. `budget-app`), and
   copy the key — it starts with `sk-ant-`.
3. **Paste it into `.env`** in the project folder:
   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
4. **Restart** the app (`npm run dev`). The Ask screen's subtitle switches to
   **"AI chat"** — that's how you know it's on.

No key, wrong key, or a network blip? The app quietly falls back to the
built-in engine, so chat never breaks. Your financial data goes only to the
Claude API to answer your question and your key never leaves the server
(`src/lib/assistant-llm.ts`).

<br>

## Get it on your phone

The app is a PWA, so once it's reachable from your phone you can **Add to Home
Screen** and it opens full-screen like a native app.

- **Quick / same Wi-Fi:** run `npm run dev`, find your computer's local IP, and
  open `http://<your-ip>:3000` on your phone.
- **Anywhere:** deploy it — see the next section. That's the real setup.

<br>

## Deploy it (free) — your own private app, anywhere

The app is deploy-ready: it ships with a **password login** that switches on
automatically in production, and a one-command switch from the local SQLite
database to a hosted Postgres. Demo data works online exactly like it does
locally, so you can deploy first and add real bank keys whenever.

**1. Create a free database.** Sign up at [neon.tech](https://neon.tech),
create a project, and copy the connection string (starts with `postgresql://`).

**2. There is no step 2.** The deploy is self-configuring: when the build sees
a Postgres `DATABASE_URL`, it switches Prisma to postgresql and creates the
tables (`scripts/vercel-build.js`), and on first boot the app notices the
empty database and loads the demo data itself (`ensureDemoData`). No commands.

**3. Deploy on [vercel.com](https://vercel.com)** (free): import the GitHub
repo (the app lives at the repo root, so no root-directory setting is needed)
and add these environment variables in the project settings:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your Neon connection string |
| `APP_PASSWORD` | a strong password — this is your app's front door |
| `AUTH_SECRET` | a long random string (`openssl rand -hex 32`) |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | optional — later, for real banks |
| `ANTHROPIC_API_KEY` | optional — later, for AI chat |

Click Deploy. Two minutes later you have `https://your-app.vercel.app`.

**4. On your phone:** open the link, sign in with your password (the session
lasts 30 days per device), and **Add to Home Screen**. That's the app.

### Security notes, plainly

- Everything is served over **HTTPS** (Vercel does this automatically).
- Every screen and every API route is behind the password — enforced
  server-side (`src/proxy.ts`), not just hidden in the UI. Sessions are
  signed, expiring cookies; wrong passwords are rate-limited and slowed.
- Secrets (database URL, Plaid keys, AI key) live in environment variables on
  the server — never in the code, never sent to the browser.
- The app is **read-only** with respect to your banks: Plaid tokens can look,
  not move money. And your bank *passwords* never touch this app at all —
  that's Plaid's whole job.

<br>

## How it's built

- **Next.js 16** (App Router) — UI + server API routes in one app. Plaid's
  secret only ever runs server-side.
- **Prisma + SQLite** — local database (`prisma/schema.prisma`). One-line swap
  to Postgres for cloud hosting.
- **Plaid** — bank aggregation (`src/lib/plaid.ts`, `src/lib/sync.ts`).
- **Recharts** — the insight charts.
- **Tailwind CSS** — mobile-first styling with a light/dark design system.

### Project map

```
src/
  app/
    page.tsx              Dashboard (home)
    transactions/         Activity list + editor
    budgets/              Budget limits
    goals/                Savings goals
    insights/             Charts
    accounts/             Manage connected banks
    api/                  Server routes (plaid, accounts, transactions, budgets, goals, insights)
  components/             Reusable UI (rows, cards, nav, Plaid Link button)
  lib/                    prisma client, plaid client, sync engine, categories, queries, helpers
prisma/
  schema.prisma          Data model
  seed.ts                Demo data generator
```

### Useful commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run seed       # reset + load demo data
npm run db:reset   # wipe and re-migrate the database
```

<br>

## Notes

- Money is stored in dollars as floats — fine for personal use.
- Plaid's amount convention: positive = money out (spending), negative = money
  in (income). The UI handles the signs for you.
- Your `.env` (keys) and the local database file are gitignored.
