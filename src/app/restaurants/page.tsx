import { Suspense } from "react";
import type { Metadata } from "next";
import {
  listPublicRestaurants,
  listCategories,
  type SortKey,
} from "@/lib/marketplace";
import { RestaurantBrowser } from "@/components/RestaurantBrowser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Restaurants" };

const VALID: SortKey[] = ["recommended", "rating", "popular", "nearby", "name"];

export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cuisine?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const cuisine = sp.cuisine ?? "all";
  const sort: SortKey = VALID.includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : "recommended";

  const [{ items, total }, categories] = await Promise.all([
    listPublicRestaurants({
      search: q || undefined,
      cuisine: cuisine !== "all" ? cuisine : undefined,
      sort,
      minRating: sort === "rating" ? 4 : undefined,
      limit: 60,
    }),
    listCategories(),
  ]);

  return (
    <Suspense>
      <RestaurantBrowser
        initialItems={items}
        initialTotal={total}
        cuisines={categories.map((c) => c.cuisine)}
        initialQuery={q}
        initialCuisine={cuisine}
        initialSort={sort}
      />
    </Suspense>
  );
}
