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
  qrImageUrl?: string | null;
};

export default async function MarketplaceOnboardingIndex() {
  const listings = await getAllListings();
  const pending = listings.filter(
    (l) => l.marketplaceStatus === "pending_review",
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 4 · onboarding
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
          Restaurant marketplace onboarding
        </h1>
        <p className="mt-2 max-w-2xl text-white/45">
          Restaurants can publish themselves from the public{" "}
          <Link
            href="/list-your-restaurant"
            className="text-ember-400 hover:text-ember-300 hover:underline"
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
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:border-ember-500/40 hover:text-ember-400"
        >
          🖥️ POS bridge
        </Link>
        <Link
          href="/admin/reviews"
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:border-ember-500/40 hover:text-ember-400"
        >
          ⭐ Review moderation
        </Link>
      </nav>

      {/* Pending review */}
      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-amber-400">
          Pending approval{" "}
          <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
            {pending.length}
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-white/10 bg-ink-850 p-6 text-center text-sm text-white/35">
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
                qrImageUrl={l.qrImageUrl ?? ""}
              />
            ))}
          </div>
        )}
      </section>

      {/* All restaurants */}
      <h2 className="mt-10 text-sm font-bold uppercase tracking-[0.12em] text-white/40">
        All restaurants
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {listings.map((l) => (
          <Link
            key={l.restaurantId}
            href={`/admin/marketplace/${l.slug}`}
            className="card-lift flex items-center justify-between rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-all hover:border-ember-500/40"
          >
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{l.name}</h3>
                {l.isListed && l.marketplaceStatus === "live" ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    live
                  </span>
                ) : (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-semibold text-white/45">
                    {l.marketplaceStatus.replace("_", " ")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-white/45">
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
            <span className="text-sm font-semibold text-ember-400">Manage →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
