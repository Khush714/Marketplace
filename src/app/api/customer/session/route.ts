import { NextRequest } from "next/server";

import { guardRead } from "@/lib/abuse";
import {
  clearAccountSessionCookies,
  cookieShouldBeSecure,
  requireAccountSession,
} from "@/lib/security/customer-account-session";
import { getAccountById } from "@/db/customer-accounts";

export const dynamic = "force-dynamic";

/** Who am I? Returns the authenticated account for a live session, or 401. */
export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, "customerAccountRead");
  if (blocked) return blocked;

  const auth = await requireAccountSession(req, { mutating: false, renew: true });
  if (!auth.ok) return auth.response;

  const account = await getAccountById(auth.session.account.id);
  if (!account || account.status !== "active") {
    const res = Response.json(
      { ok: false, error: "Sign in required", code: "ACCOUNT_SESSION_REQUIRED" },
      { status: 401 },
    );
    clearAccountSessionCookies(res, cookieShouldBeSecure(req));
    return res;
  }

  const res = Response.json({
    ok: true,
    account: {
      id: account.id,
      phoneE164: account.phoneE164,
      name: account.name ?? "",
      avatar: account.avatar ?? "",
    },
    sessionExpiresAt: (auth.renewedExpiresAt ?? auth.session.session.expiresAt).toISOString(),
  });

  // If renewed, caller needs fresh cookies? session tokens didn't change, only
  // expiry was extended in DB; cookie Max-Age should reflect new expiry. We don't
  // have the raw tokens here (by design), so we cannot re-set session cookies.
  // The DB expiry is the source of truth for liveness; browser cookie Max-Age is
  // a convenience bound. For now, reads that renew extend server-side lifetime;
  // full cookie refresh can be handled on explicit re-auth flows if needed.
  return res;
}
