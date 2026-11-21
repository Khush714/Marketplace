import "server-only";

import type { NextResponse } from "next/server";

import { CSP_HEADER, contentSecurityPolicy } from "@/lib/edge-policy-core";

/**
 * Apply the standard security headers to a response.
 *
 * Called by the Proxy on every path it answers — the denied ones and the ones
 * passed to routing — so a refusal and a page carry the same policy. HSTS is
 * deliberately NOT set here: it is only truthful over HTTPS, so the Proxy adds
 * it itself after checking the request protocol.
 */
export function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set(CSP_HEADER, contentSecurityPolicy(process.env.NODE_ENV));
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "geolocation=(self), microphone=(), camera=()");
  res.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return res;
}