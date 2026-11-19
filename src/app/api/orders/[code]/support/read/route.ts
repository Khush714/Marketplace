import { customerSupportThread, markSupportThreadRead } from "@/db/support";
import { guardWrite } from "@/lib/abuse";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

/**
 * Mark one order's support conversation read, POST /api/orders/[code]/support/read.
 *
 * The unread badge is server state, not a client flag in web storage — a clear
 * of localStorage must not resurrect a reply the customer already read. The
 * watermark is advanced by the same credential that reads the thread (signed
 * token or bound session), after the write guard, and the fresh thread is
 * returned so the caller can clear its badge without a second round trip.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "supportMarkRead");
  if (blocked) return blocked;
  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await markSupportThreadRead(code);
  const result = await customerSupportThread(code);
  if (!result.orderFound) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, thread: result.thread });
}
