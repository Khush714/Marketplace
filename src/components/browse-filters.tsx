"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Leaf, Percent, SlidersHorizontal, Star, X } from "lucide-react";
import { cn, CUISINES, withLoc } from "@/lib/domain";

const SORTS = [
  { key: "", label: "Relevance" },
  { key: "rating", label: "Rating" },
  { key: "fast", label: "Fastest" },
  { key: "near", label: "Nearest" },
  { key: "price-low", label: "Cost: low → high" },
  { key: "price-high", label: "Cost: high → low" },
];

interface Sp {
  q?: string;
  cuisine?: string;
  sort?: string;
  offers?: string;
  minRating?: string;
  veg?: string;
  loc?: string;
}

export function BrowseFilters({ sp }: { sp: Sp }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount =
    (sp.offers === "1" ? 1 : 0) + (sp.minRating === "1" ? 1 : 0) + (sp.veg === "1" ? 1 : 0) + (sp.sort ? 1 : 0);

  const goto = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged: Sp = { ...sp, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    router.push(`/restaurants${params.size ? `?${params.toString()}` : ""}`);
  };

  return (
    <>
      {/* sticky filter bar */}
      <div className="sticky top-[108px] z-30 -mx-4 bg-void/80 px-4 py-2.5 backdrop-blur-xl md:top-16 md:mx-0 md:px-0">
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
          <div className="mr-1 hidden items-center gap-2 border-r border-white/10 pr-3 md:flex">
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

          <div className="hidden md:block">
            <ToggleChips sp={sp} goto={goto} />
          </div>

          {/* cuisines rail */}
          <div className="flex items-center gap-2 md:ml-1">
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

function ToggleChips({ sp, goto }: { sp: Sp; goto: (patch: Record<string, string | undefined>) => void }) {
  return (
    <div className="flex items-center gap-2">
      <FilterChip active={sp.minRating === "1"} onClick={() => goto({ minRating: sp.minRating === "1" ? undefined : "1" })}>
        <Star className="size-3 fill-gold-400 text-gold-400" /> 4.5+
      </FilterChip>
      <FilterChip active={sp.offers === "1"} onClick={() => goto({ offers: sp.offers === "1" ? undefined : "1" })}>
        <Percent className="size-3" /> Offers
      </FilterChip>
      <FilterChip active={sp.veg === "1"} onClick={() => goto({ veg: sp.veg === "1" ? undefined : "1" })}>
        <Leaf className="size-3 text-mint-400" /> Pure veg
      </FilterChip>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
  goto: (patch: Record<string, string | undefined>) => void;
  activeCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, lastY: 0, lastT: 0, velocity: 0, dragging: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, []);

  const sortLabel = useMemo(() => SORTS.find((s) => s.key === (sp.sort ?? ""))?.label ?? "Relevance", [sp.sort]);

  /* Drag-to-dismiss with rubber-band resistance and velocity fling. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

  return (
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
                router.push(withLoc("/restaurants", sp.loc ?? ""));
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

        <button
          type="button"
          onClick={onClose}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3.5 text-sm font-bold text-white shadow-glow"
        >
          <Check className="size-4" strokeWidth={3} />
          Show results{activeCount > 0 ? ` · ${sortLabel}` : ""}
        </button>
      </div>
    </div>
  );
}
