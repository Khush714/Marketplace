import Link from "next/link";
import { getAllListings } from "@/lib/data";
import { PendingReviewCard } from "@/components/admin/PendingReviewCard";

export const dynamic = "force-dynamic";

type PendingType = {
  name: string;
  slug: string;
  cuisine: string;
  address: string | null;
  description: string | null;
  menuUrl: string | null;
};

export default async function MarketplaceOnboardingIndex() {
  const listings = await getAllListings();
  const pending = listings.filter(
    (l) => l.marketplaceStatus === "pending_review",
  );

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
          Restaurants can publish themselves from the public{" "}
          <Link
            href="/list-your-restaurant"
            className="text-orange-600 underline"
          >
            List your restaurant
          </Link>{" "}
          page. New submissions land here as{" "}
          <em>pending review</em> until an operator approves them.
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

      {/* Pending review */}
      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-amber-600">
          Pending approval{" "}
          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            {pending.length}
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
            No restaurants awaiting approval.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {pending.map((l) => (
              <PendingReviewCard
                key={l.restaurantId}
                name={l.name}
                slug={l.slug}
                cuisine={l.cuisine}
                address={l.address ?? ""}
                description={l.description ?? ""}
                menuUrl={l.menuUrl ?? ""}
              />
            ))}
          </div>
        )}
      </section>

      {/* All restaurants */}
      <h2 className="mt-10 text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
        All restaurants
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
