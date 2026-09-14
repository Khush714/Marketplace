export function currency(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  const code = process.env.CURRENCY || "INR";
  const locale = process.env.CURRENCY_LOCALE || "en-IN";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
  }).format(Number.isFinite(n) ? n : 0);
}

export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export function shortDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Time-of-day only (e.g. "12:31 PM") — used for timeline stamps. */
export function timeOfDay(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** PHASE 32 — compact weekday+date+time label for scheduled windows. */
export function shortDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Relative staleness label (e.g. "moments ago") — for refresh warnings. */
export function timeAgo(ms: number | null | undefined, now = Date.now()): string {
  if (ms === null || ms === undefined || ms <= 0) return "";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 120) return "moments ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)}d ago`;
}

export function orderReference(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 10);
  return `MKT-${stamp}${rand}`;
}

/**
 * Permanent marketplace restaurant id, e.g. "rst_01j8abc123xyz". Lowercase
 * base-36 so it is URL-safe and unambiguous next to uppercase MKT-/DLV- ids.
 */
export function restaurantId(): string {
  const stamp = Date.now().toString(36).slice(-8);
  const rand = Math.random().toString(36).slice(2, 12);
  return `rst_${stamp}${rand}`;
}

/**
 * Permanent marketplace menu id, e.g. "menu_01j8abc123xyz". Same scheme as
 * restaurantId() so the whole POS/marketplace identity graph shares one style.
 */
export function menuId(): string {
  const stamp = Date.now().toString(36).slice(-8);
  const rand = Math.random().toString(36).slice(2, 12);
  return `menu_${stamp}${rand}`;
}

/**
 * Permanent marketplace category id, e.g. "cat_01j8abc123xyz".
 */
export function categoryId(): string {
  const stamp = Date.now().toString(36).slice(-8);
  const rand = Math.random().toString(36).slice(2, 12);
  return `cat_${stamp}${rand}`;
}

/**
 * Permanent marketplace menu item id, e.g. "item_82931". This is the id the
 * future RestaurantAI menu sync will use to reference a dish.
 */
export function menuItemId(): string {
  const stamp = Date.now().toString(36).slice(-8);
  const rand = Math.random().toString(36).slice(2, 12);
  return `item_${stamp}${rand}`;
}

/**
 * Short-lived connection code for POS authorization, e.g. "MKT-8F29-KD92".
 * Four uppercase hex chars per segment, three segments separated by hyphens.
 */
export function connectionCode(): string {
  const seg = () =>
    Math.random().toString(16).toUpperCase().slice(2, 6);
  return `MKT-${seg()}-${seg()}`;
}
