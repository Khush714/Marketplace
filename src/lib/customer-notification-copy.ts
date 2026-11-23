/**
 * Pure, shared rules for the browser-scoped customer notification inbox.
 * No DB, server-only or network imports: the browser and the tests use the same rules.
 */

export type CustomerNotificationKind =
  | "order_placed"
  | "order_status"
  | "delivery"
  | "payment"
  | "feedback_reply";

/** High-entropy, URL-safe anonymous inbox token. Only its SHA-256 hash is stored server-side. */
export const INBOX_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Versioned localStorage key, matching the app's `crave.*` convention. */
export const INBOX_STORAGE_KEY = "crave.inbox.v1";

export function isInboxToken(value: unknown): value is string {
  return typeof value === "string" && INBOX_TOKEN_PATTERN.test(value);
}

/** Two UUIDs give 64 hex characters of browser-side entropy. */
export function newInboxToken(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "") + globalThis.crypto.randomUUID().replaceAll("-", "");
}

/** Read a restored token without creating one (safe on the server). */
export function readInboxToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const saved = localStorage.getItem(INBOX_STORAGE_KEY);
    return isInboxToken(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Restore or mint the device's anonymous inbox token. Never called during SSR;
 * the browser guard keeps the server bundle from touching localStorage.
 */
export function ensureInboxToken(): string {
  const saved = readInboxToken();
  if (saved) return saved;
  const token = newInboxToken();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(INBOX_STORAGE_KEY, token);
    } catch {
      /* private mode or a full quota still gets an in-memory token for this tab */
    }
  }
  return token;
}

export type NotificationCopy = { title: string; body: string };

const STATUS_COPY: Record<string, NotificationCopy> = {
  PLACED: { title: "Order placed", body: "We've sent your order to the kitchen." },
  ACCEPTED: { title: "Order accepted", body: "The kitchen has accepted your order." },
  PREPARING: { title: "Preparing your food", body: "Your order is being prepared now." },
  READY: { title: "Your order is ready", body: "The kitchen has finished preparing your order." },
  OUT_FOR_DELIVERY: { title: "Out for delivery", body: "Your order is on its way." },
  DELIVERED: { title: "Delivered", body: "Your order has been delivered. Enjoy!" },
  COMPLETED: { title: "Order completed", body: "Thanks for ordering. Enjoy your food!" },
  CANCELLED: { title: "Order cancelled", body: "Your order was cancelled. Check your order for details." },
  REJECTED: { title: "Order couldn't be accepted", body: "The kitchen couldn't accept this order. Check your order for details." },
};

const DELIVERY_COPY: Record<string, NotificationCopy> = {
  OUT_FOR_DELIVERY: { title: "Out for delivery", body: "Your order is on its way." },
  DELIVERED: { title: "Delivery confirmed", body: "Your order has been delivered. Enjoy!" },
  COMPLETED: { title: "Delivery confirmed", body: "Your order has been completed. Enjoy!" },
};

const PAYMENT_COPY: Record<string, NotificationCopy> = {
  PAID: { title: "Payment confirmed", body: "We've received your payment." },
  PAYMENT_PENDING: { title: "Payment received", body: "Your payment is being confirmed." },
  AUTHORIZED: { title: "Payment authorised", body: "Your payment has been authorised." },
  FAILED: { title: "Payment failed", body: "We couldn't confirm your payment. You can retry from your order." },
  REFUND_PENDING: { title: "Refund started", body: "Your refund has been requested. It can take a few days to appear." },
  PARTIALLY_REFUNDED: { title: "Partial refund recorded", body: "A partial refund has been recorded for your order." },
  REFUNDED: { title: "Refund recorded", body: "A refund has been recorded for your order." },
  PAYMENT_CANCELLED: { title: "Payment cancelled", body: "Your payment was cancelled for this order." },
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

export function notificationCopy(kind: CustomerNotificationKind, detail = ""): NotificationCopy {
  if (kind === "order_placed") return { title: "Order placed", body: "We've sent your order to the kitchen." };
  if (kind === "feedback_reply") return { title: "The kitchen replied", body: "The kitchen replied to your review. Open your order to read it." };
  const key = detail.trim().toUpperCase();
  const map = kind === "order_status" ? STATUS_COPY : kind === "delivery" ? DELIVERY_COPY : PAYMENT_COPY;
  if (key && map[key]) return map[key];
  const label = detail ? humanize(detail) : "update";
  return {
    title: kind === "delivery" ? "Delivery update" : kind === "payment" ? "Payment update" : "Order update",
    body: `Your ${label} is now recorded.`,
  };
}

/**
 * Stable per-order key. Replayed webhooks and repeated status writes collapse into
 * one notification per kind/detail without needing a distributed lock.
 */
export function notificationDedupeKey(orderId: number | string, kind: CustomerNotificationKind, detail = ""): string {
  return `${orderId}:${kind}:${detail || "default"}`;
}
