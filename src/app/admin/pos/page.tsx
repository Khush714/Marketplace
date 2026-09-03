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
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 12
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">POS bridge</h1>
        <p className="mt-1 text-slate-500">
          Connect each restaurant&apos;s point-of-sale system to receive and
          act on marketplace orders. The restaurant never re-keys a thing.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Restaurants
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{r.name}</p>
                <p className="text-xs text-slate-500">{r.orderCount} orders</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    r.hasKey
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {r.hasKey ? "Key ready" : "Not connected"}
                </span>
                <Link
                  href={`/admin/pos/${r.slug}`}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
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
