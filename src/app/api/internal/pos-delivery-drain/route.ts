import { NextRequest } from "next/server";
import { processPendingPosDeliveries } from "@/integrations/pos/order-bridge";
import { processPendingPaymentDeliveries } from "@/integrations/pos/payment-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retry drain for PENDING POS delivery/payment rows, driven by Vercel Cron.
 *
 * Why this exists: the in-process sweep in `src/instrumentation.ts` runs on a
 * `setInterval(...).unref()`. A timer only fires while its process is resident,
 * and a Vercel serverless instance is frozen or terminated the moment the
 * response is flushed. So on Vercel that sweep effectively never ran, and any
 * order whose first attempt failed — or was cut off before completing — stayed
 * PENDING forever. Customers were charged for orders the restaurant never saw.
 *
 * The first attempt is now awaited inside the checkout request, so the common
 * case never depends on this. This endpoint is the safety net for the cases it
 * cannot cover: a POS that was briefly down, a request that timed out, or a
 * row enqueued by any other path.
 *
 * Requires `CRON_SECRET`; Vercel sends it as `Authorization: Bearer <secret>`
 * on cron invocations.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  // Fail closed when no secret is configured, otherwise this route would be an
  // unauthenticated way to force outbound traffic at the POS.
  if (!secret || !provided || provided !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const [orders, payments] = await Promise.all([
      processPendingPosDeliveries(20),
      processPendingPaymentDeliveries(20),
    ]);
    return Response.json({ ok: true, orders, payments });
  } catch (e) {
    console.error("[pos-delivery] cron drain failed", e);
    return Response.json({ ok: false, error: "drain failed" }, { status: 500 });
  }
}
