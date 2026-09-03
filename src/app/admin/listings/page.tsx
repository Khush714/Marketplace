import { getAllListings } from "@/lib/data";
import { ListingsAdmin } from "@/components/ListingsAdmin";

export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const listings = await getAllListings();
  const live = listings.filter(
    (l) => l.isListed && l.marketplaceStatus === "live",
  ).length;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 2 · marketplace profiles
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Listing control
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Every restaurant below exists in the POS. The{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            restaurant_marketplace_profiles
          </code>{" "}
          row decides whether it is visible on the storefront and how it can be
          ordered from — the POS record itself is never modified.
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <span>
            <strong className="text-lg">{listings.length}</strong>{" "}
            <span className="text-slate-500">in POS</span>
          </span>
          <span>
            <strong className="text-lg text-emerald-600">{live}</strong>{" "}
            <span className="text-slate-500">live on marketplace</span>
          </span>
          <span>
            <strong className="text-lg text-amber-600">
              {listings.length - live}
            </strong>{" "}
            <span className="text-slate-500">hidden</span>
          </span>
        </div>
      </div>

      <div className="mt-8">
        <ListingsAdmin listings={listings} />
      </div>
    </main>
  );
}
