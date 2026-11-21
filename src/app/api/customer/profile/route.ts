import { NextRequest } from "next/server";

import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { normalizeAccountName, normalizeCustomerAvatar } from "@/lib/customer-account-core";
import { getAccountById, updateAccountProfile } from "@/db/customer-accounts";
import {
  clearAccountSessionCookies,
  cookieShouldBeSecure,
  requireAccountSession,
} from "@/lib/security/customer-account-session";

export const dynamic = "force-dynamic";

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

  return Response.json({
    ok: true,
    account: {
      id: account.id,
      phoneE164: account.phoneE164,
      name: account.name ?? "",
      avatar: account.avatar ?? "",
      phoneVerifiedAt: account.phoneVerifiedAt?.toISOString() ?? null,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;

  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { name?: unknown; avatar?: unknown };

  const patch: { name?: string; avatar?: string } = {};
  if (body.name !== undefined) patch.name = normalizeAccountName(body.name);
  if (body.avatar !== undefined) patch.avatar = normalizeCustomerAvatar(body.avatar);

  const updated = await updateAccountProfile(auth.session.account.id, patch);
  if (!updated) {
    return Response.json({ ok: false, error: "Unable to update profile" }, { status: 400 });
  }

  return Response.json({
    ok: true,
    account: {
      id: updated.id,
      phoneE164: updated.phoneE164,
      name: updated.name ?? "",
      avatar: updated.avatar ?? "",
      phoneVerifiedAt: updated.phoneVerifiedAt?.toISOString() ?? null,
    },
  });
}
