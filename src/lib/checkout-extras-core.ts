/**
 * Pure policy for customer-selected checkout extras.
 *
 * A tip and a future slot are choices, not assertions about money or kitchen
 * state: the browser may name a bounded paise amount or an ISO timestamp, but
 * the bill is still recomputed and the slot is still validated against the
 * restaurant's own hours and closures here, before an order row exists.
 */

import type { BillBreakdown } from "./domain";
import { isWithinMerchantHours } from "./merchant-hours";
import { isRestaurantClosed, type ClosureAwareRestaurant } from "./restaurant-closure";

export const MAX_TIP_CENTS = 50_000;
export const MIN_SCHEDULE_LEAD_MS = 30 * 60 * 1000;
export const MAX_SCHEDULE_DAYS = 7;

/** A tip is collected after discounts and fees; it is never discounted itself. */
export function withTip(bill: BillBreakdown, tipCents: number): BillBreakdown {
  return { ...bill, totalCents: bill.totalCents + tipCents };
}

export type ParsedTip =
  | { ok: true; tipCents: number }
  | { ok: false; error: string };

/** Tips are integer paise, never a percentage the browser computes. */
export function parseTipCents(raw: unknown): ParsedTip {
  if (raw === undefined || raw === null || raw === "") return { ok: true, tipCents: 0 };
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TIP_CENTS) {
    return { ok: false, error: `Choose a tip up to ₹${MAX_TIP_CENTS / 100}` };
  }
  return { ok: true, tipCents: value };
}

export type ParsedSchedule =
  | { ok: true; scheduledFor: string }
  | { ok: false; error: string };

export interface SchedulableRestaurant extends ClosureAwareRestaurant {
  merchantHoursEnabled: boolean;
  merchantOpensAt: string;
  merchantClosesAt: string;
}

/** A scheduled order must be soon enough to be real and inside published hours. */
export function parseScheduledFor(raw: unknown, now = new Date()): ParsedSchedule {
  if (raw === undefined || raw === null || raw === "") return { ok: true, scheduledFor: "" };
  if (typeof raw !== "string") return { ok: false, error: "Choose a valid delivery time." };
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return { ok: false, error: "Choose a valid delivery time." };
  if (stamp < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
    return { ok: false, error: "Scheduled orders need at least 30 minutes' notice." };
  }
  if (stamp > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) {
    return { ok: false, error: "Schedule orders up to 7 days ahead." };
  }
  return { ok: true, scheduledFor: new Date(stamp).toISOString() };
}

export function scheduledSlotOpen(scheduledFor: string, restaurant: SchedulableRestaurant): boolean {
  const at = new Date(scheduledFor);
  if (Number.isNaN(at.getTime())) return false;
  if (isRestaurantClosed(restaurant, at)) return false;
  return isWithinMerchantHours(
    restaurant.merchantHoursEnabled,
    restaurant.merchantOpensAt,
    restaurant.merchantClosesAt,
    at,
  );
}

export const CANCEL_REASONS = [
  "changed_mind",
  "ordered_by_mistake",
  "delivery_too_late",
  "other",
] as const;

export const MAX_CANCEL_NOTE = 200;

/**
 * Returns a bounded, server-owned reason string. Unknown values collapse to
 * `other` instead of becoming an oracle or an unbounded note in the ledger.
 */
export function parseCancelReason(raw: unknown): string {
  if (typeof raw !== "string") return "other";
  const value = raw.trim().slice(0, MAX_CANCEL_NOTE);
  return (CANCEL_REASONS as readonly string[]).includes(value) ? value : "other";
}
