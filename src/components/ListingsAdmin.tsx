"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ListingRow } from "@/lib/data";
import { currency } from "@/lib/format";

const STATUSES = ["draft", "pending_review", "live", "suspended"] as const;

const statusStyle: Record<string, string> = {
  draft: "bg-white/5 text-white/60",
  pending_review: "bg-amber-500/10 text-amber-400",
  live: "bg-emerald-500/10 text-emerald-400",
  suspended: "bg-rose-500/10 text-rose-400",
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
            className={`rounded-2xl border bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition ${
              busy === l.slug ? "opacity-60" : ""
            } ${live ? "border-emerald-500/25" : "border-white/8"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{l.name}</h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[l.marketplaceStatus]}`}
                  >
                    {l.marketplaceStatus.replace("_", " ")}
                  </span>
                  {l.isFeatured && (
                    <span className="rounded-full bg-ember-500/10 px-2.5 py-0.5 text-xs font-semibold text-ember-400">
                      featured
                    </span>
                  )}
                  {l.hasOverride && (
                    <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-400">
                      overrides POS
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-white/45">
                  {l.cuisine} · {currency(l.deliveryFee)} delivery · min{" "}
                  {currency(l.minOrder)} · {l.etaMinutes} min ·{" "}
                  {l.commissionRate}% commission
                </p>
              </div>
              {live ? (
                <Link
                  href={`/restaurant/${l.slug}`}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10"
                >
                  View storefront →
                </Link>
              ) : (
                <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/45">
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
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 outline-none transition-colors focus:border-ember-500/50 sm:ml-auto [&>option]:bg-ink-900"
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
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-white/10 bg-white/5 text-white/35"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-white/15"}`}
      />
      {label}
    </button>
  );
}
