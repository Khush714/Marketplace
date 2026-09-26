import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared guard for the privileged operations surface: partner onboarding codes,
 * the POS delivery drain and the payment reconciliation trigger.
 *
 * One place, because it used to be five copy-pasted inline comparisons that
 * disagreed about failure. Three properties matter:
 *
 *   - Constant-time. A plain `!==` on a bearer secret leaks its prefix through
 *     response timing, so this compares digests like order-token.ts does.
 *   - Fail-closed in production. An unset `POS_DELIVERY_OPS_TOKEN` means the
 *     ops endpoints are open, which is convenient for `npm run dev` and
 *     catastrophic on a deployed host: anyone could mint onboarding codes or
 *     trigger drains. In production a missing token denies everything instead.
 *   - Header-only. The token rides `x-ops-token`, never a query string, which
 *     would leak into logs, proxies and browser history.
 */

export const OPS_TOKEN_HEADER = "x-ops-token";

/** The configured ops token, or "" when unset. */
export function configuredOpsToken(): string {
  return (process.env.POS_DELIVERY_OPS_TOKEN ?? "").trim();
}

/** True when the ops surface is open (no token configured and not production). */
export function opsTokenOptional(): boolean {
  return configuredOpsToken() === "" && process.env.NODE_ENV !== "production";
}

function constantTimeEquals(a: string, b: string): boolean {
  const expected = Buffer.from(a);
  const actual = Buffer.from(b);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Returns a 401 `Response` when the caller is not ops, or `null` when the
 * request may proceed. Production without a configured token always denies.
 */
export function requireOpsToken(req: NextRequest): Response | null {
  const expected = configuredOpsToken();
  if (!expected) {
    if (opsTokenOptional()) return null;
    return Response.json(
      {
        ok: false,
        error: "Ops access is not configured on this deployment",
        code: "OPS_TOKEN_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
  const provided = (req.headers.get(OPS_TOKEN_HEADER) ?? "").trim();
  if (!provided || !constantTimeEquals(provided, expected)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
