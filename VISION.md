# Budget — Product Vision & Roadmap

The goal: a budgeting app that actually reflects how money *moves*, not just a
list of rectangles. One glance shows where your money goes, split into what you
**need**, what you **want**, and what you're **growing** — and you can dive into
any branch to see the detail.

---

## 1. The flow / "hive mind" home screen  ⬅ the centerpiece

Replace the rectangular dashboard with a living **bubble flow**:

- **Center:** your money (this month's pool).
- **First split — the mental model:**
  - **Needs** (has to go out): rent/housing, bills & utilities, groceries,
    transportation/gas, insurance, loan payments.
  - **Wants** (discretionary — the stuff you *can* control): dining out,
    entertainment, shopping, subscriptions you might not need.
  - **Investing / Saving:** real investment accounts — **stocks/brokerage, crypto,
    401(k), Roth IRA**, savings. Each bubble's size = this month's contribution
    (flow); tapping it opens the account **balance + holdings** (e.g. Crypto →
    Bitcoin/Ethereum/Solana; Stocks → VTI/AAPL/NVDA). Wires to real balances via
    Plaid Investments (and a manual/read-only option for crypto exchanges).
  - **Rentals** (special branch — see §6).
- **Bubbles are sized by amount** and carry an obvious icon.
- **Tap to dive in** — a division within a division. Needs → gas / bills /
  subscriptions. Tap a bubble again to go deeper. Breadcrumb to climb back out.

Design language: circles/orbs and connecting tendrils, not boxes. Feels alive.
Bubbles are sized by their real value and don't need to be perfectly symmetric —
an organic, uneven layout is fine (and preferred over forced even splits).

---

## 2. Smarter categorization  ("better than the big guys")

The hard problem: the same merchant means different things.

- **Amount-aware splitting:** $60 at a gas station = fuel (a *Need*); $8 at the
  same station = snacks (a *Want*). Use amount thresholds + history to guess.
- **Pattern learning:** recognizes your habits (favorite gas station, groceries
  every Saturday) and categorizes new charges accordingly — improving with use.
- Always correctable by hand; every correction teaches it.

---

## 3. Budget = discretionary only

The thing most apps get wrong: they lump fixed costs into "budget."

- **Fixed** (bills, utilities, rent, insurance) is tracked but **excluded from
  the budget** — it's committed, not a choice.
- **The budget is about Wants:** "what am I spending on the fun/optional stuff,
  and am I on pace?"
- Show fixed vs. discretionary split clearly.

---

## 4. Reimbursements — "you're owed this back"

- Flag a purchase as **owed back** (you fronted money for someone).
- When a repayment lands (Cash App, Apple Pay, Venmo, Zelle), detect it —
  by amount, note, or source — and **credit it back to your budget**, so a
  purchase you get paid back for doesn't count against you.

---

## 5. True available balance

Multiple accounts: business, high-yield savings, regular savings, checking, plus
a credit card. If you pay in full, your "available" cash looks **inflated** until
the card statement closes.

- Track the **pending credit-card balance** and subtract it, so the headline
  number is the money you *actually* have free to spend.

---

## 6. Rentals (deeper, lower priority — small audience)

A branch for property owners:

- Each **property is its own bubble**; dive in per house.
- Per house: **rental income − mortgage − utilities = profit / loss** for the
  month. Surface whether rent covers the mortgage + utilities, or you're topping
  it up.
- **Sweat-equity ledger:** money/work put in (furniture, repairs, improvements)
  vs. what you've truly gotten out over time.

---

## 7. AI chat / assistant

- **Ask:** "How much did I spend on food this week / this month?" — instant
  stats, pulled from your data.
- **Plan:** "I want to save for a house / a car / an upgrade" — breaks the goal
  into monthly numbers; supports multiple goals at once.
- **Proactive nudges:** "You're not on pace for your Wants budget." · "What was
  this big purchase for?" · "You spent on food Monday — that's digging into your
  usual Saturday spend."

---

## 8. Supporting pieces

- Multiple goals (already started) with contribution tracking.
- Multiple accounts across banks (already supported via Plaid).
- A clean monthly **summary report**.

---

## Build order & status

1. ~~Flow home screen~~ ✅ — the honeycomb hive is the app's real home screen
   (`src/lib/hive.ts`, `/api/hive`, `src/components/hive/`), driven by live
   data with health badges, tap-for-details sheets, and purchase timelines.
2. ~~Needs / Wants / Investing grouping~~ ✅ (`src/lib/buckets.ts`)
3. ~~Discretionary-only budgets~~ ✅ (budgets screen: Fixed vs Wants)
4. ~~Chat box~~ ✅ ("Ask" tab, rule-based; ~~LLM upgrade~~ ✅ — key-gated
   natural-language mode in `src/lib/assistant-llm.ts`, activates when
   `ANTHROPIC_API_KEY` is set, falls back to rules otherwise)
5. ~~Smarter categorization + learning~~ ✅ (`src/lib/smart-categorize.ts`)
6. ~~Reimbursements~~ ✅ and ~~true-available balance~~ ✅
7. ~~Rentals (light)~~ ✅ (/rentals: per-house P&L + sweat equity)

Also shipped: proactive nudges (§7's "heads up" side — pace, big purchases,
day-pattern breaks, stale reimbursements), per-category trends in Insights,
and per-bank / per-card filtering (Activity's combined statement and every
hive category sheet can narrow to one bank or card; all combined is default).

Later additions: the **monthly summary report** (/report — month picker,
in/out/kept + savings rate, category deltas, top merchants, standouts),
**recurring-charge detection** (`src/lib/recurring.ts` — "On a schedule" card
on Budgets + report line), and **investment holdings** (Holding model; demo
stocks/ETF/crypto shown inside hive account sheets; assistant sees them too).

Customization round: hexes are **draggable** (positions persist via a Setting
KV + `/api/hive-layout`, dotted strings stay connected, "Reset layout" undoes),
the **budget is the hive's center** (money hex to the side with an up/down
month-net badge; tapping budget opens the breakdown sheet), and **what counts
in the budget is per-category customizable** (`Category.inBudget` override,
threaded through budgets screen, hive, nudges, assistant, and report).

Window picker: the hive's span is selectable (35d / week / month-to-date /
any specific month) via `getHive(window)` + a picker sheet; category timelines
inherit the window. Activity search also matches exact amounts and notes.

### Still open

- Deeper pattern learning (amount-aware learned rules beyond gas stations).
- Plaid Investments for live holdings; crypto exchange connections (schema
  and UI are ready — holdings just need a live source).

Bookkeeping & business round (2026-08-10, from Robert's voice notes): design
v3 (calm palette, bigger cells, emerge animation, Arrange mode so scroll never
drags), Activity chip rows → two dropdowns, tax **folders** (Folder model,
save-to-folder in the editor, /folders screen), customizable **budget
reminders** (half / full / weekly via Setting KV, surfaced through nudges),
**business accounts** (Account.isBusiness — own /business breakdown with
net-profit-by-month; excluded from personal budget/hive/report/recurring), and
**assistant actions** (save-to-folder + reminder switches, key-free).

Deploy-ready (2026-08-10): password login gate (src/proxy.ts + signed
sessions + rate-limited /api/auth/login; auto-on when APP_PASSWORD is set,
open locally without it), sqlite↔postgres switch scripts (db:postgres /
db:deploy), and a plain-English deploy walkthrough in the README (Neon +
Vercel + envs). Demo-data deploys are supported — keys can come later.

### Considered and parked (deliberately)

- **Moving money between accounts** (2026-08-09): discussed and decided to
  hold off. Real transfers need a payments provider (Plaid Transfer/Dwolla),
  production approval, real authentication on the app, and compliance — it
  turns a personal dashboard into a fintech product. If ever revisited, start
  with the low-risk middle path: a "transfer helper" that suggests moves and
  auto-detects when the user makes them in their bank app, and/or a
  sandbox-only transfer flow. The app stays read-only until Robert explicitly
  says otherwise.
