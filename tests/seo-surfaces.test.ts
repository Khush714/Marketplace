/**
 * Crawl-policy regression tests.
 *
 * Run with: npm test
 *
 * `src/lib/seo.ts` holds the disallow list and the public route list, and
 * `robots.ts` / `sitemap.ts` both read it. That centralisation is the point —
 * and its failure mode is drift: someone adds `/gift-cards` or a new console
 * route and neither the disallow list nor the sitemap learns about it. These
 * tests walk `src/app` so the policy is checked against what is actually on
 * disk rather than against a list someone remembered to update.
 *
 * `lib/seo.ts` is importable here because it deliberately has no `server-only`
 * and no DB import. Anything reaching `db/queries.ts` or `discoverability.ts`
 * throws under plain node — `server-only` resolves to its throwing entrypoint
 * outside a React Server Component graph.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { appOrigin } from "../src/lib/app-url";
import { isPrivateRoute, PRIVATE_ROUTE_PREFIXES, PUBLIC_ROUTES } from "../src/lib/seo";
import { LEGAL_ROUTES } from "../src/lib/site-legal";

const APP_DIR = join(process.cwd(), "src", "app");

/** Every routable page under src/app, as a leading-slash path. Excludes route groups. */
function pageRoutes(dir = APP_DIR, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `(group)` folders are organisational only and produce no URL segment.
      if (entry.startsWith("(") && entry.endsWith(")")) continue;
      out.push(...pageRoutes(full, `${prefix}/${entry}`));
      continue;
    }
    if (entry === "page.tsx" || entry === "page.tsxx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

const ROUTES = pageRoutes();

/**
 * True when the route declares `robots` in a metadata export.
 *
 * Checks `layout.tsx` as well as `page.tsx`, and counts a match in EITHER file.
 * Layouts are not an alternative to the page here, they are the only option for
 * the client-component routes: `/cart`, `/checkout`, `/orders`, `/profile` and
 * the `/partner*` consoles are all `"use client"`, and Next.js rejects a
 * `metadata` export from a client module outright ("You are attempting to
 * export \"metadata\" from a component marked with \"use client\""). So the
 * noindex declaration for those routes lives in a colocated layout.
 *
 * Matching either file is sound for the policy being tested: Next.js merges a
 * page's metadata over its layout's, so a page that overrides `robots` is the
 * one that wins, and a route declaring it in both files has not lost it.
 *
 * The pattern accepts two spellings, because both appear in this codebase and
 * neither is wrong. `robots: NOINDEX.robots` sets the field directly, while
 * `...NOINDEX` spreads the same constant in. A test that only matched the first
 * would report every spread-based route as unprotected.
 */
function declaresRobots(path: string): boolean {
  const dir = join(APP_DIR, path === "/" ? "" : path);
  const pattern = /export const metadata[\s\S]{0,400}?(robots\s*:|\.\.\.NOINDEX)/;
  for (const file of ["page.tsx", "layout.tsx"]) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    if (pattern.test(readFileSync(full, "utf8"))) return true;
  }
  return false;
}

test("the route directory is discovered, not hardcoded", () => {
  // If this fails, pageRoutes() is broken and every assertion below is vacuous.
  assert.ok(ROUTES.includes("/"), "root page not found");
  assert.ok(ROUTES.includes("/restaurants"), "/restaurants not found");
  assert.ok(ROUTES.includes("/restaurants/[slug]"), "listing page not found");
  assert.ok(ROUTES.length > 10, `expected the full route tree, saw ${ROUTES.length}`);
});

/**
 * Dynamic segments stand for every URL beneath them, so a concrete route such
 * as `/restaurants/xyz` is classified by its pattern, not its literal path.
 */
function asPolicyPath(route: string): string {
  return route.replace(/\/\[[^\]]+\]$/, (m) => (m.includes("[...]") ? "" : "/"));
}

/**
 * Listing pages are indexed, but not one static entry per slug — the sitemap
 * builds them from the DB at request time.
 */
function isListingRoute(route: string): boolean {
  return route.startsWith("/restaurants/[");
}

test("every route is either public, a listing, or disallowed", () => {
  // Widened to string: `as const` makes `path` a literal union, and ROUTES is
  // plain string[] from the filesystem walk.
  const publicPaths = new Set<string>(PUBLIC_ROUTES.map((r) => r.path));
  const unclassified = ROUTES.filter((route) => {
    if (isListingRoute(route)) return false;
    if (isPrivateRoute(asPolicyPath(route))) return false;
    return !publicPaths.has(route);
  });
  assert.deepEqual(
    unclassified.sort(),
    [],
    `routes that are neither public nor disallowed: ${unclassified.join(", ")}. Add to PUBLIC_ROUTES or PRIVATE_ROUTE_PREFIXES in src/lib/seo.ts.`,
  );
});

test("every private route declares noindex metadata", () => {
  // robots.txt is advisory. A crawler that ignores `Disallow` still renders the
  // page, so the per-route `robots` export is what actually keeps /ops, /partner
  // and the order surfaces out of the index.
  //
  // A `"use client"` page cannot export metadata, so those routes carry it on a
  // sibling `layout.tsx` — `declaresRobots` reads both for that reason.
  const missing = ROUTES.filter((route) => isPrivateRoute(route) && !declaresRobots(route));
  assert.deepEqual(
    missing.sort(),
    [],
    `private routes with no robots metadata: ${missing.join(", ")}. Add \`export const metadata = { ...NOINDEX }\` to the page or its layout.`,
  );
});

test("noindex is reachable via the shared NOINDEX constant, not a copy-pasted literal", () => {
  // The layouts spread NOINDEX. A hand-typed `{ robots: { index: false, follow:
  // false } }` compiles, lints and passes declaresRobots while drifting from
  // lib/seo.ts — this asserts the constant is actually referenced.
  for (const route of ROUTES.filter((r) => isPrivateRoute(r))) {
    const dir = join(APP_DIR, route === "/" ? "" : route);
    let referenced = false;
    for (const file of ["layout.tsx", "page.tsx"]) {
      const full = join(dir, file);
      if (!existsSync(full)) continue;
      const source = readFileSync(full, "utf8");
      if (!/export const metadata[\s\S]{0,400}?(robots\s*:|\.\.\.NOINDEX)/.test(source)) continue;
      referenced = source.includes("NOINDEX");
      if (referenced) break;
    }
    assert.ok(referenced, `${route} declares robots metadata without importing NOINDEX from @/lib/seo`);
  }
});

test("appOrigin is used for every absolute URL surface", () => {
  // The three consumers must agree on origin. Reading the env var directly in
  // one of them is how canonicals, robots and the sitemap start pointing at
  // different hosts, which invalidates the sitemap wholesale.
  for (const file of ["src/app/sitemap.ts", "src/app/robots.ts", "src/app/layout.tsx"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.ok(
      source.includes("appOrigin"),
      `${file} does not use appOrigin() — absolute URLs will drift`,
    );
    assert.ok(
      !/process\.env\.NEXT_PUBLIC_APP_URL/.test(source),
      `${file} reads NEXT_PUBLIC_APP_URL directly instead of calling appOrigin()`,
    );
  }
});

test("no public route is disallowed", () => {
  // The inverse failure: an over-broad prefix (e.g. "/restaurants" instead of
  // "/restaurants/[slug]") silently removes listings from crawling.
  for (const route of PUBLIC_ROUTES) {
    assert.ok(
      !isPrivateRoute(route.path),
      `${route.path} is in PUBLIC_ROUTES but is matched by the disallow list`,
    );
  }
});

test("public routes point at pages that exist", () => {
  for (const route of PUBLIC_ROUTES) {
    assert.ok(
      ROUTES.includes(route.path),
      `${route.path} is in PUBLIC_ROUTES but has no page.tsx — a dead sitemap entry`,
    );
  }
});

test("every legal policy route is in the sitemap", () => {
  // site-legal.ts is the single source of truth for these paths; if a policy
  // moves, the sitemap follows rather than going stale.
  const listed = new Set(PUBLIC_ROUTES.map((r) => r.path));
  for (const path of Object.values(LEGAL_ROUTES)) {
    assert.ok(listed.has(path), `${path} is a legal policy route but is missing from PUBLIC_ROUTES`);
  }
});

test("private prefixes cover their own nested routes", () => {
  // The bug this pins: a bare-path comparison would let /order/ABC/track and
  // /api/ops/queue-health through, since neither equals "/order" or "/api".
  assert.ok(isPrivateRoute("/order/abc123/track"));
  assert.ok(isPrivateRoute("/api/ops/queue-health"));
  assert.ok(isPrivateRoute("/partner/menu"));
  assert.ok(isPrivateRoute("/cart"));
  assert.ok(!isPrivateRoute("/restaurants"));
  assert.ok(!isPrivateRoute("/restaurants/biryani-blues"));
  assert.ok(!isPrivateRoute("/contact"));
});

test("the disallow list uses trailing slashes only on real directories", () => {
  // "/api/" and "/order/" are prefixes; the rest are single routes. A prefix
  // written without the slash would also match a sibling like "/orderly".
  for (const prefix of PRIVATE_ROUTE_PREFIXES) {
    if (prefix.endsWith("/")) {
      assert.ok(prefix.length > 1, `bare "/" in the disallow list would block the whole site`);
    }
  }
  assert.deepEqual(
    [...PRIVATE_ROUTE_PREFIXES].filter((p) => p.endsWith("/")).sort(),
    ["/api/", "/order/"],
  );
});

test("appOrigin falls back to localhost rather than inventing a hostname", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  try {
    assert.equal(appOrigin(), "http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_URL = "https://crave.example";
    assert.equal(appOrigin(), "https://crave.example");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});

test("appOrigin strips trailing slashes so concatenated URLs stay canonical", () => {
  // "https://host/" + "/sitemap.xml" is "https://host//sitemap.xml" — a
  // different URL to Google, and enough to make a sitemap look malformed.
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://crave.example/";
    assert.equal(appOrigin(), "https://crave.example");
    assert.equal(`${appOrigin()}/sitemap.xml`, "https://crave.example/sitemap.xml");

    process.env.NEXT_PUBLIC_APP_URL = "https://crave.example///";
    assert.equal(appOrigin(), "https://crave.example");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});

test("an empty or blank NEXT_PUBLIC_APP_URL falls back rather than yielding ''", () => {
  // "" is truthy-false but not undefined, so a `??` alone would return an empty
  // origin and every sitemap <loc> would be a bare path.
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "";
    assert.equal(appOrigin(), "http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    assert.equal(appOrigin(), "http://localhost:3000");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});