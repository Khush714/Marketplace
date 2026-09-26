/**
 * Next.js instrumentation — process-level hooks (`register` runs once when the
 * server starts). Owns the Phase 4 POS delivery drain: the periodic worker that
 * bumps every due PENDING delivery journal row forward until DELIVERED (or
 * terminal FAILED). Also runs an immediate catch-up sweep so an enqueue that
 * happened while no loop was running gets delivered promptly on boot.
 *
 * Guards:
 *  - env-gated (POS_DELIVERY_DRAIN_ENABLED !== "false", plus POS_BASE_URL and
 *    DATABASE_URL must exist) so demo builds never spawn timers.
 *  - a module-level in-flight flag prevents overlapping sweeps when the drain
 *    interval is smaller than one pass.
 *  - the loop uses the same process the server runs in, so `next build`'s
 *    register() invocation is a harmless no-op when the env gates are closed.
 */
export const runtime = "nodejs";

let drainTimer: NodeJS.Timeout | null = null;
let draining = false;
let disposeRegistered = false;

function drainEnabled(): boolean {
  return (
    process.env.POS_DELIVERY_DRAIN_ENABLED !== "false" &&
    !!process.env.POS_BASE_URL &&
    !!process.env.DATABASE_URL
  );
}

function drainIntervalMs(): number {
  const raw = Number(process.env.POS_DELIVERY_DRAIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 15000;
}

async function sweepPosDeliveries(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const { processPendingPosDeliveries } = await import("@/integrations/pos/order-bridge");
    const orderSummary = await processPendingPosDeliveries(20);
    const { processPendingPaymentDeliveries } = await import("@/integrations/pos/payment-bridge");
    const paymentSummary = await processPendingPaymentDeliveries(20);
    if (orderSummary.processed || paymentSummary.processed) {
      console.log(
        `[pos-delivery] drain pass — orders ${JSON.stringify(orderSummary)}, payments ${JSON.stringify(paymentSummary)}`,
      );
    }
  } catch (e) {
    console.error("[pos-delivery] drain sweep failed", e);
  } finally {
    draining = false;
  }
}

export async function register() {
  if (!drainEnabled()) return;

  // First pass right away (catch up anything enqueued during downtime).
  void sweepPosDeliveries().catch(() => {});

  if (drainTimer || disposeRegistered) return;
  drainTimer = setInterval(() => void sweepPosDeliveries().catch(() => {}), drainIntervalMs());
  drainTimer.unref?.();

  disposeRegistered = true;
  // Called on server shutdown in Node runtimes when the platform supports it.
  const shutdown = () => {
    if (drainTimer) clearInterval(drainTimer);
    drainTimer = null;
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}