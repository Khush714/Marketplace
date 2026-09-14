"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddRestaurantForm } from "./AddRestaurantForm";
import { ConnectionBadge } from "./ConnectionBadge";
import { ConnectRestaurantDialog } from "./ConnectRestaurantDialog";

export type AdminRestaurant = {
  id: number;
  name: string;
  slug: string;
  marketplaceId: string;
  cuisine: string;
  address: string;
  phone: string;
  openingHours: string;
  imageUrl: string;
  logoUrl: string;
  deliveryRadiusKm: number;
  isOpen: boolean;
  isListed: boolean;
  marketplaceStatus: string;
  integrationProvider: string;
  integrationStatus: string;
  createdAt: string;
};

const STATUS_STYLES: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25",
  draft: "bg-white/5 text-white/40 ring-white/10",
  pending_review: "bg-amber-500/15 text-amber-400 ring-amber-500/25",
  suspended: "bg-rose-500/15 text-rose-400 ring-rose-500/25",
};

export function RestaurantList({
  initialRestaurants,
}: {
  initialRestaurants: AdminRestaurant[];
}) {
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [showAdd, setShowAdd] = useState(false);
  const [connecting, setConnecting] = useState<AdminRestaurant | null>(null);
  const router = useRouter();

  function handleAdded(newRestaurant: AdminRestaurant) {
    setRestaurants((prev) => [...prev, newRestaurant]);
    setShowAdd(false);
  }

  function handleStatusChange(r: AdminRestaurant, status: string) {
    setRestaurants((prev) =>
      prev.map((item) =>
        item.id === r.id ? { ...item, integrationStatus: status } : item,
      ),
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/40">
          {restaurants.length} restaurant{restaurants.length !== 1 && "s"}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-2xl bg-ember-500 px-5 py-2.5 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
        >
          + Add Restaurant
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        {restaurants.length === 0 && (
          <div className="rounded-2xl border border-white/8 bg-ink-850 p-12 text-center">
            <p className="text-white/40">No restaurants yet</p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 text-sm font-semibold text-ember-400 hover:text-ember-300"
            >
              Add your first restaurant
            </button>
          </div>
        )}

        {restaurants.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-4 rounded-2xl border border-white/8 bg-ink-850 p-4 transition-colors hover:bg-ink-800"
          >
            {/* Logo / Image */}
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5">
              {r.logoUrl || r.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.logoUrl || r.imageUrl}
                  alt={r.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white/20">
                  {r.name.charAt(0)}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-white">
                  {r.name}
                </h3>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLES[r.marketplaceStatus] || STATUS_STYLES.draft}`}
                >
                  {r.marketplaceStatus === "live" ? "Active" : r.marketplaceStatus === "pending_review" ? "Pending" : r.marketplaceStatus === "suspended" ? "Suspended" : "Draft"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-white/35">
                {r.cuisine && `${r.cuisine} · `}
                Marketplace ID: {r.marketplaceId}
              </p>
            </div>

            {/* Connection status (Phase 4) */}
            <ConnectionBadge
              provider={r.integrationProvider}
              status={r.integrationStatus}
            />

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-2">
              {r.integrationStatus === "disconnected" && (
                <button
                  onClick={() => setConnecting(r)}
                  className="shrink-0 rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-1.5 text-xs font-semibold text-ember-400 transition hover:bg-ember-500/20"
                >
                  Connect
                </button>
              )}
              <a
                href={`/admin/marketplace/${r.slug}`}
                className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
              >
                Manage
              </a>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddRestaurantForm
          onAdded={handleAdded}
          onClose={() => setShowAdd(false)}
        />
      )}

      {connecting && (
        <ConnectRestaurantDialog
          restaurantDbId={connecting.id}
          restaurantName={connecting.name}
          marketplaceId={connecting.marketplaceId}
          currentStatus={connecting.integrationStatus}
          onClose={() => setConnecting(null)}
          onStatusChange={(s) => handleStatusChange(connecting, s)}
        />
      )}
    </>
  );
}
