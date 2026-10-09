/**
 * The image-URL policy: one canonical allowlist and one validation pipeline for
 * every URL that may end up as the `src` of a `next/image`.
 *
 * Why this module exists
 * ----------------------
 * `next/image` optimizes remote images on the SERVER: the Next process itself
 * fetches whatever URL the markup points at (`fetchExternalImage` in
 * `next/dist/server/image-optimizer.js`). An allowlist of "any HTTPS host" is
 * therefore a server-side request forgery primitive — whoever can write an
 * image URL (a partner pasting into the editor, a POS menu payload) chooses an
 * address the marketplace's own servers then request. That is how a public web
 * app is made to probe `169.254.169.254`, `10.0.0.0/8` or loopback, and how it
 * is turned into an open proxy for arbitrary third parties.
 *
 * The boundary is deliberately layered, and this module is the single source of
 * truth for all of it:
 *
 *   1. WRITE — `sanitizeImageUrl` (`lib/domain.ts`) runs `validateImageUrl`
 *      below on every image URL the app is asked to store, so a bad value is
 *      replaced with fallback artwork at the moment it is written.
 *   2. FETCH — `next.config.ts` builds `images.remotePatterns` from
 *      `IMAGE_HOST_PATTERNS`, and (with `dangerouslyAllowLocalIP: false`) makes
 *      the optimizer refuse private/reserved addresses even on an allowed host.
 *   3. READ — the DTO mappers (`db/queries.ts`, `db/partner-menu.ts`) re-apply
 *      the policy, because rows written before it existed must not reach
 *      `next/image` either.
 *
 * Adding a host is a one-line edit to `IMAGE_HOST_PATTERNS`: the optimizer
 * allowlist follows automatically because `next.config.ts` imports this file.
 *
 * Pure on purpose — no `server-only`, no env, no network — so the config, the
 * shared server code and `node --test` can all import it. The only URL parsing
 * here is `new URL(...)`, which does not resolve DNS. DNS that answers with a
 * private address (rebinding) is handled by layer 2, not here.
 */

/**
 * The allowlist, in the same `{ protocol, hostname }` shape as Next's
 * `remotePatterns` (see `next.config.ts`).
 *
 * HTTPS only: plain `http` is mixed content on the customer-facing pages and
 * is refused by the rest of the pipeline anyway, so advertising it here would
 * only re-open what everything else closes.
 *
 *  - `images.pexels.com` — seeded/curated artwork and the `DEFAULT_*` fallbacks.
 *  - `*.supabase.co` — Supabase Storage, where dish photos and restaurant
 *    imagery actually live (the `dish-images` bucket, same project as the DB).
 *
 * Wildcards must stay rooted at a real provider boundary (`*.example.com`) and
 * `*` stands for exactly the sub-domain labels; a bare `**` or `*` is never
 * allowed, because "any host" is the bug this file exists to prevent.
 */
export const IMAGE_HOST_PATTERNS: readonly { protocol: "https"; hostname: string }[] = [
  { protocol: "https", hostname: "images.pexels.com" },
  { protocol: "https", hostname: "*.supabase.co" },
];

/**
 * Normalise a hostname for comparison: `URL.hostname` lowercases ASCII hosts
 * already, but callers may pass anything, and an IPv6 host arrives bracketed
 * (`[::1]`). Brackets are stripped so the IP predicates below see the bare
 * address.
 */
function normalizeHostname(raw: string): string {
  const host = raw.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Does a hostname satisfy the allowlist? `*.example.com` matches
 * `a.example.com` (and `a.b.example.com`) but NOT `example.com` itself, and
 * refuses lookalikes such as `evil-example.com` or `example.com.evil.net`:
 * the remainder after the wildcard must start with the literal `.` + suffix.
 */
export function matchesImageHost(rawHostname: string): boolean {
  const host = normalizeHostname(rawHostname);
  if (!host) return false;
  for (const { hostname } of IMAGE_HOST_PATTERNS) {
    const pattern = hostname.toLowerCase();
    if (!pattern.startsWith("*.")) {
      if (host === pattern) return true;
      continue;
    }
    const suffix = pattern.slice(1); // ".example.com"
    if (host.endsWith(suffix) && host.length > suffix.length) return true;
  }
  return false;
}

/** Parse a strict dotted-quad IPv4 literal, or null if the label is not one. */
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Every IPv4 block that is not a public destination: "this" network, private
 * ranges, carrier-grade NAT, loopback, link-local (the cloud-metadata address
 * lives here), protocol assignments, the three TEST-NETs, benchmarking space,
 * and the multicast/reserved/broadcast top of the range. Kept deliberately
 * broad — a false positive only costs someone a fallback image.
 */
function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 0 && c === 0) return true; // RFC 6890 (incl. 192.0.0.192 metadata)
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // RFC 2544 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Judge an IPv6 literal. Anything outside global unicast (2000::/3) is not a public destination. */
function isPrivateOrReservedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  // IPv4-mapped/embedded forms carry a v4 address (the classic metadata-service
  // disguise), so judge the embedded value by the v4 rules rather than guessing.
  const mapped = /^(?:::)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]!);
    return !v4 || isPrivateOrReservedIpv4(v4);
  }
  if (h === "::" || h === "::1") return true; // unspecified / loopback
  if (/^f[cd]/.test(h)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  if (h.startsWith("ff")) return true; // ff00::/8 multicast
  if (h.startsWith("2001:db8:")) return true; // documentation
  // Deprecated site-local (fec0::/10), discard-only (100::/64), v4-translated
  // and anything else outside 2000::/3 fall through to "reserved".
  return !/^[23]/.test(h);
}

/**
 * Would this hostname name a machine inside our own network (or one that never
 * names a public host at all)? Catches IP literals in either family and the
 * names resolvers keep local: a bare single-label name (`localhost`, a k8s
 * service), and the RFC 6761/6762-style reserved suffixes.
 *
 * This is defence in depth for the literal case — an allowlisted *domain* can
 * still resolve anywhere, which is why `next.config.ts` also turns off
 * `dangerouslyAllowLocalIP` so the optimizer itself refuses a non-unicast
 * address. It also means `validateImageUrl` refuses `https://127.0.0.1/...`
 * even before the allowlist is consulted.
 */
export function isPrivateOrReservedHost(rawHostname: string): boolean {
  const host = normalizeHostname(rawHostname);
  if (!host) return true;

  // IP literals first: an IPv6 address has no dots, so the bare-label rule
  // below (meant for DNS names) would otherwise swallow every v6 literal.
  const v4 = parseIpv4(host);
  if (v4) return isPrivateOrReservedIpv4(v4);
  if (host.includes(":")) return isPrivateOrReservedIpv6(host);

  // A bare label with no dot is never a public DNS name.
  if (!host.includes(".")) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true; // mDNS / Bonjour
  if (host.endsWith(".home.arpa")) return true;
  if (host.endsWith(".internal")) return true;
  if (host.endsWith(".lan")) return true;
  if (host.endsWith(".localdomain")) return true;
  return false;
}

/**
 * The gate: return the canonical absolute URL if and only if it is something
 * `next/image` is allowed to fetch, otherwise `null`.
 *
 * Rejects, in order:
 *  - non-URLs, relative paths and anything with credentials, a fragment or a
 *    non-default port (each is a way to make a URL read as something it is not);
 *  - anything that is not `https:` (`data:`, `javascript:`, plain `http:`);
 *  - private, reserved or literal-IP hosts (`isPrivateOrReservedHost`);
 *  - every host not named by `IMAGE_HOST_PATTERNS`.
 *
 * Returns `url.toString()` so the stored value is the canonical form — the
 * fragments/credential checks above also guarantee that re-serialisation is the
 * one normalisation applied.
 */
export function validateImageUrl(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null; // default (:443) reads back as ""
  if (url.hash) return null; // a fragment never identifies a resource to fetch
  if (isPrivateOrReservedHost(url.hostname)) return null;
  if (!matchesImageHost(url.hostname)) return null;

  return url.toString();
}
