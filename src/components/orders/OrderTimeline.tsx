"use client";

import { legacyToCanonical, ORDER_MAINLINE, statusLabel } from "@/lib/order-lifecycle";
import { timeOfDay } from "@/lib/format";
import type { PublicOrder } from "@/lib/marketplace";
import type { OrderEventType } from "@/lib/order-events";
import { formatDistance } from "@/lib/geo";
import { CheckIcon } from "@/components/ui/icons";

/**
 * PHASE 15 — order timeline from the API's append-only audit trail
 * (`order.timeline`, written by the POS). Rendered in lifecycle order, oldest
 * first, matching the canonical flow:
 *
 *   ORDER TIMELINE
 *   ✓ Order placed         12:31 PM
 *   ✓ Restaurant accepted  12:33 PM
 *   ✓ Preparing            12:35 PM
 *   ○ Ready
 *   ○ Picked up
 *   ○ Delivered
 *
 * The API's `label` and `at` timestamps are used verbatim — no timestamps are
 * ever manufactured here; steps with no corresponding event are shown as
 * pending (○) with no time. PHASE 9 — the step list IS the lifecycle's
 * ORDER_MAINLINE, so a contract change is reflected automatically.
 *
 * PHASE 11 — the Delivery block surfaces rider milestones taken straight from
 * the full audit trail (`order.events`): every RIDER_* line was authored
 * server-side (DELIVERY_ASSIGNED / RIDER_ACCEPTED / RIDER_NEARBY / …). The
 * browser never invents milestones — it only owns the display glyphs and the
 * "🚴 Raj is 1.1 km away" phrasing around backend-authorised meta.
 */
const FORWARD_STEPS = ORDER_MAINLINE;

/** Delivery milestones the customer timeline renders (audit-trail guarded). */
const DELIVERY_GUARD = new Set<OrderEventType>([
  "DELIVERY_ASSIGNED",
  "RIDER_ACCEPTED",
  "RIDER_AT_RESTAURANT",
  "RIDER_PICKED_UP",
  "RIDER_OUT_FOR_DELIVERY",
  "RIDER_NEARBY",
  "RIDER_ARRIVING",
  "RIDER_CANCELLED",
]);

/** Canonical delivery order for the milestone rows (matches the lifecycle). */
const DELIVERY_ORDER: readonly OrderEventType[] = [
  "DELIVERY_ASSIGNED",
  "RIDER_ACCEPTED",
  "RIDER_AT_RESTAURANT",
  "RIDER_PICKED_UP",
  "RIDER_OUT_FOR_DELIVERY",
  "RIDER_NEARBY",
  "RIDER_ARRIVING",
  "RIDER_CANCELLED",
];

const DELIVERY_ICON: Record<string, string> = {
  DELIVERY_ASSIGNED: "🛵",
  RIDER_ACCEPTED: "🛵",
  RIDER_AT_RESTAURANT: "🏪",
  RIDER_PICKED_UP: "🍱",
  RIDER_OUT_FOR_DELIVERY: "🛵",
  RIDER_NEARBY: "📍",
  RIDER_ARRIVING: "🏠",
  RIDER_CANCELLED: "↩️",
};

/** Personalised verb per milestone (backed by the rider name in event meta). */
const DELIVERY_VERB: Partial<Record<OrderEventType, string>> = {
  RIDER_ACCEPTED: "accepted the delivery",
  RIDER_AT_RESTAURANT: "arrived at the restaurant",
  RIDER_PICKED_UP: "picked up your order",
  RIDER_OUT_FOR_DELIVERY: "is on the way",
  RIDER_ARRIVING: "is arriving",
};

export function OrderTimeline({
  events,
  audit,
}: {
  events: PublicOrder["timeline"];
  audit?: PublicOrder["events"];
}) {
  if (events.length === 0) return null;

  // First event per canonical status (the API returns chronological order).
  const byStatus = new Map<string, PublicOrder["timeline"][number]>();
  for (const e of events) {
    const canonical = legacyToCanonical(e.status);
    if (!byStatus.has(canonical)) byStatus.set(canonical, e);
  }

  // PHASE 11 — delivery milestones, one row per event type in canonical order.
  const deliveryRows: { type: OrderEventType; event: PublicOrder["events"][number] }[] = [];
  if (audit && audit.length > 0) {
    const firstByType = new Map<OrderEventType, PublicOrder["events"][number]>();
    for (const e of audit) {
      if (DELIVERY_GUARD.has(e.type) && !firstByType.has(e.type)) {
        firstByType.set(e.type, e);
      }
    }
    for (const t of DELIVERY_ORDER) {
      const e = firstByType.get(t);
      if (e) deliveryRows.push({ type: t, event: e });
    }
  }

  const cancelled = byStatus.get("cancelled");
  const rejected = byStatus.get("rejected");

  return (
    <section className="mt-6 sm:mt-8">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
        Order timeline
      </h2>
      <ol className="mt-4">
        {FORWARD_STEPS.map((s) => {
          const event = byStatus.get(s);
          return event ? (
            <DoneRow key={s} event={event} tone="orange" />
          ) : (
            <li key={s} className="flex items-center gap-3 pb-4">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 bg-ink-850 text-xs text-white/40">
                ○
              </span>
              <span className="flex-1 text-sm font-semibold text-white/40">
                {statusLabel(s)}
              </span>
            </li>
          );
        })}

        {cancelled && <DoneRow event={cancelled} tone="rose" />}
        {rejected && <DoneRow event={rejected} tone="rose" />}
      </ol>

      {deliveryRows.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
            Delivery
          </h3>
          <ol className="mt-4">
            {deliveryRows.map(({ type, event }) => (
              <DeliveryRow key={type} type={type} event={event} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function DeliveryRow({
  type,
  event,
}: {
  type: OrderEventType;
  event: PublicOrder["events"][number];
}) {
  const meta = event.meta ?? {};
  const name =
    typeof meta.riderName === "string"
      ? meta.riderName
      : typeof meta.partnerName === "string"
        ? meta.partnerName
        : null;

  return (
    <li className="pb-4">
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 bg-ink-850 text-[12px] leading-none">
          {DELIVERY_ICON[type] ?? "🛵"}
        </span>
        <span className="flex-1 text-sm font-semibold text-white">
          {deliveryLabel(type, event, name)}
        </span>
      </div>
      <p className="mt-1 pl-9 text-xs tabular-nums text-white/40">
        {timeOfDay(event.at)}
      </p>
    </li>
  );
}

/** Build the customer-facing line from backend meta, never from a guess. */
function deliveryLabel(
  type: OrderEventType,
  event: PublicOrder["events"][number],
  name: string | null,
): string {
  if (type === "RIDER_NEARBY") {
    const km =
      typeof event.meta?.distanceKm === "number" ? event.meta.distanceKm : null;
    if (km != null) {
      const dist = formatDistance(km);
      return name ? `${name} is ${dist} away` : `${dist} away`;
    }
    return event.label;
  }

  if (type === "DELIVERY_ASSIGNED") {
    if (name) return `${name} assigned to your order`;
    if (typeof event.meta?.note === "string" && event.meta.note) {
      return event.meta.note;
    }
    return event.label;
  }

  if (type === "RIDER_CANCELLED" || !name) return event.label;

  const verb = DELIVERY_VERB[type];
  return verb ? `${name} ${verb}` : event.label;
}

function DoneRow({
  event,
  tone,
}: {
  event: PublicOrder["timeline"][number];
  tone: "orange" | "rose";
}) {
  return (
    <li className="pb-4">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-ink-950 ${
            tone === "rose" ? "bg-rose-500" : "bg-ember-500"
          }`}
        >
          <CheckIcon className="text-xs" />
        </span>
        <span
          className={`text-sm font-semibold ${
            tone === "rose" ? "text-rose-400" : "text-white"
          }`}
        >
          {event.label}
        </span>
      </div>
      <p className="mt-1 pl-9 text-xs tabular-nums text-white/40">
        {timeOfDay(event.at)}
      </p>
    </li>
  );
}