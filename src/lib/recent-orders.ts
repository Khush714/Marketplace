export type RecentOrder = {
  reference: string;
  restaurantSlug: string;
  restaurantName: string;
  total: number;
  placedAt: string;
};

export const RECENT_ORDERS_KEY = "marketplace_recent_orders";

/** Read persisted recent orders (best-effort, most recent first). */
export function readRecentOrders(): RecentOrder[] {
  try {
    const raw = localStorage.getItem(RECENT_ORDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as RecentOrder[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prepend a placed order, dedupe by reference, cap the list. */
export function persistRecentOrder(order: RecentOrder): RecentOrder[] {
  const next = [order, ...readRecentOrders().filter((o) => o.reference !== order.reference)].slice(0, 20);
  try {
    localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or unavailable — history is best-effort.
  }
  return next;
}