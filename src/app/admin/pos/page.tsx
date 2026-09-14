import Link from "next/link";
import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { count, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "POS Bridge" };

export default async function PosIndexPage() {
  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      hasKey: sql<boolean>`(${marketplaceProfiles.posKeyHash} <> '')`,
      orderCount: count(restaurants.id).mapWith(Number),
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .groupBy(restaurants.id, marketplaceProfiles.posKeyHash)
    .orderBy(desc(restaurants.name));

  return (
    <main className="mx-auto max-w-4xl px-4 pb-12 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 12
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">POS bridge</h1>
        <p className="mt-1 text-white/45">
          Connect each restaurant&apos;s point-of-sale system to receive and
          act on marketplace orders. The restaurant never re-keys a thing.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/8 bg-ink-850">
        <div className="border-b border-white/6 bg-white/5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/40">
          Restaurants
        </div>
        <ul className="divide-y divide-white/6">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-white">{r.name}</p>
                <p className="text-xs text-white/45">{r.orderCount} orders</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    r.hasKey
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-white/5 text-white/45"
                  }`}
                >
                  {r.hasKey ? "Key ready" : "Not connected"}
                </span>
                <Link
                  href={`/admin/pos/${r.slug}`}
                  className="w-full rounded-2xl bg-ember-500 px-4 py-2 text-center text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] sm:w-auto"
                >
                  Open POS
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
