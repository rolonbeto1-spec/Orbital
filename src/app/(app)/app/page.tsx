"use client";

import Link from "next/link";
import { useState } from "react";
import {
  RefreshCw,
  ChevronDown,
  Undo2,
  CalendarDays,
  Check,
  Move,
  CheckCheck,
  PiggyBank,
} from "lucide-react";
import { useApi, apiPost, apiDelete } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { DashboardData } from "@/lib/types";
import {
  HiveCanvas,
  type HiveData,
  type HiveLayout,
  type HiveSelection,
} from "@/components/hive/HiveCanvas";
import { HiveSheet } from "@/components/hive/HiveSheet";
import { Section, Card, Divider } from "@/components/Section";
import { TransactionRow } from "@/components/TransactionRow";
import { ConnectBank } from "@/components/ConnectBank";
import { CountUp } from "@/components/CountUp";
import { MettaAsks } from "@/components/MettaAsks";
import { NudgesCard } from "@/components/NudgesCard";

const BRANCH_COLOR: Record<string, string> = {
  needs: "var(--needs)",
  wants: "var(--wants)",
  invest: "var(--invest)",
  rentals: "var(--rentals)",
};

export default function HomePage() {
  const [windowSpec, setWindowSpec] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const {
    data: hive,
    loading: hiveLoading,
    refetch: refetchHive,
  } = useApi<HiveData>(`/api/hive${windowSpec ? `?window=${encodeURIComponent(windowSpec)}` : ""}`);
  const { data: dash, refetch: refetchDash } = useApi<DashboardData>("/api/dashboard");
  const { data: layoutData, setData: setLayoutData } = useApi<{ layout: HiveLayout }>(
    "/api/hive-layout",
  );
  const [selection, setSelection] = useState<HiveSelection | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const layout = layoutData?.layout ?? {};
  const hasCustomLayout = Object.keys(layout).length > 0;

  async function saveLayout(next: HiveLayout) {
    setLayoutData({ layout: next });
    try {
      await apiPost("/api/hive-layout", { layout: next });
    } catch {
      // keep the optimistic layout; it re-syncs on next save
    }
  }
  async function resetLayout() {
    setLayoutData({ layout: {} });
    try {
      await apiDelete("/api/hive-layout");
    } catch {}
  }

  async function sync() {
    setSyncing(true);
    try {
      await apiPost("/api/plaid/sync");
    } catch {
      // demo mode returns ok
    } finally {
      await Promise.all([refetchHive(), refetchDash()]);
      setSyncing(false);
    }
  }

  return (
    <div>
      {/* ---- The hive: full-viewport hero ---- */}
      <section
        className="relative flex flex-col"
        style={{ height: "calc(100dvh - 92px)", minHeight: 540 }}
      >
        <header className="flex items-start justify-between px-5 pt-5">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Your money</h1>
            {dash?.netWorth?.trueAvailable != null && (dash.netWorth.cardDebt ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-text-muted">
                Truly available{" "}
                <b className="tabular-nums text-text">
                  <CountUp value={dash.netWorth.trueAvailable} format={formatCurrency} />
                </b>{" "}
                after cards
              </p>
            )}
            <button
              onClick={() => setPickerOpen(true)}
              className="mt-1.5 flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-muted active:scale-95"
            >
              <CalendarDays size={12} />
              {hive?.windowLabel ?? "Past 35 days"}
              <ChevronDown size={12} />
            </button>
          </div>
          <div className="flex gap-2">
            {editMode && hasCustomLayout && (
              <button
                onClick={resetLayout}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
              >
                <Undo2 size={13} />
                Reset
              </button>
            )}
            <button
              onClick={() => setEditMode(!editMode)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold active:scale-95"
              style={
                editMode
                  ? { background: "var(--primary)", color: "#fff" }
                  : {
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--text-muted)",
                    }
              }
            >
              {editMode ? <CheckCheck size={13} /> : <Move size={13} />}
              {editMode ? "Done" : "Arrange"}
            </button>
            {!editMode && (
              <button
                onClick={sync}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
              >
                <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing" : "Sync"}
              </button>
            )}
          </div>
        </header>
        {editMode && (
          <p className="px-5 pt-1 text-[11px] font-medium text-primary">
            Drag hexagons where you want them, then tap Done.
          </p>
        )}

        <div className="min-h-0 flex-1">
          {hiveLoading && !hive ? (
            <div className="flex h-full items-center justify-center">
              <div className="skeleton h-24 w-24" style={{ clipPath: "var(--hex)" }} />
            </div>
          ) : hive && hive.branches.length > 0 ? (
            <HiveCanvas
              key={windowSpec ?? "default"}
              data={hive}
              layout={layout}
              editMode={editMode}
              onSelect={setSelection}
              onLayoutChange={saveLayout}
            />
          ) : dash?.plaidConfigured ? (
            <div className="stagger flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
              <div
                className="anim-float flex h-20 w-20 items-center justify-center text-white"
                style={{
                  clipPath: "var(--hex)",
                  background:
                    "linear-gradient(160deg, color-mix(in oklab, var(--primary) 75%, white), var(--primary) 60%, color-mix(in oklab, var(--primary) 80%, black))",
                }}
              >
                <PiggyBank size={34} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">Welcome to Metta</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Link your first bank and the hive comes alive.
                </p>
              </div>
              <ol className="w-full max-w-xs space-y-2 text-left">
                {[
                  "Connect a bank — logins stay with Plaid, never here.",
                  "Watch your money organize itself into the hive.",
                  "Set your budget and let Metta keep watch.",
                ].map((step, i) => (
                  <li key={i} className="card flex items-center gap-3 px-4 py-3 text-[13px]">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ background: "var(--primary)" }}
                    >
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <div className="w-full max-w-xs">
                <ConnectBank configured onConnected={sync} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <p className="text-sm text-text-faint">
                No activity yet — connect a bank or load the demo data to light up the hive.
              </p>
              <ConnectBank configured={false} onConnected={sync} />
            </div>
          )}
        </div>

        {/* split bar */}
        {hive && hive.branches.length > 0 && (
          <div className="border-t border-border bg-surface/85 px-4 pb-3 pt-2.5 backdrop-blur">
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              {hive.branches.map((b) => (
                <i
                  key={b.id}
                  style={{ width: `${b.pct}%`, background: BRANCH_COLOR[b.id] }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between gap-1.5">
              {hive.branches.map((b) => (
                <span key={b.id} className="flex items-center gap-1 text-[11px] font-semibold">
                  <i
                    className="h-2 w-2 rounded-full"
                    style={{ background: BRANCH_COLOR[b.id] }}
                  />
                  <span className="text-text-muted">{b.label}</span>
                  <b className="tabular-nums">{b.pct}%</b>
                </span>
              ))}
            </div>
            <p className="mt-1 flex items-center justify-center gap-1 text-center text-[10px] text-text-faint">
              <ChevronDown size={11} /> scroll for heads-up & activity
            </p>
          </div>
        )}
      </section>

      {/* ---- Below the fold ---- */}
      <div className="stagger">
        <MettaAsks />
        <NudgesCard />

        {dash && dash.recent.length > 0 && (
          <Section title="Recent activity" href="/transactions">
            <Card>
              {dash.recent.map((t, i) => (
                <div key={t.id}>
                  {i > 0 && <Divider />}
                  <TransactionRow txn={t} />
                </div>
              ))}
            </Card>
          </Section>
        )}

        {dash && dash.connectedBanks === 0 && hive && hive.branches.length > 0 && (
          <div className="mx-5 mt-6">
            <ConnectBank configured={dash.plaidConfigured} onConnected={sync} />
          </div>
        )}

        <div className="h-4" />
        <p className="pb-2 text-center text-[11px] text-text-faint">
          <Link href="/accounts" className="underline">
            Accounts
          </Link>
          {" · "}
          <Link href="/goals" className="underline">
            Goals
          </Link>
          {" · "}
          <Link href="/rentals" className="underline">
            Rentals
          </Link>
          {" · "}
          <Link href="/business" className="underline">
            Business
          </Link>
          {" · "}
          <Link href="/folders" className="underline">
            Folders
          </Link>
          {" · "}
          <Link href="/report" className="underline">
            Monthly report
          </Link>
        </p>
      </div>

      {hive && (
        <HiveSheet
          selection={selection}
          data={hive}
          windowSpec={windowSpec}
          onClose={() => setSelection(null)}
          onSelect={setSelection}
        />
      )}

      <WindowPicker
        open={pickerOpen}
        current={windowSpec}
        onClose={() => setPickerOpen(false)}
        onPick={(spec) => {
          setWindowSpec(spec);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

// Pick the span the hive looks at — quick presets or a specific month.
function WindowPicker({
  open,
  current,
  onClose,
  onPick,
}: {
  open: boolean;
  current: string | null;
  onClose: () => void;
  onPick: (spec: string | null) => void;
}) {
  const now = new Date();
  const months: { spec: string; label: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      spec: `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  const presets: { spec: string | null; label: string }[] = [
    { spec: null, label: "Past 35 days" },
    { spec: "week", label: "This week" },
    { spec: "month", label: `This month (${now.toLocaleDateString("en-US", { month: "long" })})` },
  ];

  const Row = ({ spec, label }: { spec: string | null; label: string }) => (
    <button
      onClick={() => onPick(spec)}
      className="flex w-full items-center justify-between border-t border-border px-1 py-3 text-left"
    >
      <span className={`text-[15px] ${current === spec ? "font-bold" : "font-medium"}`}>
        {label}
      </span>
      {current === spec && <Check size={17} className="text-primary" />}
    </button>
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[70dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-5 pb-8 shadow-lg transition-transform duration-[380ms] ${open ? "translate-y-0" : "translate-y-full"}`}
        style={{ transitionTimingFunction: "cubic-bezier(.32,.72,.24,1)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <h2 className="mb-2 text-lg font-bold">What are you looking at?</h2>
        {presets.map((p) => (
          <Row key={p.label} spec={p.spec} label={p.label} />
        ))}
        <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          A specific month
        </p>
        {months.map((m) => (
          <Row key={m.spec} spec={m.spec} label={m.label} />
        ))}
      </div>
    </>
  );
}
