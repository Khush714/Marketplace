/**
 * Marketplace-side view of the Merchant App's temporary closures and leave days.
 *
 * The merchant remains authoritative for the values (they are written through
 * the paired listing API), but the Marketplace must enforce them itself for
 * discovery and checkout — otherwise a closed kitchen still takes money.
 * Timed closures are stored as absolute stamps and expire without a cron.
 */

export type ScheduledLeave = { date: string; reason: string };
export type ClosureAwareRestaurant = {
  isActive?: boolean;
  isOpen?: boolean;
  closureReason?: string | null;
  closureUntil?: string | Date | null;
  scheduledLeaves?: ScheduledLeave[] | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_REASON = 120;
const MAX_LEAVE_REASON = 80;
const MAX_LEAVES = 60;
const MAX_CLOSURE_MS = 30 * 86_400_000;

export function indiaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function cleanClosureReason(value: unknown, max = MAX_REASON): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("Enter a valid reason.");
  const reason = value.trim().slice(0, max);
  if (CONTROL.test(reason)) throw new Error("Enter a valid reason.");
  return reason;
}

export function parseClosureUntil(value: unknown, now = new Date()): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Choose a valid reopening time.");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= now.getTime()) throw new Error("Choose a reopening time in the future.");
  if (time > now.getTime() + MAX_CLOSURE_MS) throw new Error("Temporary closures can last at most 30 days.");
  return new Date(time).toISOString();
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error("Choose valid leave dates.");
  const [year, month, day] = value.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error("Choose valid leave dates.");
  }
  return value;
}

export function parseScheduledLeaves(value: unknown): ScheduledLeave[] {
  if (!Array.isArray(value)) throw new Error("Invalid leave schedule.");
  if (value.length > MAX_LEAVES) throw new Error(`Keep at most ${MAX_LEAVES} leave days.`);
  const seen = new Set<string>();
  const leaves: ScheduledLeave[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid leave day.");
    const row = entry as Record<string, unknown>;
    const date = validDate(row.date);
    if (seen.has(date)) continue;
    seen.add(date);
    leaves.push({ date, reason: cleanClosureReason(row.reason, MAX_LEAVE_REASON) });
  }
  return leaves.sort((a, b) => a.date.localeCompare(b.date));
}

export function isRestaurantClosed(restaurant: ClosureAwareRestaurant, now = new Date()): boolean {
  const baseOpen = restaurant.isActive === undefined ? restaurant.isOpen !== false : restaurant.isActive;
  if (!baseOpen) return true;
  const stamp = restaurant.closureUntil ? new Date(restaurant.closureUntil) : null;
  if (stamp && !Number.isNaN(stamp.getTime()) && stamp.getTime() > now.getTime()) return true;
  const today = indiaDate(now);
  return (restaurant.scheduledLeaves ?? []).some((leave) => leave?.date === today);
}

export function closedReason(restaurant: ClosureAwareRestaurant, now = new Date()): string {
  const stamp = restaurant.closureUntil ? new Date(restaurant.closureUntil) : null;
  if (stamp && !Number.isNaN(stamp.getTime()) && stamp.getTime() > now.getTime()) {
    return restaurant.closureReason || "Closed temporarily";
  }
  const today = indiaDate(now);
  const leave = (restaurant.scheduledLeaves ?? []).find((entry) => entry?.date === today);
  return leave?.reason || restaurant.closureReason || "Temporarily closed";
}
