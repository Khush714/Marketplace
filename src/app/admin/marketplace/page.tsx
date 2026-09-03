import Link from "next/link";
import { getAllListings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MarketplaceOnboardingIndex() {
  const listings = await getAllListings();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 4 · onboarding
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Restaurant marketplace onboarding
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Restaurant admins publish themselves to the consumer platform. Enabling{" "}
          <em>List my restaurant</em> sets{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            is_listed = true
          </code>{" "}
          and makes the restaurant immediately eligible for ordering.
        </p>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/admin/pos"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-orange-300 hover:text-orange-600"
        >
          🖥️ POS bridge
        </Link>
        <Link
          href="/admin/reviews"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-orange-300 hover:text-orange-600"
        >
          ⭐ Review moderation
        </Link>
      </nav>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {listings.map((l) => (
          <Link
            key={l.restaurantId}
            href={`/admin/marketplace/${l.slug}`}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
          >
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{l.name}</h3>
                {l.isListed && l.marketplaceStatus === "live" ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    live
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                    {l.marketplaceStatus.replace("_", " ")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {l.cuisine} ·{" "}
                {l.acceptDelivery && l.acceptPickup
                  ? "delivery + pickup"
                  : l.acceptDelivery
                    ? "delivery"
                    : l.acceptPickup
                      ? "pickup"
                      : "no fulfilment"}
              </p>
            </div>
            <span className="text-sm font-medium text-orange-600">Manage →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
