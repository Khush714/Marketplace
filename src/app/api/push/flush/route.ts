import { flushOutbox } from "@/lib/push";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/flush — sweep the push delivery queue.
 *
 * Auth: signed-in admin cookie OR the CRON_SECRET bearer token (used by a
 * Vercel cron to keep retries/broadcast moving when no order triggered a
 * targeted flush).
 */
async function authorized(req: Request): Promise<boolean> {
  if (await requireAdmin()) return true;
  const bearer = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && bearer === `Bearer ${expected}`);
}

export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await flushOutbox(100);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("push flush sweep failed", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "flush failed" },
      { status: 500 },
    );
  }
}