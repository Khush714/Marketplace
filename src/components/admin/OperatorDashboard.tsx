"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { currency, shortDate } from "@/lib/format";
import { statusLabel } from "@/lib/order-lifecycle";
import type { ListingRow } from "@/lib/data";

type Tab = "restaurants" | "reviews" | "orders";
type RestFilter = "all" | "pending" | "active" | "suspended";
type OrderBucket = "live" | "completed" | "cancelled";

type Overview = {
  restaurants: { total: number; pending: number; live: number; suspended: number };
  orders: { live: number; completed: number; cancelled: number };
  reviews: { published: number; pending: number; reports: number };
};

type Report = {
  id: number;
  reason: string;
  note: string;
  createdAt: string;
  review: {
    id: number;
    author: string;
    rating: number;
    comment: string;
    moderationStatus: string;
    restaurant: { name: string; slug: string };
  };
};

type AdminOrder = {
  reference: string;
  status: string;
  total: number;
  fulfillment: string;
  placedAt: string;
  customerName: string;
  restaurant: { name: string; slug: string };
};

export function OperatorDashboard() {
  const [tab, setTab] = useState<Tab>("restaurants");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [restFilter, setRestFilter] = useState<RestFilter>("all");
  const [reports, setReports] = useState<Report[]>([]);
  const [orderBucket, setOrderBucket] = useState<OrderBucket>("live");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await fetch("/api/admin/overview");
    if (res.ok) setOverview(await res.json());
  }, []);

  const loadListings = useCallback(async () => {
    const res = await fetch("/api/admin/listings");
    if (res.ok) {
      const data = await res.json();
      setListings(data.listings ?? []);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadListings();
  }, [loadOverview, loadListings]);

  useEffect(() => {
    if (tab === "reviews") {
      fetch("/api/admin/reviews/reports")
        .then((r) => r.json())
        .then((d) => setReports(d.reports ?? []));
    }
    if (tab === "orders") {
      fetch(`/api/admin/orders?bucket=${orderBucket}`)
        .then((r) => r.json())
        .then((d) => setOrders(d.orders ?? []));
    }
  }, [tab, orderBucket]);

  async function act(slug: string, patch: Record<string, unknown>) {
    setBusy(slug);
    await fetch("/api/admin/listings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, ...patch }),
    });
    await loadListings();
    await loadOverview();
    setBusy(null);
  }

  const filtered = listings.filter((l) => {
    if (restFilter === "pending")
      return ["pending_review", "draft"].includes(l.marketplaceStatus);
    if (restFilter === "active")
      return l.isListed && l.marketplaceStatus === "live";
    if (restFilter === "suspended") return l.marketplaceStatus === "suspended";
    return true;
  });

  return (
    <div>
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Restaurants" value={overview.restaurants.total} sub={`${overview.restaurants.live} live`} />
          <Kpi label="Pending" value={overview.restaurants.pending} tone="amber" />
          <Kpi label="Live orders" value={overview.orders.live} />
          <Kpi label="Reports" value={overview.reviews.reports} tone="rose" />
        </div>
      )}

      <div className="mt-6 flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-sm">
        {(["restaurants", "reviews", "orders"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-3 py-2 font-semibold capitalize transition-colors ${
              tab === t ? "bg-ink-800 text-white" : "text-white/45 hover:text-white/65"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "restaurants" && (
        <section className="mt-5">
          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "active", "suspended"] as RestFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setRestFilter(f)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  restFilter === f
                    ? "border-ember-500/40 bg-ember-500 text-ink-950"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {filtered.map((l) => (
              <article
                key={l.restaurantId}
                className="rounded-2xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/marketplace/${l.slug}`}
                      className="font-semibold text-white hover:text-ember-400"
                    >
                      {l.name}
                    </Link>
                    <p className="text-xs text-white/45">
                      {l.cuisine} · {l.marketplaceStatus.replace("_", " ")}
                      {l.isFeatured ? " · featured" : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      l.isListed && l.marketplaceStatus === "live"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : l.marketplaceStatus === "suspended"
                          ? "bg-rose-500/10 text-rose-400"
                          : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {l.isListed && l.marketplaceStatus === "live"
                      ? "Active"
                      : l.marketplaceStatus.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Act
                    label="Approve"
                    disabled={busy === l.slug}
                    onClick={() =>
                      act(l.slug, { isListed: true, marketplaceStatus: "live" })
                    }
                  />
                  <Act
                    label="Reject"
                    disabled={busy === l.slug}
                    onClick={() =>
                      act(l.slug, { isListed: false, marketplaceStatus: "draft" })
                    }
                  />
                  <Act
                    label="Suspend"
                    disabled={busy === l.slug}
                    onClick={() =>
                      act(l.slug, {
                        isListed: false,
                        marketplaceStatus: "suspended",
                      })
                    }
                  />
                  <Act
                    label={l.isFeatured ? "Unfeature" : "Feature"}
                    disabled={busy === l.slug}
                    onClick={() => act(l.slug, { isFeatured: !l.isFeatured })}
                  />
                  <Act
                    label={l.isListed ? "Hide" : "Show"}
                    disabled={busy === l.slug}
                    onClick={() => act(l.slug, { isListed: !l.isListed })}
                  />
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 bg-ink-850 p-8 text-center text-sm text-white/45">
                No restaurants in this bucket.
              </p>
            )}
          </div>
        </section>
      )}

      {tab === "reviews" && (
        <section className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white/80">Reported reviews</h2>
            <Link
              href="/admin/reviews"
              className="text-sm font-semibold text-ember-400 hover:text-ember-300 hover:underline"
            >
              Full moderation →
            </Link>
          </div>
          {reports.length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/10 bg-ink-850 p-8 text-center text-sm text-white/45">
              No reports.
            </p>
          )}
          {reports.map((r) => (
            <article
              key={r.id}
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"
            >
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-semibold text-white">{r.review.restaurant.name}</span>
                <span className="text-xs text-white/35">{shortDate(r.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs font-semibold uppercase text-amber-400">
                {r.reason}
              </p>
              <p className="mt-1 text-sm text-white/70">
                ★{r.review.rating} {r.review.author}: {r.review.comment}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={async () => {
                    await fetch(`/api/admin/reviews/${r.review.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ moderationStatus: "hidden" }),
                    });
                    setReports((prev) => prev.filter((x) => x.id !== r.id));
                    loadOverview();
                  }}
                  className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-700"
                >
                  Hide review
                </button>
                <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/45">
                  Status: {r.review.moderationStatus}
                </span>
              </div>
            </article>
          ))}
          <p className="text-xs text-white/35">
            Restaurant responses are managed in full moderation.
          </p>
        </section>
      )}

      {tab === "orders" && (
        <section className="mt-5">
          <div className="flex flex-wrap gap-2">
            {(["live", "completed", "cancelled"] as OrderBucket[]).map((b) => (
              <button
                key={b}
                onClick={() => setOrderBucket(b)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  orderBucket === b
                    ? "border-ember-500/40 bg-ember-500 text-ink-950"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {b === "live" ? "Live marketplace orders" : `${b} orders`}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {orders.map((o) => (
              <Link
                key={o.reference}
                href={`/orders/${o.reference}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-white">{o.restaurant.name}</p>
                  <p className="text-xs text-white/45">
                    {o.reference} · {o.customerName} · {shortDate(o.placedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-white">{currency(o.total)}</p>
                  <p className="text-xs text-white/45">{statusLabel(o.status)}</p>
                </div>
              </Link>
            ))}
            {orders.length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 bg-ink-850 p-8 text-center text-sm text-white/45">
                No {orderBucket} orders.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "amber" | "rose";
}) {
  const color =
    tone === "amber"
      ? "text-amber-400"
      : tone === "rose"
        ? "text-rose-400"
        : "text-white";
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-850 p-3">
      <p className="text-xs text-white/35">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/35">{sub}</p>}
    </div>
  );
}

function Act({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/70 transition-colors hover:border-ember-500/40 hover:text-ember-400 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
