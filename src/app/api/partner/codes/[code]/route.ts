import { NextRequest } from "next/server";
import { getConnectionCode, revokeConnectionCode } from "@/db/queries";
import { guardBudget, guardRead } from "@/lib/abuse";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Look up a single onboarding code. Ops-only: it reports which POS tenant and
 * restaurant a code is bound to, which is not something an unauthenticated
 * caller should be able to enumerate.
 *
 * Budgeted under `opsCodeRead`, charged before the token check — in
 * development the token is optional, and without the budget this is a state
 * oracle over the 5-symbol code space (see ABUSE_BUDGETS).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const throttled = guardRead(req, "opsCodeRead");
  if (throttled) return throttled;

  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { code } = await ctx.params;
  const hit = await getConnectionCode(code);
  if (!hit) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ code: hit });
}

/**
 * Withdraw an unused onboarding code.
 *
 * Ops-only for the same reason minting is: whoever can mint can mint another, so
 * revocation is not a capability that needs its own secret — but who *revoked
 * what, and when* is operational history, and letting an unauthenticated caller
 * invalidate codes would be a denial-of-service on onboarding.
 *
 * Only unused codes can be revoked, so DELETE here cannot un-burn an invite that
 * already created a listing. That is a 409 rather than a 400: the request is
 * well-formed and the code exists, the caller just lost a race with a redemption.
 *
 * Budgeted under `opsCodeRevoke`, again charged before the token check: while
 * the token is optional in development, revocation is an unauthenticated way
 * to burn an operator's codes, and a wrong token must not get its 401 for free.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const blocked = guardBudget(req, "opsCodeRevoke");
  if (blocked) return blocked;

  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { code } = await ctx.params;
  const result = await revokeConnectionCode(code);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return Response.json({ ok: true, code: result.code });
}
