import { NextRequest } from "next/server";
import { opsListSupportThreads } from "@/db/support";
import { guardRead } from "@/lib/abuse";
import { requireOpsToken } from "@/lib/ops-auth";
import { supportStatusFilter } from "@/lib/support-core";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/support?status=OPEN|RESOLVED
 *
 * Platform ops inbox. The budget is charged before `requireOpsToken`, so a
 * caller grinding a wrong token is counted rather than answered for free. The
 * rows are order-scoped through the join and returned newest-activity first.
 */
export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "opsSupportRead");
  if (blocked) return blocked;
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const status = supportStatusFilter(req.nextUrl.searchParams.get("status"));
  const threads = await opsListSupportThreads(status);
  return Response.json({ ok: true, threads });
}
