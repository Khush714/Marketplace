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
