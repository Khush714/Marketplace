"use client";

import { useRef, useState } from "react";
import Link from "next/link";

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

type Field =
  | "name"
  | "slug"
  | "cuisine"
  | "description"
  | "priceRange"
  | "imageUrl"
  | "address"
  | "menuUrl"
  | "qrImageUrl"
  | "tagline"
  | "acceptOnlineOrders"
  | "acceptDelivery"
  | "acceptPickup"
  | "deliveryFee"
  | "minOrder"
  | "etaMinutes"
  | "pickupEtaMinutes";

const INITIAL: Record<Field, string | boolean | number> = {
  name: "",
  slug: "",
  cuisine: "Indian",
  description: "",
  priceRange: "$$",
  imageUrl: "",
  address: "",
  menuUrl: "",
  qrImageUrl: "",
  tagline: "",
  acceptOnlineOrders: true,
  acceptDelivery: true,
  acceptPickup: true,
  deliveryFee: 0,
  minOrder: 0,
  etaMinutes: 30,
  pickupEtaMinutes: 15,
};

export function EnrollmentForm() {
  const [form, setForm] = useState<Record<Field, string | boolean | number>>(INITIAL);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [slugOverride, setSlugOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrFileRef = useRef<HTMLInputElement>(null);

  const set = <K extends Field>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function onNameChange(name: string) {
    set("name", name);
    if (!slugOverride) {
      set("slug", slugify(name));
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        set("imageUrl", data.url as string);
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function uploadQr(file: File) {
    setUploadingQr(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "QR upload failed");
      } else {
        set("qrImageUrl", data.url as string);
      }
    } catch {
      setError("QR upload failed");
    } finally {
      setUploadingQr(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) body[k] = v;

      const res = await fetch("/api/admin/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not submit your restaurant");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-8 text-center shadow-sm">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ink-950 ring-1 ring-emerald-500/25 text-3xl text-emerald-400">
          ✓
        </div>
        <h2 className="mt-4 text-2xl font-bold text-emerald-400">
          Submission received!
        </h2>
        <p className="mx-auto mt-3 max-w-md text-emerald-300/80">
          Thank you. Your restaurant is now{" "}
          <strong>pending review</strong>. Once our team approves it, it{" "}
          will appear on the marketplace for customers to discover and order
          from.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-2xl bg-ember-500 px-6 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
          >
            Back to home
          </Link>
          <button
            onClick={() => {
              setSubmitted(false);
              setForm(INITIAL);
              setSlugOverride(false);
            }}
            className="rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-bold text-white/70 transition hover:bg-white/10"
          >
            List another restaurant
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/8 bg-ink-850 p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:p-8">
      <div className="space-y-5">
        {/* Name + slug */}
        <div>
          <Field label="Restaurant name *">
            <Input
              value={String(form.name)}
              onChange={(v) => onNameChange(v)}
              placeholder="e.g. Green Bowl Express"
            />
          </Field>
          <div className="mt-3">
            <Field label="Marketplace link (slug) *">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/35">/</span>
                <Input
                  value={String(form.slug)}
                  onChange={(v) => {
                    setSlugOverride(true);
                    set("slug", slugify(v));
                  }}
                  placeholder="green-bowl-express"
                />
              </div>
            </Field>
            <p className="mt-1 text-xs text-white/35">
              Short, lowercase, no spaces — auto-generated from the name.
            </p>
          </div>
        </div>

        {/* Cuisine + price */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cuisine *">
            <Select
              value={String(form.cuisine)}
              options={BASE_CUISINES}
              onChange={(v) => set("cuisine", v)}
            />
          </Field>
          <Field label="Price range *">
            <Select
              value={String(form.priceRange)}
              options={PRICE_RANGES}
              onChange={(v) => set("priceRange", v)}
            />
          </Field>
        </div>

        {/* Address */}
        <Field label="Address *">
          <Input
            value={String(form.address)}
            onChange={(v) => set("address", v)}
            placeholder="e.g. 12 Main Street"
          />
        </Field>

        {/* Description */}
        <Field label="Restaurant description *">
          <textarea
            value={String(form.description)}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="A short description of your restaurant and what makes it special."
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
          />
        </Field>

        {/* Image */}
        <Field label="Restaurant image *">
          <div className="mt-1 flex items-center gap-3">
            <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-white/5">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(form.imageUrl)}
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
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-60"
              >
                {uploading ? "Uploading…" : "Upload image"}
              </button>
              <p className="mt-1 text-xs text-white/30">
                JPEG, PNG or WebP · max 4 MB
              </p>
            </div>
          </div>
        </Field>

        {/* QR code image */}
        <Field label="Menu QR code image (optional)">
          <div className="mt-1 flex items-center gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
              {form.qrImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(form.qrImageUrl)}
                  alt="Menu QR"
                  className="h-full w-full object-contain"
                />
              ) : null}
            </div>
            <div>
              <input
                ref={qrFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadQr(f);
                }}
              />
              <button
                type="button"
                onClick={() => qrFileRef.current?.click()}
                disabled={uploadingQr}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-60"
              >
                {uploadingQr ? "Uploading…" : "Upload QR"}
              </button>
              <p className="mt-1 text-xs text-white/30">
                Upload your existing menu QR code from your POS system. It will
                appear on your public listing so customers can scan it to open
                your menu.
              </p>
            </div>
          </div>
        </Field>

        {/* Online ordering */}
        <div className="border-t border-white/6 pt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white/45">
            Online ordering
          </h3>

          <div className="mt-3">
            <Field label="Existing menu / ordering link">
              <Input
                value={String(form.menuUrl)}
                onChange={(v) => set("menuUrl", v)}
                placeholder="https://your-pos-domain.com/menu"
              />
            </Field>
            <p className="mt-1 text-xs text-white/35">
              Customers will be sent to your existing menu/ordering page. Not
              required to submit — you can add it later.
            </p>
          </div>

          <div className="mt-4">
            <Check
              label="Accept online orders"
              checked={Boolean(form.acceptOnlineOrders)}
              onChange={(v) => set("acceptOnlineOrders", v)}
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Check
                label="Delivery"
                checked={Boolean(form.acceptDelivery)}
                onChange={(v) => set("acceptDelivery", v)}
              />
              <Check
                label="Pickup"
                checked={Boolean(form.acceptPickup)}
                onChange={(v) => set("acceptPickup", v)}
              />
            </div>
          </div>
        </div>

        {/* Advanced */}
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="py-2 text-sm font-medium text-ember-400 hover:text-ember-300 hover:underline"
        >
          {advanced ? "Hide" : "Show"} delivery & pricing settings (optional)
        </button>

        {advanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery fee ($)">
              <NumberInput value={Number(form.deliveryFee)} onChange={(v) => set("deliveryFee", v)} />
            </Field>
            <Field label="Minimum order ($)">
              <NumberInput value={Number(form.minOrder)} onChange={(v) => set("minOrder", v)} />
            </Field>
            <Field label="Delivery ETA (min)">
              <NumberInput value={Number(form.etaMinutes)} onChange={(v) => set("etaMinutes", v)} />
            </Field>
            <Field label="Pickup ETA (min)">
              <NumberInput value={Number(form.pickupEtaMinutes)} onChange={(v) => set("pickupEtaMinutes", v)} />
            </Field>
            <Field label="Storefront tagline" className="sm:col-span-2">
              <Input
                value={String(form.tagline)}
                onChange={(v) => set("tagline", v)}
                maxLength={200}
              />
            </Field>
          </div>
        )}

        {error && (
          <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? "Submitting…" : "Submit for review"}
        </button>
        <p className="text-center text-xs text-white/35">
          Your restaurant will only appear on the marketplace once approved by
          our team.
        </p>
      </div>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
      <label className="text-xs font-medium text-white/45">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 bg-ink-900 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8 [&>option]:bg-ink-900"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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
    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-ember-500"
      />
      <span className="text-sm text-white/70">{label}</span>
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
      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
    />
  );
}
