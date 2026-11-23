"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Clock3, Leaf, Percent, SlidersHorizontal, Star, Store, X } from "lucide-react";
import {
  activeFilterCount,
  paramOn,
  parseMaxDeliveryMinutes,
  parsePriceLevel,
  parseSort,
  withBrowseParam,
  DELIVERY_TIMES,
  PRICE_LEVELS,
  type BrowseParams,
} from "@/lib/browse-filter-params";
import { cn, CUISINES, priceSymbol } from "@/lib/domain";

const SORTS = [
  { key: "", label: "Relevance" },
  { key: "rating", label: "Rating" },
  { key: "fast", label: "Fastest" },
  { key: "near", label: "Nearest" },
  { key: "price-low", label: "Cost: low → high" },
  { key: "price-high", label: "Cost: high → low" },
];

type Sp = BrowseParams;
type Goto = (patch: Partial<Sp>) => void;

export function BrowseFilters({ sp }: { sp: Sp }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount = activeFilterCount(sp);
  const goto: Goto = (patch) => router.push(withBrowseParam(sp, patch));

  return (
    <>
      {/* sticky filter bar */}
      <div
        role="group"
        aria-label="Restaurant filters"
        className="sticky top-[100px] z-30 -mx-4 bg-void/80 px-4 py-2.5 backdrop-blur-xl md:top-16 md:mx-0 md:px-0"
      >
        <div className="no-scrollbar mask-fade-x flex items-center gap-2 overflow-x-auto md:mask-none">
          {/* mobile filter button */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="press flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/10 md:hidden"
          >
            <SlidersHorizontal className="size-3.5" />
            Filters
            {activeCount > 0 && (
              <span className="grid size-4.5 place-items-center rounded-full bg-chili-500 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            )}
          </button>

          {/* desktop sort + toggles */}
          <div className="mr-1 hidden shrink-0 items-center gap-2 border-r border-white/10 pr-3 md:flex">
            {SORTS.map((s) => (
              <FilterChip
                key={s.key}
                active={(sp.sort ?? "") === s.key}
                onClick={() => goto({ sort: s.key || undefined })}
              >
                {s.label}
              </FilterChip>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2 md:contents">
            <ToggleChips sp={sp} goto={goto} />
            <AvailabilityChips sp={sp} goto={goto} className="hidden md:flex" />
          </div>

          <div className="hidden shrink-0 items-center gap-2 border-l border-white/10 pl-3 md:flex">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-cream-600">Cost</span>
            <PriceChips sp={sp} goto={goto} />
          </div>

          <div className="hidden shrink-0 items-center gap-2 border-l border-white/10 pl-3 md:flex">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-cream-600">Delivery</span>
            <TimeChips sp={sp} goto={goto} />
          </div>

          {/* cuisines rail */}
          <div className="flex shrink-0 items-center gap-2 md:ml-1">
            <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-cream-600 md:block">
              Cuisines
            </span>
            {CUISINES.map((c) => (
              <FilterChip
                key={c}
                active={sp.cuisine === c}
                onClick={() => goto({ cuisine: sp.cuisine === c ? undefined : c })}
              >
                {c}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {sheetOpen && <FilterSheet sp={sp} goto={goto} activeCount={activeCount} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

function ToggleChips({ sp, goto }: { sp: Sp; goto: Goto }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <FilterChip active={paramOn(sp.minRating)} onClick={() => goto({ minRating: paramOn(sp.minRating) ? undefined : "1" })}>
        <Star className="size-3 fill-gold-400 text-gold-400" /> 4.5+
      </FilterChip>
      <FilterChip active={paramOn(sp.offers)} onClick={() => goto({ offers: paramOn(sp.offers) ? undefined : "1" })}>
        <Percent className="size-3" /> Offers
      </FilterChip>
      <FilterChip active={paramOn(sp.veg)} onClick={() => goto({ veg: paramOn(sp.veg) ? undefined : "1" })}>
        <Leaf className="size-3 text-mint-400" /> Pure veg
      </FilterChip>
    </div>
  );
}

function AvailabilityChips({ sp, goto, className }: { sp: Sp; goto: Goto; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <FilterChip
        active={paramOn(sp.open)}
        onClick={() => goto({ open: paramOn(sp.open) ? undefined : "1" })}
        label="Open now"
      >
        <Clock3 className="size-3 text-mint-400" /> Open now
      </FilterChip>
      <FilterChip
        active={paramOn(sp.delivery)}
        onClick={() => goto({ delivery: paramOn(sp.delivery) ? undefined : "1" })}
        label="Delivering now"
      >
        <Store className="size-3 text-ember-400" /> Delivering
      </FilterChip>
    </div>
  );
}

function PriceChips({ sp, goto }: { sp: Sp; goto: Goto }) {
  const active = parsePriceLevel(sp.price);
  return (
    <div className="flex shrink-0 flex-wrap gap-2" role="group" aria-label="Cost for two">
      {PRICE_LEVELS.map((level) => (
        <FilterChip
          key={level}
          active={active === level}
          onClick={() => goto({ price: active === level ? undefined : String(level) })}
          label={`Cost for two ${priceSymbol(level)}`}
        >
          {priceSymbol(level)}
        </FilterChip>
      ))}
    </div>
  );
}

function TimeChips({ sp, goto }: { sp: Sp; goto: Goto }) {
  const active = parseMaxDeliveryMinutes(sp.maxTime);
  return (
    <div className="flex shrink-0 flex-wrap gap-2" role="group" aria-label="Delivery time">
      {DELIVERY_TIMES.map((minutes) => (
        <FilterChip
          key={minutes}
          active={active === minutes}
          onClick={() => goto({ maxTime: active === minutes ? undefined : String(minutes) })}
          label={`Deliver within ${minutes} minutes`}
        >
          ≤ {minutes} min
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "press flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200",
        active
          ? "border-transparent bg-gradient-to-b from-ember-400 to-chili-600 font-semibold text-white shadow-glow"
          : "border-white/12 bg-white/[0.04] text-cream-300 hover:border-white/25 hover:bg-white/[0.08]",
      )}
    >
      {children}
      {active && <X className="size-3 opacity-80" />}
    </button>
  );
}

/* --------------------------- mobile bottom sheet -------------------------- */

function FilterSheet({
  sp,
  goto,
  activeCount,
  onClose,
}: {
  sp: Sp;
  goto: Goto;
  activeCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, lastY: 0, lastT: 0, velocity: 0, dragging: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    // Restore what was there rather than assuming `""`. Overlays stack — the
    // search overlay holds the same lock on this same property — so blanking it
    // on unmount silently unlocks a sheet that is still open. Save/restore is
    // what the search overlay already does; this was the odd one out.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, []);

  const sortLabel = useMemo(
    () => SORTS.find((s) => s.key === (parseSort(sp.sort) ?? ""))?.label ?? "Relevance",
    [sp.sort],
  );

  /* Drag-to-dismiss with rubber-band resistance and velocity fling. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // The header lives inside the gesture surface. Capturing the pointer for a
    // button press retargets the ensuing click to the handle, silently eating
    // "Clear all" taps on touch screens.
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = {
      startY: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      dragging: true,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.dragging) return;
    const now = performance.now();
    drag.current.velocity = (e.clientY - drag.current.lastY) / Math.max(1, now - drag.current.lastT);
    drag.current.lastY = e.clientY;
    drag.current.lastT = now;

    const raw = e.clientY - drag.current.startY;
    // Resistance in both directions so the sheet feels spring-loaded.
    const resisted = raw > 0 ? raw * 0.62 : raw * 0.3;
    setDragY(Math.max(-28, Math.min(320, resisted)));
  };

  const endDrag = () => {
    if (!drag.current.dragging) return;
    drag.current.dragging = false;
    const fling = drag.current.velocity > 0.55;
    if (dragY > 104 || (fling && dragY > 24)) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  // The route template keeps a transform applied, so a `fixed` sheet would be
  // bound to that wrapper and stretch past the viewport. Render it on the body.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Filters" className="fixed inset-0 z-[75] md:hidden">
      <button aria-label="Close filters" onClick={onClose} className="animate-overlay-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" />
      <div
        ref={sheetRef}
        className="glass-strong animate-sheet-up absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-3"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current.dragging ? "none" : "transform 0.46s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* drag handle — the gesture surface */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="cursor-grab touch-none pb-1 active:cursor-grabbing"
        >
          <div
            className="mx-auto my-2 h-1.5 w-12 rounded-full bg-white/25 transition-all duration-200"
            style={{ width: dragY ? `${Math.max(32, 48 + dragY * 0.35)}px` : undefined }}
          />
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-cream-50">Filters</h2>
            <button
              type="button"
              onClick={() => {
                router.push(withBrowseParam({}, { loc: sp.loc }));
              }}
              className="press text-sm font-semibold text-chili-400"
            >
              Clear all
            </button>
          </div>
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Sort by</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <FilterChip key={s.key} active={(sp.sort ?? "") === s.key} onClick={() => goto({ sort: s.key || undefined })}>
              {s.label}
            </FilterChip>
          ))}
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Quick filters</p>
        <div className="mb-6">
          <ToggleChips sp={sp} goto={goto} />
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Availability</p>
        <div className="mb-6">
          <AvailabilityChips sp={sp} goto={goto} />
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Cost for two</p>
        <div className="mb-6">
          <PriceChips sp={sp} goto={goto} />
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Delivery time</p>
        <div className="mb-7">
          <TimeChips sp={sp} goto={goto} />
          <p className="mt-2 text-xs leading-relaxed text-cream-600">
            Based on each kitchen&apos;s published delivery estimate — the same time shown on its listing.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3.5 text-sm font-bold text-white shadow-glow"
        >
          <Check className="size-4" strokeWidth={3} />
          Show results{activeCount > 0 ? ` · ${sortLabel}` : ""}
        </button>
      </div>
    </div>,
    document.body,
  );
}
