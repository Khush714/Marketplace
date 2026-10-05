/**
 * Tests for the request-abuse policy.
 *
 * Run with: npm test
 *
 * This covers the unauthenticated surface only: order creation, bill preview,
 * order lookup, owner-key verification, search and listing browse. Each is
 * either public by design or gated by a capability the caller already holds, so
 * the failures worth pinning are not "who can reach this" but:
 *
 *   - Amplification. `POST /api/orders` writes a row, allocates a provider
 *     order and enqueues a delivery, and nothing stops an unauthenticated caller
 *     from looping it. Same for the bill preview, which recomputes totals from
 *     the database on every call.
 *   - One big request instead of many small ones. The limiter is per-client, so
 *     a route is only actually bounded if the *request* is bounded too: body
 *     size, slug-list length, and search-term length are all caps on one query.
 *   - A rejected customer. The budgets key on client IP, which on mobile is
 *     shared by an apartment or a campus. A limit tight enough to stop a script
 *     can silently throttle a real order, so the limits are pinned here.
 *   - The limiter being the attack. The signup route charges its budget *after*
 *     the honeypot, so a bot behind a shared address cannot spend a real
 *     restaurant's three signups.
 *
 * `abuse-core.ts` is importable only because it is kept free of `server-only`,
 * the same constraint that made `cron-auth-core.ts` a separate file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ABUSE_BUDGETS,
  MINUTE_MS,
  MAX_JSON_BODY_BYTES,
  MAX_SEARCH_QUERY,
  MAX_SLUGS,
  clampSearchQuery,
  clampSlugList,
  decideOrigin,
  escapeLike,
  fallbackBucketKey,
  honeypotTripped,
} from "../src/lib/abuse-core";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/* ----------------------------- LIKE escaping ------------------------------ */

test("LIKE wildcards in a search term are escaped so the pattern means what was typed", () => {
  // The search term is interpolated into `%term%` as an ILIKE pattern. Left raw,
  // "%" matches every restaurant and "_" matches any single character — the
  // result set stops being a search and becomes a table dump.
  assert.equal(escapeLike("%"), "\\%");
  assert.equal(escapeLike("_"), "\\_");
  assert.equal(escapeLike("\\"), "\\\\");
  assert.equal(escapeLike("paneer tikka"), "paneer tikka");
  // Order matters: the backslash is escaped first, otherwise escaping it would
  // double-escape the backslashes this function just inserted.
  assert.equal(escapeLike("50%_\\"), "50\\%\\_\\\\");
});

/* ------------------------------ input clamps ------------------------------ */

test("a search term is trimmed and capped at the accepted length", () => {
  assert.equal(clampSearchQuery("  biryani  "), "biryani");
  assert.equal(clampSearchQuery("x".repeat(MAX_SEARCH_QUERY + 50)), "x".repeat(MAX_SEARCH_QUERY));
  assert.equal(clampSearchQuery(null), "");
  assert.equal(clampSearchQuery(undefined), "");
});

test("the slug list is bounded, de-duplicated and order-preserving", () => {
  // Unbounded, this array is spliced straight into inArray(...): one request
  // carrying thousands of slugs is a cheaper catalogue export than scraping.
  const many = Array.from({ length: MAX_SLUGS + 200 }, (_, i) => `rest-${i}`).join(",");
  const clamped = clampSlugList(many);
  assert.equal(clamped.length, MAX_SLUGS);
  assert.equal(clamped[0], "rest-0");

  assert.deepEqual(clampSlugList("b, a, b , ,a"), ["b", "a"]);
  assert.deepEqual(clampSlugList(""), []);
  assert.deepEqual(clampSlugList(null), []);
});

test("the search cap is far above any real dish or restaurant name", () => {
  assert.ok(MAX_SEARCH_QUERY >= 32, "real place names fit inside the cap");
  assert.ok(MAX_JSON_BODY_BYTES >= 4096, "a real order fits inside the body cap");
});

/* ------------------------------ bucket keys ------------------------------- */

test("callers with no address do not share one bucket", () => {
  // The failure this prevents: a single literal "unknown" key, so the first
  // attacker who omits x-forwarded-for spends everybody else's budget and real
  // requests start getting refused for something they did not do.
  const a = fallbackBucketKey(headers({ "user-agent": "Mozilla/5.0 (iPhone)", "accept-language": "en-IN" }));
  const b = fallbackBucketKey(headers({ "user-agent": "Mozilla/5.0 (Linux)", "accept-language": "en-GB" }));
  assert.notEqual(a, b);
  // Stable, or the caller escapes its own limit just by retrying.
  assert.equal(a, fallbackBucketKey(headers({ "user-agent": "Mozilla/5.0 (iPhone)", "accept-language": "en-IN" })));
});

test("a caller with no address and no hints still gets a usable bucket key", () => {
  assert.equal(fallbackBucketKey(headers({})), "unknown");
});

/* -------------------------------- origins --------------------------------- */

test("Sec-Fetch-Site: cross-site is refused, and a script cannot forge it", () => {
  // Browsers set this themselves on cross-site requests, so it is definitive
  // without the server needing to know its own hostname — which matters because
  // preview deployment URLs change on every deploy.
  assert.equal(decideOrigin(headers({ "sec-fetch-site": "cross-site" }), ["app.example"]), "cross-site");
  // A browser-asserted same-origin settles it without waiting for an Origin that
  // will never arrive. "none" is what a top-level navigation sends.
  assert.equal(decideOrigin(headers({ "sec-fetch-site": "same-origin" }), ["app.example"]), "same-origin");
  assert.equal(decideOrigin(headers({ "sec-fetch-site": "none" }), ["app.example"]), "same-origin");
  // "same-site" is deliberately NOT trusted as same-origin: this app has no
  // subdomains, so it falls through to the Origin comparison below.
  assert.equal(
    decideOrigin(headers({ "sec-fetch-site": "same-site", origin: "https://other.example" }), ["app.example"]),
    "cross-site",
  );
});

test("an Origin matching the request host or the configured origin is same-origin", () => {
  assert.equal(decideOrigin(headers({ origin: "https://app.example" }), ["app.example"]), "same-origin");
  // A preview deployment is not NEXT_PUBLIC_APP_URL, so the request's own Host
  // has to be accepted too or every preview build 403s its own checkout.
  assert.equal(decideOrigin(headers({ origin: "https://pr-42.vercel.app" }), ["pr-42.vercel.app"]), "same-origin");
  // Host matching is case-insensitive and ignores the scheme.
  assert.equal(decideOrigin(headers({ origin: "http://App.Example:3000" }), ["app.example:3000"]), "same-origin");
});

test("an Origin for another host is cross-site", () => {
  assert.equal(decideOrigin(headers({ origin: "https://evil.example" }), ["app.example"]), "cross-site");
  assert.equal(decideOrigin(headers({ origin: "not a url" }), ["app.example"]), "cross-site");
});

test("a caller with no browser signal is allowed through", () => {
  // curl, the POS integrations and the test suite send neither header. This
  // guard exists to stop a *browser* being used as a confused deputy; refusing
  // these would break the integrations to stop an attack they are not part of.
  // They are still subject to the rate budget.
  assert.equal(decideOrigin(headers({}), ["app.example"]), "unknown");
  assert.equal(decideOrigin(headers({ origin: "null" }), ["app.example"]), "unknown");
});

test("no allowed host means nothing can claim same-origin", () => {
  // Fails closed: with the host list empty (an unset Host on an odd runtime)
  // every browser Origin is cross-site rather than silently passing.
  assert.equal(decideOrigin(headers({ origin: "https://app.example" }), []), "cross-site");
});

/* ------------------------------- honeypot --------------------------------- */

test("the honeypot only trips on a filled field", () => {
  assert.equal(honeypotTripped({ company_url: "" }), false);
  assert.equal(honeypotTripped({ company_url: "   " }), false);
  assert.equal(honeypotTripped({}), false);
  assert.equal(honeypotTripped(null), false);
  assert.equal(honeypotTripped("string body"), false);
  assert.equal(honeypotTripped({ company_url: 42 }), false, "only a string field counts");
  assert.equal(honeypotTripped({ company_url: "https://spam.example" }), true);
});

/* -------------------------------- budgets --------------------------------- */

test("every guarded scope has a positive, bounded budget", () => {
  for (const [scope, budget] of Object.entries(ABUSE_BUDGETS)) {
    assert.ok(budget.limit >= 1, `${scope} must allow at least one request`);
    assert.ok(budget.windowMs >= MINUTE_MS, `${scope} must have a window of at least a minute`);
  }
});

test("the customer-facing budgets leave room for a shared mobile address", () => {
  // These key on client IP, and on mobile that IP is shared: an apartment
  // behind one carrier NAT, or a campus, orders as one bucket. A customer who
  // cannot order is a worse failure than a scraper getting a few extra pages,
  // so each budget has to clear real multi-orderer behaviour by a wide margin.
  assert.ok(ABUSE_BUDGETS.checkout.limit >= 10, "several people must be able to order from one address");
  assert.ok(ABUSE_BUDGETS.billPreview.limit >= 60, "a cart with many edits must not self-throttle");
  assert.ok(ABUSE_BUDGETS.restaurants.limit >= 120, "browse is refetched on every filter change");
  assert.ok(ABUSE_BUDGETS.search.limit >= 30, "a person searches continuously");
  assert.ok(ABUSE_BUDGETS.orderLookup.limit >= 20, "history is refetched on every page load");
});

test("the owner-key check is the tightest budget in the table", () => {
  // This is the endpoint a script tests a harvested key against, and its 404
  // confirms when a key is live. Ten per ten minutes is what a partner who
  // cannot find their saved key needs, and is far below sustained script rates.
  const perHour = (ABUSE_BUDGETS.ownerVerify.limit * 60 * 60 * 1000) / ABUSE_BUDGETS.ownerVerify.windowMs;
  assert.ok(perHour <= 60, "no more than an hour of guesses per hour per address");
  for (const [scope, budget] of Object.entries(ABUSE_BUDGETS)) {
    if (scope === "ownerVerify") continue;
    const other = (budget.limit * 60 * 60 * 1000) / budget.windowMs;
    assert.ok(other > perHour, `${scope} should be looser than the credential check`);
  }
});

/* ------------------------------ route wiring ------------------------------ */

const GUARDED_ROUTES: { path: string; guard: string; scope: string }[] = [
  { path: "src/app/api/orders/route.ts", guard: "guardWrite", scope: "checkout" },
  { path: "src/app/api/orders/bill/route.ts", guard: "guardWrite", scope: "billPreview" },
  { path: "src/app/api/orders/lookup/route.ts", guard: "guardWrite", scope: "orderLookup" },
  { path: "src/app/api/partner/verify/route.ts", guard: "guardWrite", scope: "ownerVerify" },
  { path: "src/app/api/search/route.ts", guard: "guardRead", scope: "search" },
  { path: "src/app/api/restaurants/route.ts", guard: "guardRead", scope: "restaurants" },
];

test("every unauthenticated route is actually wired to its guard", () => {
  // A budget that is defined but never called protects nothing, and the route
  // still looks correct in review.
  for (const route of GUARDED_ROUTES) {
    const source = readSource(route.path);
    assert.match(source, new RegExp(`\\b${route.guard}\\(`), `${route.path} must call ${route.guard}`);
    assert.match(source, new RegExp(`"${route.scope}"`), `${route.path} must use the ${route.scope} scope`);
    assert.match(
      source,
      /if \(blocked\) return blocked;|if \(throttled\) return throttled;/,
      `${route.path} must return the guard's response`,
    );
  }
});

test("the read guards are budgeted and the write guards also bound the body", () => {
  for (const route of GUARDED_ROUTES.filter((r) => r.guard === "guardWrite")) {
    assert.match(readSource(route.path), /readJsonBody\(/, `${route.path} must read its body under the cap`);
  }
});

test("the guard runs before the route does any work", () => {
  for (const route of GUARDED_ROUTES) {
    const source = readSource(route.path);
    const guardAt = source.search(new RegExp(`\\b${route.guard}\\(`));
    // First database call and first body read must both come after the guard.
    const dbAt = source.search(/await (db|createOrder|computeBill|getOrderByCode|verifyOwner|searchAll|browseRestaurants|featuredRestaurants|restaurantsBySlugs|selfRegisterRestaurant)/);
    assert.ok(guardAt >= 0, `${route.path} has no guard`);
    assert.ok(dbAt === -1 || dbAt > guardAt, `${route.path} touches the database before the guard`);
  }
});

test("the signup honeypot is checked before the budget is charged", () => {
  // Ordering is the whole point. Charging first would let a bot behind a shared
  // address spend a real restaurant's three signups before its own request was
  // inspected — the limiter would become the tool it used to deny service.
  const source = readSource("src/app/api/partner/signup/route.ts");
  const honeypotAt = source.search(/bodyTrippedHoneypot\(/);
  const budgetAt = source.search(/checkRateLimit\(/);
  const writeAt = source.search(/selfRegisterRestaurant\(/);
  assert.ok(honeypotAt > 0 && budgetAt > 0, "signup must have both a honeypot and a budget");
  assert.ok(honeypotAt < budgetAt, "the honeypot must be checked before the budget is charged");
  assert.ok(budgetAt < writeAt, "the budget must be charged before the write");
});

test("the signup honeypot is answered as a success, not an error", () => {
  // A 4xx tells the bot exactly which field gave it away and invites it to
  // submit without that field next time.
  const source = readSource("src/app/api/partner/signup/route.ts");
  assert.match(source, /if \(bodyTrippedHoneypot\(parsed\.body\)\) return honeypotRejected\(\);/);
  assert.match(readSource("src/lib/abuse.ts"), /export function honeypotRejected\(\): Response \{\s*return Response\.json\(\{ ok: true \}\);/);
});

test("the partner form ships the honeypot field and is unfocusable", () => {
  const source = readSource("src/app/partner/page.tsx");
  assert.match(source, /name="company_url"/);
  assert.match(source, /tabIndex=\{-1\}/, "a visually hidden field must still be out of the tab order");
  assert.match(source, /aria-hidden="true"/, "the honeypot must be hidden from assistive tech");
  // The value sent has to come from the DOM, not from React state: a hardcoded
  // empty string would never trip, however much the bot typed into the input.
  assert.match(source, /company_url: String\(form\.get\("company_url"\) \?\? ""\)/);
});

test("search escapes the pattern at the query layer, not only at the route", () => {
  // The route clamps the term; the LIKE pattern is built here. If escaping lived
  // only at the route, a second caller of searchAll would reintroduce the bug.
  const source = readSource("src/db/queries.ts");
  assert.match(source, /const like = `%\$\{escapeLike\(q\)\}%`;/);
});

test("the slug cap holds in the query helper too, not only at the route", () => {
  const source = readSource("src/db/queries.ts");
  assert.match(source, /const bounded = slugs\.slice\(0, MAX_SLUGS\);/);
});

test("the webhook's own limiter is not weakened by this work", () => {
  // The Razorpay webhook keeps its own window: it is keyed on the provider's
  // address, not a browser's, so sharing a helper here would wrongly bucket
  // every legitimate event from Razorpay together.
  const source = readSource("src/app/api/integrations/payments/webhook/route.ts");
  assert.match(source, /WEBHOOK_MAX_PER_WINDOW/);
  assert.doesNotMatch(source, /guardWrite|guardRead|@\/lib\/abuse"/, "the webhook path is deliberately not wrapped");
});