"use client";

import { legacyToCanonical, statusLabel } from "@/lib/order-lifecycle";
import { timeOfDay } from "@/lib/format";
import type { PublicOrder } from "@/lib/marketplace";

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
 *   ○ Completed
 *
 * The API's `label` and `at` timestamps are used verbatim — no timestamps are
 * ever manufactured here; steps with no corresponding event are shown as
 * pending (○) with no time.
 */
const FORWARD_STEPS = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "completed",
] as const;

export function OrderTimeline({
  events,
}: {
  events: PublicOrder["timeline"];
}) {
  if (events.length === 0) return null;

  // First event per canonical status (the API returns chronological order).
  const byStatus = new Map<string, PublicOrder["timeline"][number]>();
  for (const e of events) {
    const canonical = legacyToCanonical(e.status);
    if (!byStatus.has(canonical)) byStatus.set(canonical, e);
  }

  const cancelled = byStatus.get("cancelled");

  // Matches the spec layout: check + label on line one, the API timestamp on
  // its own indented line beneath (pending steps show no time at all).
  const DoneRow = ({
    event,
    tone,
  }: {
    event: PublicOrder["timeline"][number];
    tone: "orange" | "rose";
  }) => (
    <li className="pb-4">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${
            tone === "rose" ? "bg-rose-500" : "bg-orange-500"
          }`}
        >
          ✓
        </span>
        <span
          className={`text-sm font-semibold ${
            tone === "rose" ? "text-rose-700" : "text-slate-900"
          }`}
        >
          {event.label}
        </span>
      </div>
      <p className="mt-1 pl-9 text-xs tabular-nums text-slate-400">
        {timeOfDay(event.at)}
      </p>
    </li>
  );

  return (
    <section className="mt-6 sm:mt-8">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
        Order timeline
      </h2>
      <ol className="mt-4">
        {FORWARD_STEPS.map((s) => {
          const event = byStatus.get(s);
          return event ? (
            <DoneRow key={s} event={event} tone="orange" />
          ) : (
            <li key={s} className="flex items-center gap-3 pb-4">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-xs text-slate-400">
                ○
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-400">
                {statusLabel(s)}
              </span>
            </li>
          );
        })}

        {cancelled && <DoneRow event={cancelled} tone="rose" />}
      </ol>
    </section>
  );
}