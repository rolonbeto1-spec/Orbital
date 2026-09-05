# Metta — Complete Context Dossier

> Everything an AI assistant or developer needs to understand this product,
> its code, its philosophy, and its history. Written 2026-08 after ~33 shipped
> updates. The repository this describes is `rolonbeto1-spec/bull-trader`
> (name is historical; the app is **Metta**).

---

## 1. What Metta is

Metta is a **private, single-user personal-finance PWA** built for its owner,
Robert. It connects to his real bank accounts and credit cards through
**Plaid** (Production access) and answers one question at a glance: **"where
is my money going?"** It is installed on his phone via Add to Home Screen and
lives at:

- **Live app:** https://bull-trader-pmo16.vercel.app (Vercel project
  `bull-trader`, team `pmo16`)
- **Login:** a single app-wide password (`APP_PASSWORD` env var), sessions
  last 30 days per device.

The owner is **non-technical** — he describes changes in plain English
(often voice-transcribed, with typos) and the assistant implements, tests,
and deploys them. Every explanation given to him should be plain-English
first, jargon-free.

### Product philosophy (decisions already made — do not relitigate)

1. **Read-only forever.** Metta can SEE money but never MOVE it. Plaid
   tokens are read-only; there is no payments, transfers, or money-movement
   code, deliberately (owner's explicit decision, recorded in VISION.md).
   The cancel-subscription helper deliberately stops at a `mailto:` draft —
   the user presses Send from their own mail app; Metta never holds email
   credentials.
2. **The user's word is law.** Manual recategorizations (tap in Activity, or
   chat command) create `MerchantRule` rows with `source: "learned"` that
   permanently outrank the AI sorter (`source: "ai"`) and builtin rules.
3. **AI sips, never gulps.** All AI calls use Claude **Haiku**
   (`claude-haiku-4-5`), batched (up to 60 items per call), cached per
   merchant, behind a daily call ceiling (`AI_DAILY_LIMIT`, default 1000, 0 =
   off) and strict timeouts (25–30s, 1 retry). Chat model is overridable via
   `AI_MODEL`. Every AI feature no-ops gracefully without a key.
4. **Keep-or-revert shipping.** Every change lands as its own squash-merged
   PR to `master` so the owner can say "remove it" about any one of them
   (he has: the Cash tracker was PR #23, reverted in #24).

---

## 2. Stack

- **Next.js 16.3** (App Router, Turbopack). NOTE: middleware is renamed —
  the auth gate lives in `src/proxy.ts` (exported `proxy()` + matcher), not
  `middleware.ts`. Consult `node_modules/next/dist/docs/` before assuming
  Next conventions; this version has breaking changes vs. older training data.
- **Prisma 6** → client generated to `src/generated/prisma`. Schema provider
  committed as `sqlite` (local dev); `scripts/vercel-build.js` flips it to
  `postgresql` at build time when `DATABASE_URL` starts with `postgres`.
- **Database:** Neon Postgres in production (via `DATABASE_URL` env var);
  local dev uses SQLite `prisma/dev.db`.
- **Plaid** (`plaid` SDK): production access; transactionsSync w/ cursor per
  Item; logos via `counterparties[0].logo_url ?? logo_url ??
  personal_finance_category_icon_url`.
- **Anthropic SDK** (`@anthropic-ai/sdk`): chat assistant + background AI.
- **Tailwind v4** (CSS-first `@theme inline` in `src/app/globals.css`; no
  tailwind.config.js). Recharts for charts. lucide-react icons. No
  framer-motion — all animation is hand-written CSS (deliberate).
- **Fonts:** Sora (headings, via `--font-heading`) + DM Sans (body), from
  next/font/google.
- **Hosting:** Vercel, auto-deploys `master`. The app lives at the **repo
  root** (moved there because fresh Vercel imports otherwise 404 — see §8).

## 3. Environment variables (Vercel → Settings → Environment Variables)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (build + runtime) |
| `APP_PASSWORD` | The app's login password (gate is off if unset) |
| `AUTH_SECRET` | HMAC key for session cookies |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid production credentials (`PLAID_ENV=production`) |
| `ANTHROPIC_API_KEY` | Enables AI chat + sorter + audit + logo detective + cancel helper |
| `AI_MODEL` (optional) | Chat model override, default `claude-haiku-4-5` |
| `AI_DAILY_LIMIT` (optional) | Daily AI-call ceiling, default 1000, `0` disables |

Env changes require a **Redeploy** to take effect.

## 4. Data model (prisma/schema.prisma)

- **Item** — one bank connection (Plaid item; `accessToken`, sync `cursor`).
- **Account** — checking/savings/credit/investment; `isBusiness` flag routes
  an account to the Business screen and OUT of the personal hive/budget.
- **Transaction** — Plaid convention: **positive = money out, negative =
  money in**. Fields: `categoryId`, `logoUrl`, `pending`, `owedBack` +
  `reimbursedAmount` (reimbursements net out of spending), `folderId`
  (bookkeeping folders), `notes`.
- **Category** — fixed catalog in `src/lib/categories.ts` (Income, Food &
  Dining, Groceries, Shopping, Transportation, Travel, Bills & Utilities,
  Housing, Entertainment, Health, Personal Care, Services, Fees, Loan
  Payments, Transfer, Other). `group`: income/expense/transfer. `inBudget`
  customizes budget membership (defaults: Wants in, Needs out).
- **MerchantRule** — learned/AI categorization memory. `match` (lowercased
  substring), optional `minAmount`/`maxAmount` bands (the "$8 at Shell is
  snacks, $60 is fuel" trick), `source`: learned | builtin | ai.
- **Budget** — monthly limit per category.
- **Goal**, **Property** (rentals P&L + sweat equity), **Holding**
  (investment contents), **Folder** (tax/bookkeeping).
- **Setting** — string KV store used heavily: hive layout, alert prefs,
  daily AI counters (`aiCalls:YYYY-MM-DD`), audit/logo timers, question
  dismissals (`questionsDismissed`, `recurringAcked`), digest timer
  (`digestLast`), cancel-plan cache (`cancelHelp:<merchant>`), demo flags
  (`demoRetired`, `demoLeftoversPurged`).

## 5. Screens (12) and what they do

Bottom nav: **Home, Activity, Budgets, Ask, Insights** (hexagon tabs).
Footer links on Home: Accounts · Goals · Rentals · Business · Folders ·
Monthly report.

- **Home = THE HIVE** (`src/components/hive/HiveCanvas.tsx`, data from
  `/api/hive` via `src/lib/hive.ts`). A honeycomb map: **Budget hex in the
  center** (glass, bold ring = % of monthly budget used, caption goes red
  when over), "Your money" hex (truly available = cash − unpaid card
  balances), four branches — **Needs / Wants / Investing / Rentals** — with
  per-category satellite cells sized by spend, each wearing an Apple-Watch
  style activity ring. "Other"/uncategorized spending shows as an Other cell
  under Wants (never hidden). Time-window picker (35d / week / month /
  specific month). **Arrange mode** drags cells; layout persists
  (`/api/hive-layout`). Below the fold: **Metta asks** (question cards),
  Heads-up nudges, recent activity.
- **Activity** — combined statement across all banks/cards (combined is
  default; dropdown filters per bank/card and category), search, merchant
  logos with tinted monogram fallback, "Repeats" badge on recurring charges,
  tap-to-edit (recategorize = permanent learning, notes, owed-back,
  save-to-folder).
- **Budgets** — per-category monthly limits with progress bars + the
  subscription radar card.
- **Ask** — chat assistant with three layers, tried in order
  (`/api/assistant`): (1) **deterministic actions** (token-free,
  `src/lib/assistant-actions.ts`): "Where's my money going?" full breakdown,
  "sort my transactions" (runs AI sorter + audit + logo pass immediately),
  "the <merchant> charge is <category>" (re-files + learns), "save X to
  folder Y", reminder toggles; (2) **Claude with a live financial snapshot**
  (`src/lib/assistant-llm.ts` — knows the app's own capabilities and its
  Claude identity); (3) built-in rule engine fallback (`src/lib/assistant.ts`)
  so chat never breaks.
- **Insights** — two tabs: **Overview** (net worth, savings rate, category
  donut, 6-month income-vs-spending bars) and **Recurring** (every detected
  recurring charge with cadence/monthly/yearly totals; each row expands into
  the **cancel helper**: AI-built steps, cancel page link, ready-to-send
  mailto email draft).
- **Report** — monthly story: in/out/kept, needs-vs-wants, category vs last
  month, top merchants, biggest purchase, subscriptions, rentals net.
- **Accounts** — manage connections, per-account Business toggle, sign out.
- **Goals / Rentals / Business / Folders** — savings targets; per-house P&L
  + sweat equity; business account breakdown (earnings/expenses/net by
  month); bookkeeping folders ("Taxes 2026").
- **/login** — password screen (only page outside the gate).

## 6. The AI subsystem (src/lib/ai-categorize.ts + friends)

Runs after every Plaid sync (`syncItem`) and on chat command:

1. **aiSortNewTransactions** — unsorted + "Other" spending → one batched
   Haiku call → verdicts written back + `MerchantRule(source:"ai")` per
   merchant, so each merchant costs tokens once ever.
2. **aiAuditTransactions** — weekly (Setting-timed), reviews last 90 days'
   categorization in ≤2 batches, fixes disagreements, skips merchants with
   learned rules.
3. **aiIdentifyLogos** — daily: free pass first (spread known logos across
   same-merchant rows), then one batched call mapping bare merchant names →
   official domains → Google favicon URLs as logos.
4. **Cancel helper** (`/api/cancel-help`) — per-merchant cancellation plan
   (steps/url/supportEmail/email draft), cached in Settings forever.
5. **Metta asks** (`/api/questions`) — the app interviews the owner: top-3
   mystery charges (one-tap category answers that learn permanently) + top-3
   unacknowledged recurring charges + a weekly "your week in 20 seconds"
   digest (`/api/digest`).

Cost armor everywhere: `spendOneDailyCall()` shared counter, 25–30s
timeouts, maxRetries 1, JSON parsed defensively, everything fails soft.
Routes that run AI work declare `export const maxDuration = 60` (Vercel
kills functions at ~10s otherwise — this was a real production bug).

## 7. Design system (globals.css)

- Palette: paper-light `#f7f8f6` / near-black `#0a0e0d` grounds; emerald
  primary `#0f7a55` (light) / `#34d399` (dark); branch hues in **oklch**
  (needs 210, wants 295, invest 168, rentals 355); per-category hues in
  `HiveCanvas.tsx` (`CATEGORY_HUE`).
- **Apple-idiom hive**: cells are quiet frosted glass (hairline seam, top
  light); COLOR = INFORMATION (icon tint + activity ring traced by weight);
  nectar fill is a whisper; center Budget hex is the same glass with more
  presence + spotlight. Stage lighting layer behind the canvas (hero
  spotlight, corner mist, vignette). Honeycomb pattern at 4% opacity.
  Strand links pulse slowly; SMIL particles flow along them.
- Motion: CSS only — `hexin` emerge (cells slide out from parents via
  `--fx/--fy`), `hivebreathe` (7s, ±0.8%), `.page-enter` glide (template.tsx;
  fill-mode must NOT persist transforms — a persisted transform turns the
  wrapper into a containing block and breaks `position: fixed` sheets, a
  real bug that shipped and was fixed), `.stagger` cascades (backwards
  fill), `.skeleton` shimmer, count-up numbers (`CountUp.tsx`). Every
  animation respects `prefers-reduced-motion`.
- Chrome: sticky glass headers (`PageHeader.tsx` — backdrop-blur-xl, 70%
  seam, glowing primary dot in a hex chip); glass bottom nav, hex tabs,
  thumb-width (max-w-md) inside a 768px (max-w-3xl) shell.
- Hive text: labels stay ≤74% width (hexagons narrow away from the middle);
  long names get SHORT_NAME display forms (Dining, Bills, Fun, Care,
  Savings, Business).

## 8. Deploy pipeline + hard-won operational knowledge

- Merging to `master` auto-deploys to Vercel (~1–2 min). The assistant ships
  via: build locally → commit to branch
  `claude/background-task-execution-avnvv3` → PR → squash-merge (squash
  causes branch divergence — merge `origin/master` back into the branch
  before each new PR).
- `scripts/vercel-build.js`: postgres DATABASE_URL → switch provider +
  `prisma generate` + `prisma db push` → `next build`; else plain build.
  Schema changes deploy automatically via db push (no migration files needed
  for prod).
- **Demo mode**: without Plaid keys, first boot seeds rich demo data
  (`prisma/seed.ts`, `ensureDemoData`). WITH Plaid keys, demo data is
  retired/purged instead (one-time, Settings-flagged, seed-signature
  matched) and the app shows a welcome until a real bank links.
- History lessons (do not repeat): the repo once had the app in a
  `budget-app/` subfolder — fresh Vercel imports built nothing (105ms
  "builds") and 404'd; the fix was moving the app to repo root +
  `vercel.json {"framework":"nextjs"}`. Vercel "Deployment Protection /
  Vercel Authentication" was once on and made every visitor see a login
  wall — it must stay DISABLED (the app has its own password). The owner has
  multiple Vercel accounts/projects from repeated imports; the ONLY real one
  is team `pmo16`, project `bull-trader`.
- Local dev: `npm install && npm run seed && npm run dev`. `npm run build`
  runs the vercel-build script (sqlite path locally). Kill stale servers
  with `pkill -f next-server` (NOT "next start" — the process is named
  next-server, and a zombie once served stale code during testing).

## 9. Security posture

HTTPS via Vercel; every page/API behind the password proxy (server-side,
`src/proxy.ts`) with signed HMAC cookies, rate-limited + constant-time login;
secrets only in env vars; bank credentials never touch the app (Plaid's job);
read-only tokens; AI receives financial snapshots but keys never reach the
browser. The app must never gain money-movement or email-credential powers.

## 10. Working with the owner

Robert communicates casually and by voice ("idk make it look better", "u
gotta figure it out"). Effective pattern: interpret intent generously,
implement end-to-end, verify with real tests/screenshots before shipping,
explain in plain English with honest caveats, offer keep-or-revert. He
values: things visibly working, cost control on AI, security of his money
data, and being asked for at most ONE thing at a time.
