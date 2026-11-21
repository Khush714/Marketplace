import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/app-url";
import { PUBLIC_ROUTES } from "@/lib/seo";

/**
 * `/sitemap.xml` — the canonical inventory of indexable URLs.
 *
 * Two things here are load-bearing:
 *
 * 1. `revalidate`. A `sitemap.ts` route handler is CACHED BY DEFAULT. Without an
 *    explicit revalidation window the listing set is frozen at build time, so a
 *    restaurant onboarded tomorrow never appears until the next deploy — and
 *    because stale sitemaps get ignored wholesale after a while, the whole file
 *    degrades, not just the missing row. One hour is well inside Google's
 *    crawl-rate expectations and cheap: this is two indexed columns.
 *
 * 2. The `catch`. A build without a reachable `DATABASE_URL` must not fail. The
 *    static routes are still correct and useful on their own, and an empty
 *    `urlset` would be worse than a partial one. Swallowing the error here is
 *    safe precisely because the failure is visible: `/sitemap.xml` loses its
 *    listing rows and Search Console reports reduced URLs fetched.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = appOrigin();

  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((route) => ({
    url: `${origin}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const listings = await discoverableRestaurantSlugs()
    .then((rows) =>
      rows.map((row) => ({
        url: `${origin}/restaurants/${row.slug}`,
        // `createdAt`, not a fresh `new Date()`. Google ignores an inaccurate
        // `lastModified` and treating it as false freshness is the one thing a
        // sitemap must not do.
        lastModified: row.createdAt,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    )
    .catch((err: unknown) => {
      console.error(
        "[sitemap] listing query failed; emitting static routes only",
        err instanceof Error ? err.message : err,
      );
      return [];
    });

  return [...staticRoutes, ...listings];
}

/**
 * Imported lazily so `db/index.ts` — which throws at module scope when
 * `DATABASE_URL` is unset (`src/db/index.ts:6`) — is not evaluated for a build
 * that has no database at all. A static import would fail the whole build, which
 * is the exact failure the `catch` above is there to avoid.
 */
async function discoverableRestaurantSlugs() {
  const { discoverableRestaurantSlugs: query } = await import("@/db/queries");
  return query();
}