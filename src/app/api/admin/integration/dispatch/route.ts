import { requireAdmin } from "@/lib/admin-auth";
import { dispatchPendingWebhooks } from "@/lib/webhook-outbox";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/integration/dispatch
 * Manual trigger for the outbound webhook outbox — delivers every due event
 * to connected restaurant endpoints. A scheduler can call this on an interval;
 * the implementation is idempotent and claims each row exactly once.
 */
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await dispatchPendingWebhooks({
    limit: typeof body.limit === "number" ? body.limit : 25,
  });
  return Response.json(result);
}