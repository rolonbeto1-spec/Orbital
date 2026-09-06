"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, Plus, X, Trash2, Home as HomeIcon, Hammer } from "lucide-react";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/client";
import { formatCurrency } from "@/lib/format";

interface Property {
  id: string;
  name: string;
  rentIncome: number;
  mortgage: number;
  utilities: number;
  hoa: number;
  sweatIn: number;
  sweatOut: number;
  notes: string | null;
  net: number;
  sweatNet: number;
}

export default function RentalsPage() {
  const { data, loading, refetch } = useApi<{ properties: Property[]; totalNet: number }>(
    "/api/properties"
  );
  const [editing, setEditing] = useState<Property | "new" | null>(null);

  const properties = data?.properties ?? [];

  return (
    <div>
      <header className="flex items-center gap-2 px-4 pb-2 pt-6">
        <Link href="/app" className="rounded-full p-2 active:bg-surface-2">
          <ChevronLeft size={22} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Rentals</h1>
          <p className="text-sm text-text-muted">Per-house profit &amp; loss</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="btn btn-primary h-10 w-10 rounded-full p-0"
        >
          <Plus size={20} />
        </button>
      </header>

      {data && properties.length > 0 && (
        <div className="mx-5 mb-2 card p-4">
          <p className="text-sm text-text-muted">All properties · monthly</p>
          <p
            className="text-3xl font-bold tabular-nums"
            style={{ color: data.totalNet >= 0 ? "var(--positive)" : "var(--negative)" }}
          >
            {data.totalNet >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(data.totalNet))}
          </p>
        </div>
      )}

      {loading && !data ? (
        <div className="mx-5 h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : properties.length === 0 ? (
        <div className="mt-10 px-5 text-center">
          <HomeIcon size={36} className="mx-auto text-text-faint" />
          <p className="mt-3 text-sm text-text-faint">
            Track a rental: rent vs mortgage &amp; utilities, and how much work
            you&apos;ve really put into the house.
          </p>
          <button
            onClick={() => setEditing("new")}
            className="btn btn-primary mx-auto mt-4 px-5 py-2.5 text-sm"
          >
            <Plus size={18} /> Add your first property
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-5">
          {properties.map((p) => {
            const pos = p.net >= 0;
            return (
              <button
                key={p.id}
                onClick={() => setEditing(p)}
                className="card w-full p-4 text-left active:bg-surface-2"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <HomeIcon size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-text-muted">
                      {pos
                        ? "Tenants cover it — this one pays you"
                        : "Rent doesn't fully cover it — you top it up"}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-lg font-bold tabular-nums"
                    style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
                  >
                    {pos ? "+" : "−"}
                    {formatCurrency(Math.abs(p.net))}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted tabular-nums">
                  <span>
                    Rent <b className="text-positive">+{formatCurrency(p.rentIncome, { compact: true })}</b>
                  </span>
                  <span>
                    Mortgage <b className="text-text">−{formatCurrency(p.mortgage, { compact: true })}</b>
                  </span>
                  <span>
                    Utilities <b className="text-text">−{formatCurrency(p.utilities, { compact: true })}</b>
                  </span>
                  {p.hoa > 0 && (
                    <span>
                      HOA <b className="text-text">−{formatCurrency(p.hoa, { compact: true })}</b>
                    </span>
                  )}
                </div>
                {(p.sweatIn > 0 || p.sweatOut > 0) && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs">
                    <Hammer size={14} className="mt-0.5 shrink-0 text-text-faint" />
                    <p className="text-text-muted">
                      Sweat equity: put in {formatCurrency(p.sweatIn, { compact: true })}, gotten
                      out {formatCurrency(p.sweatOut, { compact: true })} —{" "}
                      <b style={{ color: p.sweatNet >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {formatCurrency(Math.abs(p.sweatNet), { compact: true })}{" "}
                        {p.sweatNet >= 0 ? "ahead" : "behind"}
                      </b>
                    </p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <PropertyEditor
          property={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

const FIELDS: { key: keyof FormState; label: string; hint?: string }[] = [
  { key: "rentIncome", label: "Monthly rent collected" },
  { key: "mortgage", label: "Monthly mortgage" },
  { key: "utilities", label: "Monthly utilities you cover" },
  { key: "hoa", label: "Monthly HOA (if any)" },
  { key: "sweatIn", label: "Total put in", hint: "furniture, repairs, upgrades" },
  { key: "sweatOut", label: "Total gotten out", hint: "rent collected to date" },
];

interface FormState {
  rentIncome: string;
  mortgage: string;
  utilities: string;
  hoa: string;
  sweatIn: string;
  sweatOut: string;
}

function PropertyEditor({
  property,
  onClose,
  onSaved,
}: {
  property: Property | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(property?.name ?? "");
  const [form, setForm] = useState<FormState>({
    rentIncome: property ? String(property.rentIncome) : "",
    mortgage: property ? String(property.mortgage) : "",
    utilities: property ? String(property.utilities) : "",
    hoa: property?.hoa ? String(property.hoa) : "",
    sweatIn: property?.sweatIn ? String(property.sweatIn) : "",
    sweatOut: property?.sweatOut ? String(property.sweatOut) : "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const num = (s: string) => parseFloat(s) || 0;
    const body = {
      name: name.trim(),
      rentIncome: num(form.rentIncome),
      mortgage: num(form.mortgage),
      utilities: num(form.utilities),
      hoa: num(form.hoa),
      sweatIn: num(form.sweatIn),
      sweatOut: num(form.sweatOut),
    };
    try {
      if (property) await apiPatch(`/api/properties/${property.id}`, body);
      else await apiPost("/api/properties", body);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!property) return;
    setBusy(true);
    try {
      await apiDelete(`/api/properties/${property.id}`);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-lg font-bold">{property ? "Edit property" : "New property"}</p>
          <button onClick={onClose} className="rounded-full bg-surface-2 p-2">
            <X size={18} />
          </button>
        </div>

        <label className="mb-1 block text-sm font-semibold text-text-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Elm St duplex"
          className="mb-4 w-full rounded-xl border border-border bg-surface-2 p-3 outline-none focus:border-primary"
        />

        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-semibold text-text-muted">
                {f.label}
                {f.hint && <span className="block font-normal text-text-faint">{f.hint}</span>}
              </label>
              <div className="flex items-center rounded-xl border border-border bg-surface-2 px-3 py-2.5">
                <span className="font-bold text-text-muted">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder="0"
                  className="w-full bg-transparent font-semibold outline-none"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          {property && (
            <button
              onClick={remove}
              disabled={busy}
              className="btn btn-ghost px-4 py-3"
              style={{ color: "var(--negative)" }}
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="btn btn-primary flex-1 py-3"
          >
            {busy ? "Saving…" : "Save property"}
          </button>
        </div>
      </div>
    </div>
  );
}
