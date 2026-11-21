export const runtime = 'nodejs';

let drainTimer: NodeJS.Timeout | null = null;
let draining = false;
let disposeRegistered = false;

function isVercel(): boolean {
  return !!(process.env.VERCEL || process.env.VERCEL_ENV);
}

function drainEnabled(): boolean {
  if (process.env.POS_DELIVERY_DRAIN_ENABLED === 'false') return false;
  if (isVercel()) return false;
  return !!(process.env.POS_BASE_URL && process.env.DATABASE_URL);
}

function drainIntervalMs(): number {
  const raw = Number(process.env.POS_DELIVERY_DRAIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 15000;
}

async function sweepPosDeliveries(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const { processPendingPosDeliveries } = await import('@/integrations/pos/order-bridge');
    const orderSummary = await processPendingPosDeliveries(20);
    const { processPendingPaymentDeliveries } = await import('@/integrations/pos/payment-bridge');
    const paymentSummary = await processPendingPaymentDeliveries(20);
    if (orderSummary.processed || paymentSummary.processed) {
      console.log(`[pos-delivery] drain pass - orders ${JSON.stringify(orderSummary)}, payments ${JSON.stringify(paymentSummary)}`);
    }
  } catch (e) {
    console.error('[pos-delivery] drain sweep failed', e);
  } finally {
    draining = false;
  }
}

export async function register() {
  if (!drainEnabled()) return;
  void sweepPosDeliveries().catch(() => {});
  if (drainTimer || disposeRegistered) return;
  drainTimer = setInterval(() => void sweepPosDeliveries().catch(() => {}), drainIntervalMs());
  drainTimer.unref?.();
  disposeRegistered = true;
  const shutdown = () => {
    if (drainTimer) clearInterval(drainTimer);
    drainTimer = null;
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
