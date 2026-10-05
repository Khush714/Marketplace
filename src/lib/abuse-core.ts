/**
 * Request-abuse policy, as pure functions.
 *
 * Split from `abuse.ts` for the same reason `cron-auth-core.ts` exists: the
 * decision logic is what is worth testing, and `server-only` modules cannot be
 * imported by `node --test`. Nothing here touches the network, the database, or
 * a clock.
 *
 * What this file defends against is *unauthenticated volume*, not
 * unauthenticated access. Every route below is either public by design or gated
 * by a capability the caller already holds (a connection code, an HMAC order
 * token, an owner key). The job is to make the capability expensive to grind
 * and to stop a single request from being large enough to hurt on its own.
 */

/** One minute, in ms. Windows below are expressed in these. */
export const MINUTE_MS = 60_000;

export interface AbuseBudget {
  /** Requests permitted per window, per client bucket. */
  limit: number;
  windowMs: number;
}

/**
 * Per-route budgets.
 *
 * These are deliberately far above what a real customer does in the window. The
 * customer-facing routes key on client IP, and on mobile that IP is shared: an
 * apartment behind one carrier NAT, or a college campus, orders as one bucket.
 * A budget tight enough to stop a script running at hundreds of requests per
 * second would also throttle those households, and a customer who cannot order
 * is a worse failure than a scraper getting a few extra pages. So every limit is
 * set where it still costs an attacker the thing they want — sustained volume —
 * and nowhere near where it costs a legitimate user their session.
 */
export const ABUSE_BUDGETS = {
  /**
   * Checkout. The most expensive route in the app by an order of magnitude: one
   * request writes a row, calls the payment provider to allocate a real order,
   * and enqueues a delivery event. It is also completely unauthenticated, which
   * makes it both a spam sink (junk orders delivered to real kitchens) and a way
   * to burn provider API quota. Real customers order a handful of times an hour;
   * 20 per ten minutes covers a large shared address ordering together.
   */
  checkout: { limit: 20, windowMs: 10 * MINUTE_MS },

  /**
   * Bill preview. Recomputes totals from the DB on every cart change, so a loop
   * over it is cheap to send and expensive to serve. It writes nothing, so the
   * budget is generous and its window short.
   */
  billPreview: { limit: 120, windowMs: MINUTE_MS },

  /**
   * Order history lookup. Each code carries its own HMAC token and unverified
   * codes are dropped silently, so this cannot enumerate orders — but it does
   * verify up to 30 signatures and run a query per survivor, which is enough
   * work to matter in bulk.
   */
  orderLookup: { limit: 60, windowMs: MINUTE_MS },

  /**
   * Search. Every request runs an ILIKE across restaurants plus a dish scan.
   * A scrape loop is the reason this is budgeted at all; 60/min still lets a
   * person search continuously.
   */
  search: { limit: 60, windowMs: MINUTE_MS },

  /**
   * Restaurant browse. Refetched on every filter change and on back-navigation,
   * so this is the highest budget here. The unbounded parts of this route
   * (slug count, query length) are capped separately — a scraper sends one huge
   * request, not many small ones.
   */
  restaurants: { limit: 240, windowMs: MINUTE_MS },

  /**
   * Owner-key verification. The key is 18 random bytes, so guessing is not the
   * risk; *submitting* guesses is. This is the credential-check endpoint an
   * attacker scripts against to test a leaked or harvested key, and it returns a
   * distinct 404 that confirms when a key is live. Ten per ten minutes is what
   * a real partner who cannot find their saved key needs.
   */
  ownerVerify: { limit: 10, windowMs: 10 * MINUTE_MS },
} as const satisfies Record<string, AbuseBudget>;

export type AbuseScope = keyof typeof ABUSE_BUDGETS;

/**
 * Largest JSON body any unauthenticated write route will parse.
 *
 * An order is a restaurant slug, a phone number, an address and a bounded item
 * list; 16 KB is several times the real payload. Next.js parses the body before
 * the handler runs, so this is checked from `content-length` and the streamed
 * body is bounded separately — without it, a caller can post a gigabyte and make
 * the platform buffer it regardless of what the handler validates.
 */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

/**
 * Longest search term accepted.
 *
 * The term is interpolated into a `%term%` ILIKE pattern, so an unbounded one
 * is a long pattern for the planner to work through on every request. Real
 * dish and restaurant names are far shorter than this.
 */
export const MAX_SEARCH_QUERY = 64;

/**
 * Longest slug list accepted by the `?slugs=` bulk lookup.
 *
 * This array is spliced straight into an `inArray(...)`. Without a cap a single
 * request can carry thousands of values and turn one indexed lookup into one
 * very large statement.
 */
export const MAX_SLUGS = 50;

/**
 * Escape the wildcards a LIKE/ILIKE pattern treats as syntax.
 *
 * `%term%` is built from user input, so a term of `%` matches every row and
 * `_` matches any single character. Row counts are capped by `.limit()` at the
 * query level, so this is a scan-cost and result-set-shape problem rather than a
 * data leak — but escaping is what makes the pattern mean what the user typed,
 * and it costs three string replacements.
 *
 * `escape` must be the first character, which is why the replacement order is
 * backslash, percent, underscore.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Cap a search term to the accepted length, collapsing surrounding whitespace. */
export function clampSearchQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_SEARCH_QUERY);
}

/**
 * Clamp a comma-separated slug list to a bounded, de-duplicated set.
 *
 * Order is preserved so the response still matches the caller's ordering, and
 * duplicates are dropped because repeating a slug gains nothing but inflates the
 * statement.
 */
export function clampSlugList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const slug = part.trim();
    if (!slug || slug.length > MAX_SEARCH_QUERY) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_SLUGS) break;
  }
  return out;
}

export type OriginDecision = "same-origin" | "unknown" | "cross-site";

/**
 * Decide whether a request plausibly came from this site's own UI.
 *
 * This is CSRF defence, not authentication: a cross-site caller cannot read the
 * response and the routes here return nothing secret, but a cross-site *writer*
 * still costs real work — `POST /api/orders` creates a row and a provider order
 * on behalf of whoever the browser happens to be.
 *
 * Two signals, in order:
 *
 *   1. `Sec-Fetch-Site: cross-site`. Browsers set this header themselves and a
 *      script cannot forge it into a request the browser makes on its behalf, so
 *      it is definitive when present. This is also the one signal that works
 *      without knowing the deployment's hostname, which matters because preview
 *      URLs change on every deploy.
 *   2. `Origin`, when the browser sent one. Checked against both the request's
 *      own `Host` and the configured app origin, so a preview deployment is not
 *      rejected for not matching `NEXT_PUBLIC_APP_URL`.
 *
 * `unknown` means the caller sent no browser signal at all — curl, a server-to-
 * server call, a test. Those are allowed through: this guard exists to stop a
 * *browser* from being used as a confused deputy, and refusing them would break
 * the POS integrations and the test suite to stop an attack they are not part
 * of. Such callers are still subject to the rate budget.
 */
export function decideOrigin(
  headers: { get(name: string): string | null },
  allowedHosts: readonly string[],
): OriginDecision {
  const fetchSite = (headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  // The browser asserting same-origin (or "none", as a top-level navigation
  // sends) settles it outright — there is no Origin to compare and no reason to
  // make the caller wait for a second signal that will not arrive.
  if (fetchSite === "same-origin" || fetchSite === "none") return "same-origin";
  if (fetchSite === "cross-site") return "cross-site";

  const origin = (headers.get("origin") ?? "").trim();
  if (!origin || origin === "null") return "unknown";

  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    // An Origin the platform cannot parse is not a browser-sent value. Treat it
    // as untrusted rather than falling through to `unknown`.
    return "cross-site";
  }
  if (!host) return "cross-site";

  const allowed = new Set(allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean));
  return allowed.has(host) ? "same-origin" : "cross-site";
}

/**
 * Bucket key for a caller that arrived with no address at all.
 *
 * The obvious fallback — a single literal `unknown` — is the one case that can
 * hurt a real user. Every caller without `x-forwarded-for` shares that bucket, so
 * the first attacker who omits the header spends the budget on everybody else,
 * and a legitimate request arriving during that window is refused for something
 * it did not do.
 *
 * So distinct callers get distinct buckets, keyed on the client hints a browser
 * always sends. This is deliberately NOT a security boundary: a caller who
 * spoofs the user agent alongside the address evades only their own limiter, and
 * that is already true of `x-forwarded-for`. The goal is only to stop unrelated
 * callers from sharing a counter.
 */
export function fallbackBucketKey(headers: { get(name: string): string | null }): string {
  const hints = [headers.get("user-agent") ?? "", headers.get("accept-language") ?? ""]
    // Filtered before joining: a join alone would turn "both headers absent" into
    // the two-character string "\0\0", which is truthy, hashes to a stable key,
    // and quietly makes the no-hints branch below unreachable.
    .filter((h) => h.length > 0)
    .join("\u0000")
    .trim();
  return hints ? `unknown:${fnv1a(hints)}` : "unknown";
}

/** FNV-1a, only to keep a fallback bucket key short. Not a security primitive. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Whether a hidden field caught a bot filling in every input it can see.
 *
 * A form bot that does not parse the DOM fills in text inputs it finds; a person
 * never sees the field, so never types into it. The caller answers with a
 * *success-shaped rejection rather than a 4xx, so the bot learns nothing about
 * why it failed — see `honeypotRejected` for the response shape.
 */
export function honeypotTripped(body: unknown, field = "company_url"): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}