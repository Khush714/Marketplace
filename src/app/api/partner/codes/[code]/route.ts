import { NextRequest } from "next/server";
import { getConnectionCode } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Look up a single onboarding code. Ops-only: it reports which POS tenant and
 * restaurant a code is bound to, which is not something an unauthenticated
 * caller should be able to enumerate.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { code } = await ctx.params;
  const hit = await getConnectionCode(code);
  if (!hit) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ code: hit });
}
