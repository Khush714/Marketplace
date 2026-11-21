import { NextRequest } from "next/server";

import { guardWrite } from "@/lib/abuse";
import { buildClearedCustomerSessionCookie } from "@/lib/customer-session-core";
import {
  clearAccountSessionCookies,
  cookieShouldBeSecure,
  requireAccountSession,
  revokeAllSessionsForCurrentAccount,
  revokeCurrentAccountSession,
} from "@/lib/security/customer-account-session";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

/**
 * Sign out this device (default) or all devices (?all=1).
 * Mutating: requires CSRF/origin checks via requireAccountSession.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;

  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const all = req.nextUrl.searchParams.get("all") === "1";
  try {
    if (all) {
      await revokeAllSessionsForCurrentAccount(req);
    } else {
      await revokeCurrentAccountSession(req);
    }
  } catch {
    // Even if revocation write fails, clear cookies to end client-side session.
  }

  // PII-safe audit: identifiers/flags only.
  emitSecurityEvent("customer_account_session_revoked", {
    outcome: "success",
    accountId: auth.session.account.id,
    allSessions: all,
  });

  const res = Response.json({ ok: true, all });
  clearAccountSessionCookies(res, cookieShouldBeSecure(req));
  // Also clear anonymous customer session to prevent shared-browser order leakage
  // after sign-out (guest GET /api/orders reads anonymous session).
  res.headers.append("Set-Cookie", buildClearedCustomerSessionCookie({ secure: cookieShouldBeSecure(req) }));
  return res;
}
