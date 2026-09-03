"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ListingRow } from "@/lib/data";
import { currency } from "@/lib/format";

const STATUSES = ["draft", "pending_review", "live", "suspended"] as const;

const statusStyle: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_review: "bg-amber-100 text-amber-700",
  live: "bg-emerald-100 text-emerald-700",
  suspended: "bg-rose-100 text-rose-700",
};

export function ListingsAdmin({ listings }: { listings: ListingRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(slug: string, body: Record<string, unknown>) {
    setBusy(slug);
    try {
      await fetch("/api/admin/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...body }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {listings.map((l) => {
        const live = l.isListed && l.marketplaceStatus === "live";
        return (
          <div
            key={l.restaurantId}
            className={`rounded-2xl border bg-white p-5 shadow-sm transition ${
              busy === l.slug ? "opacity-60" : ""
            } ${live ? "border-emerald-200" : "border-slate-200"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{l.name}</h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[l.marketplaceStatus]}`}
                  >
                    {l.marketplaceStatus.replace("_", " ")}
                  </span>
                  {l.isFeatured && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                      featured
                    </span>
                  )}
                  {l.hasOverride && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                      overrides POS
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {l.cuisine} · {currency(l.deliveryFee)} delivery · min{" "}
                  {currency(l.minOrder)} · {l.etaMinutes} min ·{" "}
                  {l.commissionRate}% commission
                </p>
              </div>
              {live ? (
                <Link
                  href={`/restaurant/${l.slug}`}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  View storefront →
                </Link>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
                  Hidden from storefront
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Toggle
                label="Listed"
                on={l.isListed}
                onClick={() => patch(l.slug, { isListed: !l.isListed })}
              />
              <Toggle
                label="Online orders"
                on={l.acceptOnlineOrders}
                onClick={() =>
                  patch(l.slug, { acceptOnlineOrders: !l.acceptOnlineOrders })
                }
              />
              <Toggle
                label="Delivery"
                on={l.acceptDelivery}
                onClick={() => patch(l.slug, { acceptDelivery: !l.acceptDelivery })}
              />
              <Toggle
                label="Pickup"
                on={l.acceptPickup}
                onClick={() => patch(l.slug, { acceptPickup: !l.acceptPickup })}
              />
              <Toggle
                label="Featured"
                on={l.isFeatured}
                onClick={() => patch(l.slug, { isFeatured: !l.isFeatured })}
              />

              <select
                value={l.marketplaceStatus}
                onChange={(e) =>
                  patch(l.slug, { marketplaceStatus: e.target.value })
                }
                className="ml-auto rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-orange-400"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        on
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-slate-400"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`}
      />
      {label}
    </button>
  );
}
