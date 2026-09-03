"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type OnboardingState = {
  name: string;
  slug: string;
  isListed: boolean;
  description: string;
  cuisine: string;
  priceRange: string;
  imageUrl: string;
  address: string;
  tagline: string;
  /** ORDER ONLINE deep-link — the restaurant's own POS menu / ordering page. */
  menuUrl: string;
  acceptOnlineOrders: boolean;
  acceptDelivery: boolean;
  acceptPickup: boolean;
  deliveryFee: number;
  minOrder: number;
  etaMinutes: number;
  pickupEtaMinutes: number;
};

const BASE_CUISINES = [
  "American",
  "Chinese",
  "Dessert",
  "Indian",
  "Italian",
  "Japanese",
  "Korean",
  "Lebanese",
  "Mediterranean",
  "Mexican",
  "Thai",
  "Vietnamese",
];

const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"];

export function OnboardingForm({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [cuisines, setCuisines] = useState<string[]>(BASE_CUISINES);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reuse the consumer categories endpoint to populate the cuisine dropdown.
  useEffect(() => {
    fetch("/api/marketplace/categories")
      .then((r) => r.json())
      .then((d: { categories?: { cuisine: string }[] }) => {
        const existing = (d.categories ?? []).map((c) => c.cuisine);
        setCuisines(
          [...new Set([...BASE_CUISINES, ...existing])].sort(),
        );
      })
      .catch(() => {});
  }, []);

  const set = <K extends keyof OnboardingState>(
    key: K,
    value: OnboardingState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: data.error ?? "Upload failed" });
      } else {
        set("imageUrl", data.url as string);
      }
    } catch {
      setMessage({ kind: "err", text: "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/marketplace/${form.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: data.error ?? "Could not save" });
      } else {
        setMessage({
          kind: "ok",
          text: data.consumerEligible
            ? "Saved — your restaurant is now live on the marketplace."
            : "Saved — your restaurant is not listed yet.",
        });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "err", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-500">
              Restaurant admin
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {form.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{form.address}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              form.isListed
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {form.isListed ? "Listed" : "Not listed"}
          </span>
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Marketplace
          </h2>

          {/* List my restaurant */}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-orange-300">
            <input
              type="checkbox"
              checked={form.isListed}
              onChange={(e) => set("isListed", e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-orange-500"
            />
            <span>
              <span className="block font-medium text-slate-900">
                List my restaurant
              </span>
              <span className="mt-0.5 block text-sm text-slate-500">
                When enabled your restaurant becomes eligible for the consumer
                platform and can receive online orders.
              </span>
            </span>
          </label>

          {/* Description */}
          <Field label="Restaurant description" className="mt-4">
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </Field>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Cuisine */}
            <Field label="Cuisine">
              <select
                value={form.cuisine}
                onChange={(e) => set("cuisine", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
              >
                {cuisines.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            {/* Price range */}
            <Field label="Price range">
              <select
                value={form.priceRange}
                onChange={(e) => set("priceRange", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
              >
                {PRICE_RANGES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Image upload */}
          <Field label="Restaurant image" className="mt-4">
            <div className="mt-1 flex items-center gap-3">
              <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-200">
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.imageUrl}
                    alt="Restaurant"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
                <p className="mt-1 text-xs text-slate-400">
                  JPEG, PNG or WebP · max 4 MB
                </p>
              </div>
            </div>
          </Field>

          {/* ── ONLINE ORDERING ─────────────────────────────────────── */}
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Online ordering
            </h2>

            <Field label="Existing menu / ordering link" className="mt-3">
              <input
                type="url"
                value={form.menuUrl}
                onChange={(e) => set("menuUrl", e.target.value)}
                placeholder="https://your-pos-domain.com/menu/your-restaurant"
                maxLength={2048}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
              <p className="mt-1 text-xs text-slate-400">
                Customers will be sent to this restaurant&apos;s existing menu and
                ordering system. We never take the order ourselves.
              </p>
            </Field>

            <div className="mt-4">
              <Check
                label="Accept online orders"
                checked={form.acceptOnlineOrders}
                onChange={(v) => set("acceptOnlineOrders", v)}
              />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Check
                  label="Delivery"
                  checked={form.acceptDelivery}
                  onChange={(v) => set("acceptDelivery", v)}
                />
                <Check
                  label="Pickup"
                  checked={form.acceptPickup}
                  onChange={(v) => set("acceptPickup", v)}
                />
              </div>
            </div>
          </div>

          {/* Advanced */}
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="mt-4 text-sm font-medium text-orange-600 hover:underline"
          >
            {advanced ? "Hide" : "Show"} delivery & pricing settings
          </button>

          {advanced && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Delivery fee ($)">
                <NumberInput
                  value={form.deliveryFee}
                  onChange={(v) => set("deliveryFee", v)}
                />
              </Field>
              <Field label="Minimum order ($)">
                <NumberInput
                  value={form.minOrder}
                  onChange={(v) => set("minOrder", v)}
                />
              </Field>
              <Field label="Delivery ETA (min)">
                <NumberInput
                  value={form.etaMinutes}
                  onChange={(v) => set("etaMinutes", v)}
                />
              </Field>
              <Field label="Pickup ETA (min)">
                <NumberInput
                  value={form.pickupEtaMinutes}
                  onChange={(v) => set("pickupEtaMinutes", v)}
                />
              </Field>
              <Field label="Storefront tagline" className="sm:col-span-2">
                <input
                  value={form.tagline}
                  onChange={(e) => set("tagline", e.target.value)}
                  maxLength={200}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </Field>
            </div>
          )}

          {/* SAVE */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : "SAVE"}
            </button>
            {form.isListed && (
              <Link
                href={`/restaurant/${form.slug}`}
                className="text-sm font-medium text-slate-600 hover:underline"
              >
                View on storefront →
              </Link>
            )}
          </div>

          {message && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                message.kind === "ok"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-600"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-orange-500"
      />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
    />
  );
}
