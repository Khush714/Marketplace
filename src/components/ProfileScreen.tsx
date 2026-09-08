"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadProfile, saveProfile } from "@/lib/profile";
import type { PublicRestaurant } from "@/lib/marketplace";

type Address = { id: number; label: string; line: string; isDefault: boolean };
type Me = {
  authenticated: boolean;
  customer?: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    loyaltyPoints?: number;
  };
  addresses?: Address[];
  savedCount?: number;
};

/**
 * Discovery-only profile.
 * The marketplace no longer creates orders — the profile is a discovery
 * companion (saved addresses, saved restaurants, loyalty balance).
 */
export function ProfileScreen() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<PublicRestaurant[]>([]);
  const [guest, setGuest] = useState({ name: "", phone: "", address: "" });
  const [newAddress, setNewAddress] = useState({ label: "Home", line: "" });
  const [addingAddress, setAddingAddress] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((m: Me) => setMe(m))
      .finally(() => setLoading(false));
    setGuest(loadProfile());
  }, []);

  useEffect(() => {
    if (!me?.authenticated) return;
    fetch("/api/me/saved")
      .then((r) => (r.ok ? r.json() : { saved: [] }))
      .then((s) => setSaved(s.saved ?? []));
  }, [me?.authenticated]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
    setMe({ authenticated: false });
  }

  async function addAddress() {
    if (!newAddress.line.trim()) return;
    setAddingAddress(true);
    const res = await fetch("/api/me/addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: newAddress.label,
        line: newAddress.line,
        isDefault: (me?.addresses?.length ?? 0) === 0,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setMe((prev) =>
        prev
          ? { ...prev, addresses: [...(prev.addresses ?? []), data.address] }
          : prev,
      );
      setNewAddress({ label: "Home", line: "" });
    }
    setAddingAddress(false);
  }

  async function removeAddress(id: number) {
    await fetch(`/api/me/addresses?id=${id}`, { method: "DELETE" });
    setMe((prev) =>
      prev
        ? {
            ...prev,
            addresses: (prev.addresses ?? []).filter((a) => a.id !== id),
          }
        : prev,
    );
  }

  async function unsave(slug: string) {
    await fetch(`/api/me/saved?slug=${slug}`, { method: "DELETE" });
    setSaved((prev) => prev.filter((r) => r.slug !== slug));
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-8 sm:px-6">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
      </main>
    );
  }

  // -------------------------- GUEST --------------------------
  if (!me?.authenticated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-6 sm:px-6">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-orange-100 text-2xl">
            👤
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">Guest</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with your phone to save addresses, favourite restaurants,
            and earn Tablz points on orders you place at partner restaurants.
          </p>
          <Link
            href="/login?return=/profile"
            className="mt-5 inline-block rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-orange-600"
          >
            Sign in with phone
          </Link>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Saved on this device
          </h2>
          <div className="mt-3 space-y-3">
            <Field
              label="Full name"
              value={guest.name}
              onChange={(v) => setGuest({ ...guest, name: v })}
            />
            <Field
              label="Phone"
              value={guest.phone}
              onChange={(v) => setGuest({ ...guest, phone: v })}
            />
            <Field
              label="Default delivery address"
              value={guest.address}
              onChange={(v) => setGuest({ ...guest, address: v })}
            />
          </div>
          <button
            onClick={() => saveProfile(guest)}
            className="mt-4 rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
          <p className="mt-3 text-xs text-slate-400">
            The marketplace itself never places orders — each restaurant&apos;s
            own POS handles menu, payment and delivery.
          </p>
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <RowLink href="/notifications" icon="🔔" label="Notifications" />
          <RowLink href="/restaurants" icon="🍽️" label="Browse restaurants" />
          <RowLink href="/admin/marketplace" icon="🏪" label="I own a restaurant" />
          <RowLink href="/roadmap" icon="🗺️" label="Product roadmap" />
        </section>
      </main>
    );
  }

  // ---------------------- AUTHENTICATED ----------------------
  const initials =
    (me.customer?.name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "👤";

  return (
    <main className="mx-auto max-w-2xl px-4 pt-6 sm:px-6">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-orange-100 text-xl font-bold text-orange-600">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {me.customer?.name || "TABLZ member"}
          </h1>
          <p className="text-sm text-slate-500">{me.customer?.phone}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600"
        >
          Sign out
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat value={me.savedCount ?? saved.length} label="Saved restaurants" />
        <Stat
          value={me.customer?.loyaltyPoints ?? 0}
          label="Tablz points"
          tone="orange"
        />
      </div>

      <section className="mt-6 rounded-2xl border border-orange-200 bg-orange-50/50 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Tablz points
        </h2>
        <p className="mt-2 text-3xl font-bold text-slate-900">
          {me.customer?.loyaltyPoints ?? 0}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Restaurants credit points when they close your ticket. 100 points =
          $1 credit at any partner.
        </p>
      </section>

      {/* Address book */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Addresses
        </h2>
        <div className="mt-3 space-y-2">
          {(me.addresses ?? []).length === 0 && (
            <p className="text-sm text-slate-500">No saved addresses yet.</p>
          )}
          {(me.addresses ?? []).map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {a.label}
                  {a.isDefault && (
                    <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                      default
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-700">{a.line}</p>
              </div>
              <button
                onClick={() => removeAddress(a.id)}
                aria-label="Remove"
                className="text-slate-300 transition hover:text-rose-500"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[110px_1fr] gap-2">
          <input
            value={newAddress.label}
            onChange={(e) =>
              setNewAddress({ ...newAddress, label: e.target.value })
            }
            placeholder="Label"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          <input
            value={newAddress.line}
            onChange={(e) =>
              setNewAddress({ ...newAddress, line: e.target.value })
            }
            placeholder="Address line"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
        </div>
        <button
          onClick={addAddress}
          disabled={addingAddress || !newAddress.line.trim()}
          className="mt-3 rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {addingAddress ? "Saving…" : "+ Add address"}
        </button>
      </section>

      {/* Saved restaurants */}
      <section
        id="saved"
        className="mt-6 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Saved restaurants
        </h2>
        <div className="mt-3 space-y-2">
          {saved.length === 0 && (
            <p className="text-sm text-slate-500">
              Tap the heart on any restaurant to save it here.
            </p>
          )}
          {saved.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"
            >
              {r.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.imageUrl}
                  alt={r.name}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/restaurants/${r.slug}`}
                  className="font-medium text-slate-900 hover:text-orange-600"
                >
                  {r.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {r.cuisines.join(" • ")}
                </p>
              </div>
              {r.menuUrl && (
                <a
                  href={r.menuUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-bold text-orange-600 hover:bg-orange-500 hover:text-white"
                >
                  Order ↗
                </a>
              )}
              <button
                onClick={() => unsave(r.slug)}
                className="text-xs font-medium text-slate-400 hover:text-rose-500"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <RowLink href="/notifications" icon="🔔" label="Notifications" />
        <RowLink href="/restaurants" icon="🍽️" label="Browse restaurants" />
        <RowLink href="/admin/marketplace" icon="🏪" label="I own a restaurant" />
        <RowLink href="/roadmap" icon="🗺️" label="Product roadmap" />
      </section>
    </main>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: "orange";
}) {
  const color = tone === "orange" ? "text-orange-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function RowLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-sm text-slate-700 transition last:border-0 hover:bg-slate-50"
    >
      <span className="text-lg">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      <span className="text-slate-300">›</span>
    </Link>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
      />
    </div>
  );
}
