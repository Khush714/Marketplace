import { db } from "@/db";
import { pushSubscriptions, notifications, orders } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// web-push is a CJS module — import it lazily so the client bundle never
// sees it and so typechecking with `@types/web-push` works.
let webpushPromise: Promise<typeof import("web-push")> | null = null;

function loadWebpush(): Promise<typeof import("web-push")> {
  if (!webpushPromise) {
    webpushPromise =
      typeof window !== "undefined"
        ? Promise.reject(new Error("web-push is server-only"))
        : (import("web-push") as Promise<typeof import("web-push")>);
  }
  return webpushPromise;
}

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ?? "mailto:admin@marketplace.local";

export const pushEnabled = Boolean(
  VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && !VAPID_PUBLIC_KEY.includes("XXXX"),
);

async function ensureConfigured() {
  if (!pushEnabled) {
    throw new Error(
      "Web Push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
  }
  const webpush = await loadWebpush();
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  return webpush;
}

export function kindToTitle(kind: string): string {
  switch (kind) {
    case "order_placed":
      return "Order placed";
    case "order_accepted":
      return "Order accepted";
    case "order_ready":
      return "Order ready";
    case "order_completed":
      return "Order completed";
    case "order_delivered":
      return "Order delivered";
    case "order_rejected":
      return "Order rejected";
    case "order_scheduled":
      return "Order scheduled";
    case "payment_successful":
      return "Payment received";
    case "delivery_assigned":
      return "Delivery partner assigned";
    case "delivery_picked_up":
      return "Order picked up";
    case "delivery_out_for_delivery":
      return "Out for delivery";
    case "delivery_arriving":
      return "Order arriving soon";
    default:
      return "TABLZ";
  }
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind?: string;
};

/**
 * Send a push notification to every live, non-revoked subscription a customer
 * holds. Invalid endpoints (410 Gone / 404) are lazily revoked.
 */
export async function sendPushToCustomer(
  customerId: number,
  payload: PushPayload,
): Promise<{ sent: number; expired: number; failed: number }> {
  const webpush = await ensureConfigured();

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.customerId, customerId),
        eq(pushSubscriptions.revoked, false),
      ),
    );

  let sent = 0;
  let expired = 0;
  let failed = 0;
  for (const sub of subs) {
    const result = await sendRaw(webpush, sub, payload);
    if (result === "ok") {
      sent++;
      await db
        .update(pushSubscriptions)
        .set({ lastSentAt: new Date(), lastError: null })
        .where(eq(pushSubscriptions.id, sub.id));
    } else if (result === "gone") {
      expired++;
      await db
        .update(pushSubscriptions)
        .set({ revoked: true, lastError: "Endpoint no longer valid" })
        .where(eq(pushSubscriptions.id, sub.id));
    } else {
      failed++;
      await db
        .update(pushSubscriptions)
        .set({ lastError: result })
        .where(eq(pushSubscriptions.id, sub.id));
    }
  }
  return { sent, expired, failed };
}

type SendStatus = "ok" | "gone" | string;

async function sendRaw(
  webpush: typeof import("web-push"),
  sub: typeof pushSubscriptions.$inferSelect,
  payload: PushPayload,
): Promise<SendStatus> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/profile",
        ...(payload.kind ? { kind: payload.kind } : {}),
      }),
    );
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) return "gone";
    return e instanceof Error ? e.message : "unknown push error";
  }
}

/**
 * Resolve the in-app navigation URL for an order-scoped notification.
 */
async function referenceUrl(orderId: number | null): Promise<string | null> {
  if (!orderId) return null;
  const [o] = await db
    .select({ reference: orders.reference })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return o ? `/orders/${encodeURIComponent(o.reference)}` : null;
}

/**
 * Flush a single queued push notification: send it to all the customer's
 * subscriptions and record the outcome.
 */
async function flushNotification(webpush: Promise<typeof import("web-push")>, n: typeof notifications.$inferSelect): Promise<"delivered" | "retry"> {
  // Broadcast/system notification with no recipient: nothing to deliver.
  if (!n.customerId) return "delivered";

  const url = await referenceUrl(n.orderId);
  const result = await sendPushToCustomer(n.customerId, {
    title: kindToTitle(n.kind),
    body: n.message,
    url: url ?? undefined,
    kind: n.kind,
  });

  // Delivered if at least one device got it OR the customer has no push
  // subscriptions at all (the in-app feed is still the channel).
  if (result.sent > 0 || (result.failed === 0 && result.expired === 0)) {
    return "delivered";
  }
  return "retry";
}

function markDelivered(id: number): Promise<unknown> {
  return db
    .update(notifications)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(notifications.id, id));
}

function markRetry(id: number): Promise<unknown> {
  return db
    .update(notifications)
    .set({ status: "pending_retry" })
    .where(eq(notifications.id, id));
}

/**
 * Targeted delivery — flush the queued push notifications for a single order.
 * Call this right after an order is placed or transitions so the customer gets
 * the push within the same request lifecycle.
 */
export async function flushOrder(
  orderId: number,
  limit = 10,
): Promise<{ processed: number; delivered: number }> {
  if (!pushEnabled) return { processed: 0, delivered: 0 };

  const webpush = ensureConfigured();
  const queued = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.orderId, orderId),
        eq(notifications.channel, "push"),
        eq(notifications.status, "queued"),
      ),
    )
    .limit(limit);

  let delivered = 0;
  for (const n of queued) {
    const outcome = await flushNotification(webpush, n);
    if (outcome === "delivered") {
      delivered++;
      await markDelivered(n.id);
    } else {
      await markRetry(n.id);
    }
  }
  return { processed: queued.length, delivered };
}

/**
 * Sweep worker — flush any queued/pending push notifications regardless of
 * order. Powers the cron endpoint (`/api/push/flush`) and catches stragglers
 * the targeted path missed (e.g. notifications enqueued for broadcast).
 */
export async function flushOutbox(limit = 50): Promise<{
  processed: number;
  delivered: number;
  retry: number;
}> {
  if (!pushEnabled) return { processed: 0, delivered: 0, retry: 0 };

  const webpush = ensureConfigured();
  const queued = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.channel, "push"), eq(notifications.status, "queued")))
    .orderBy(notifications.id)
    .limit(limit);

  let delivered = 0;
  let retry = 0;
  for (const n of queued) {
    const outcome = await flushNotification(webpush, n);
    if (outcome === "delivered") {
      delivered++;
      await markDelivered(n.id);
    } else {
      retry++;
      await markRetry(n.id);
    }
  }
  return { processed: queued.length, delivered, retry };
}

/** Revoke a subscription (unsubscribe) — endpoint match required. */
export async function removePushSubscription(endpoint: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ revoked: true })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function countActiveSubscriptions(customerId?: number): Promise<number> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.revoked, false),
        ...(customerId ? [eq(pushSubscriptions.customerId, customerId)] : []),
      ),
    );
  return rows.length;
}