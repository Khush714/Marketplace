/**
 * Network-boundary policy for the Proxy layer, as pure functions.
 *
 * The same split that made `abuse-core.ts` and `cron-auth-core.ts` separate
 * files applies here: `proxy.ts` cannot be imported by `node --test`, and the
 * decisions above it are the thing worth pinning, so the decision logic lives
 * here, free of Next, `server-only` and any clock.
 *
 * The Proxy is the cheapest gate in the system — it runs before a request
 * reaches a route handler, a database connection or an in-process limiter — so
 * its decisions are deliberately coarse, and coarse in the direction that can
 * only be wrong by being too strict:
 *
 *   - Methods the app never serves are rejected outright. `next dev` answers
 *     "unsupported method" natively, but only after matching a route; the Proxy
 *     answers before any routing work happens.
 *   - Hosts this deployment never serves are rejected outright. A flood aimed
 *     at the host's raw IP, or a DNS-rebinding scrape, arrives with a Host this
 *     app was never configured for; refusing it costs a header comparison.
 *   - Absurd declared body sizes are refused before the body exists.
 *     `content-length` is untrusted (a chunked request declares nothing), so
 *     this is only the free pre-check; every handler that reads a body still
 *     caps the stream itself.
 *
 * None of this is per-user auth. It is the boundary the per-route abuse budgets
 * in `abuse-core.ts` sit behind.
 */

/** Methods the application accepts anywhere. Everything else is refused. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

/** 405 response header advertising the surface a caller may reach. */
export const ALLOW_HEADER_VALUE = [...ALLOWED_METHODS].join(", ");

/**
 * Largest declared body the Proxy will pass to any route.
 *
 * Only a free pre-check — a chunked request declares nothing, so the handlers
 * that actually read bodies still cap the stream (16 KB for `readJsonBody`,
 * 256 KB for the small webhooks, 1 MiB for the menu-sync webhook). This exists
 * to refuse the absurd in one place before it is allocated anywhere.
 */
export const MAX_DECLARED_BODY_BYTES = 1024 * 1024;

/** HSTS is only ever advertised over HTTPS, so a mixed-protocol deploy is not told to. */
export const HSTS_HEADER = "Strict-Transport-Security";
export const HSTS_VALUE = "max-age=63072000";

/** Header the CSP is served under. */
export const CSP_HEADER = "Content-Security-Policy";

/**
 * Content-Security-Policy for every response the Proxy touches.
 *
 * Shipped in its permissive first stage on purpose. The directives that could
 * break the UI if they guessed wrong allow exactly what this app renders today:
 *
 *   - Next.js bootstraps with inline `<script>` chunks (the flight data and
 *     runtime both live there), so `script-src` still carries `'unsafe-inline'`;
 *     `checkout.razorpay.com` is the one external script (razorpay-checkout.ts).
 *   - React renders `style={...}` as attributes, so `style-src` carries
 *     `'unsafe-inline'`; every stylesheet the app ships is same-origin.
 *   - `img-src` admits any `https:` source (plus `data:`/`blob:` for decoded
 *     artwork). The CSP is the BROWSER-side half of the boundary. The
 *     server-side half — the hosts `next/image` is actually allowed to fetch,
 *     which is the part that matters against SSRF — is the allowlist in
 *     `lib/image-policy.ts`, mirrored by `images.remotePatterns` in
 *     `next.config.ts`; this directive does not need to repeat it.
 *
 * The directives that cannot break a page are already strict from day one:
 * `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
 * `frame-ancestors 'none'` (doubling X-Frame-Options), and `connect-src` /
 * `frame-src` pinned to self plus the Razorpay origins so an injected script
 * cannot phone home or frame a payment UI of its own.
 *
 * The tightening path, each step shippable alone: replace `'unsafe-inline'` in
 * `script-src` with a per-request nonce minted in the Proxy and handed to Next
 * through the `x-nonce` request header, then narrow `img-src` to the hosts that
 * actually appear in content.
 *
 * @param nodeEnv Development builds keep `'unsafe-eval'` for the dev server's
 * eval-based tooling; a production build never serves it.
 */
export function contentSecurityPolicy(nodeEnv?: string): string {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(nodeEnv === "production" ? [] : ["'unsafe-eval'"]),
    "https://checkout.razorpay.com",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://razorpay.com https://*.razorpay.com",
    "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ") + ";";
}

/** Whether an HTTP method is part of the application surface. */
export function methodAllowed(method: string | undefined | null): boolean {
  return ALLOWED_METHODS.has((method ?? "").toUpperCase());
}

/** Hosts this deployment will serve. */
export interface HostAllowlist {
  /**
   * Exact hostnames (lowercased, no port) that may claim the request.
   * Populated from `ALLOWED_HOSTS` plus the configured app origin.
   */
  exact: string[];
  /** Accept `*.vercel.app` — the deployment hostname changes on every preview. */
  vercelPreview: boolean;
  /** Accept localhost loopback addresses in non-production runs. */
  localhost: boolean;
}

/**
 * A bare hostname from a `Host` header, lowercased and ports stripped, so
 * `app.example:3000`, `app.EXAMPLE` and `app.example` all compare equal. IPv6
 * loopback keeps its brackets. Returns null for a header that is absent,
 * empty, or unparseable — a caller like that is refused, never passed through.
 */
export function normalizeHost(raw: string | undefined | null): string | null {
  const host = (raw ?? "").trim().toLowerCase();
  if (!host) return null;
  try {
    let parsed: URL;
    if (host.startsWith("[")) {
      parsed = new URL(`http://${host}`);
    } else {
      const url = new URL(`http://${host}`);
      url.port = "";
      parsed = url;
    }
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

/** Whether a `Host` header may be served by this deployment. */
export function hostAllowed(raw: string | undefined | null, allow: HostAllowlist): boolean {
  const host = normalizeHost(raw);
  if (!host) return false;
  if (allow.exact.includes(host)) return true;
  if (allow.vercelPreview && (host === "vercel.app" || host.endsWith(".vercel.app"))) return true;
  if (allow.localhost && (host === "localhost" || host === "127.0.0.1" || host === "[::1]")) {
    return true;
  }
  return false;
}

/**
 * Whether a declared `content-length` exceeds the cap.
 *
 * Absent or unparseable values return false: the caller declared nothing, so
 * this pre-check has nothing to act on and the stream caps in the handlers are
 * the authority instead.
 */
export function declaredTooLarge(
  contentLength: string | undefined | null,
  maxBytes: number,
): boolean {
  const raw = (contentLength ?? "").trim();
  if (!raw) return false;
  const declared = Number(raw);
  if (!Number.isFinite(declared)) return false;
  return declared > maxBytes;
}