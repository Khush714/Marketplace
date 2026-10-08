import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/lib/app-url";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";
import { withSecurityHeaders } from "@/lib/security/security-headers";
import {
  ALLOW_HEADER_VALUE,
  HSTS_HEADER,
  HSTS_VALUE,
  MAX_DECLARED_BODY_BYTES,
  declaredTooLarge,
  hostAllowed,
  methodAllowed,
  normalizeHost,
  type HostAllowlist,
} from "@/lib/edge-policy-core";

/**
 * Network boundary for the whole site.
 *
 * The Proxy is the first thing a request touches: cheaper than any route
 * handler, run before routing, RSC, or a database connection. It owns four
 * gates and the response headers:
 *
 *   1. Method allowlist — the app serves GET/HEAD/POST/PUT/PATCH/DELETE/
 *      OPTIONS and nothing else.
 *   2. Host allowlist — this deployment's configured host plus Vercel preview
 *      subdomains; a flood aimed at a raw IP or a rebinding scrape gets a 400,
 *      not a query.
 *   3. Declared body cap — an absurd `content-length` is refused before the
 *      body is allocated. Chunked bodies declare nothing, so the handlers that
 *      read bodies still cap the stream themselves.
 *   4. Per-client burst ceiling — a fixed window far above what a person hits,
 *      deliberately looser than any per-route budget so an apartment sharing
 *      one NAT is never throttled by it. This is NOT a substitute for the
 *      per-route budgets in `abuse-core.ts`; it is the ceiling that keeps a
 *      machine ramping thousands of requests a minute from reaching a handler
 *      at all.
 *
 * Every response — the ones refused here and the ones passed through — gets
 * the standard security headers, which is also where the previously unused
 * `withSecurityHeaders` helper finally earns its keep.
 *
 * The burst limiter is in-process (same single-node shape as
 * `rate-limit.ts`), so it is a cheap first line, not an authoritative one;
 * behind a shared edge limiter or a WAF it can be dropped.
 */

const EDGE_BURST_LIMIT = 300;
const EDGE_BURST_WINDOW_MS = 60_000;

/** The hosts this deployment answers to. */
function hostAllowlist(): HostAllowlist {
  const configured = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  let originHost = "";
  try {
    originHost = new URL(appOrigin()).hostname;
  } catch {
    // Fall through with no origin host: vercel.app previews plus any explicit
    // ALLOWED_HOSTS still resolve before a navigation is refused.
  }

  const exact = [...new Set([...configured, originHost])]
    .map((h) => normalizeHost(h))
    .filter((h): h is string => h !== null);

  return {
    exact,
    vercelPreview: true,
    localhost: process.env.NODE_ENV !== "production",
  };
}

function deny(status: number, body: Record<string, unknown>, extra: Record<string, string>): NextResponse {
  const res = NextResponse.json(body, { status, headers: extra });
  withSecurityHeaders(res);
  return res;
}

export function proxy(request: NextRequest) {
  if (!methodAllowed(request.method)) {
    return deny(
      405,
      { ok: false, error: "Method not allowed" },
      { Allow: ALLOW_HEADER_VALUE },
    );
  }

  if (!hostAllowed(request.headers.get("host"), hostAllowlist())) {
    return deny(400, { ok: false, error: "Bad request" }, {});
  }

  if (declaredTooLarge(request.headers.get("content-length"), MAX_DECLARED_BODY_BYTES)) {
    return deny(413, { ok: false, error: "Request too large" }, {});
  }

  const burst = checkRateLimit(
    clientKey(request, "edge-burst"),
    EDGE_BURST_LIMIT,
    EDGE_BURST_WINDOW_MS,
  );
  if (!burst.allowed) {
    return deny(
      429,
      { ok: false, error: "Too many requests." },
      { "Retry-After": String(burst.retryAfterSeconds) },
    );
  }

  const res = NextResponse.next();
  withSecurityHeaders(res);
  if (request.nextUrl.protocol === "https:") {
    res.headers.set(HSTS_HEADER, HSTS_VALUE);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)"],
};