import { LEGAL_ROUTES } from "@/lib/site-legal";

/**
 * Crawl policy, as data.
 *
 * These two lists are the single source of truth for which URLs the marketplace
 * invites a crawler to index. `/robots.ts` and `/sitemap.ts` both read them,
 * and `tests/seo-surfaces.test.ts` walks the route directory to assert they
 * still agree with what is actually on disk.
 *
 * They live here, in a module with no `server-only` and no DB import, precisely
 * so that test can load them: anything importing `db/queries.ts` or
 * `discoverability.ts` throws under plain node, because `server-only` resolves
 * to its throwing entrypoint outside a React Server Component graph.
 */

/**
 * Routes with no meaningful public URL. Everything else in `src/app` is either
 * public or listed below.
 *
 * `follow: false` is deliberate on the noindex side: a cart linking out to a
 * restaurant page should not hand that page its own crawl credit, and these
 * pages are per-visitor surfaces anyway.
 */
export const PRIVATE_ROUTE_PREFIXES = [
  "/api/",
  "/cart",
  "/checkout",
  "/orders",
  "/order/",
  "/ops",
  "/partner",
  "/profile",
] as const;

/**
 * Public pages worth indexing, in sitemap priority order.
 *
 * `changeFrequency` and `priority` are hints Google explicitly says it
 * ignores for indexing decisions; they are set because they are cheap and
 * because a sitemap of bare URLs is a worse artefact for a human reading it
 * during an incident. The listing entries in `sitemap.ts` are the ones that
 * actually move the needle.
 */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/restaurants", priority: 0.9, changeFrequency: "daily" },
  { path: LEGAL_ROUTES.contact, priority: 0.5, changeFrequency: "monthly" },
  { path: LEGAL_ROUTES.terms, priority: 0.3, changeFrequency: "yearly" },
  { path: LEGAL_ROUTES.privacy, priority: 0.3, changeFrequency: "yearly" },
  { path: LEGAL_ROUTES.refunds, priority: 0.4, changeFrequency: "monthly" },
] as const;

/**
 * `metadata.robots` for a per-visitor page.
 *
 * `follow: false` is deliberate: these pages link out to restaurant listings,
 * and a crawler that follows those links from a cart or an order-tracking page
 * has indexed the listing via a URL the customer later sees. Google also
 * requires `noindex` to be crawlable to be honoured at all, which is why these
 * routes are `Allow`ed-but-excluded by policy in robots.ts rather than simply
 * `Disallow`ed: a `Disallow`ed `noindex` is silently ignored.
 */
export const NOINDEX = { robots: { index: false, follow: false } } as const;

/**
 * True when a path is covered by the disallow list.
 *
 * Deliberately prefix-based: `/cart` also covers `/cart/anything`, and
 * `/order/` covers the token-gated `/order/[code]/success`. A bare-path
 * comparison would let every nested route under a private prefix leak through,
 * which is the exact bug this guards.
 */
export function isPrivateRoute(path: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}