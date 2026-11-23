"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, Leaf, Search, X } from "lucide-react";
import { DishCard } from "@/components/dish-card";
import { cn } from "@/lib/domain";
import type { MenuSection } from "@/lib/types";

export function MenuBrowser({
  sections,
  restaurantSlug,
  restaurantName,
  highlightId,
}: {
  sections: MenuSection[];
  restaurantSlug: string;
  restaurantName: string;
  highlightId: number | null;
}) {
  const [active, setActive] = useState(sections[0]?.category ?? "");
  const [highlighted, setHighlighted] = useState<number | null>(highlightId);
  const [vegOnly, setVegOnly] = useState(false);
  const [q, setQ] = useState("");
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const spying = useRef(false);

  const sectionId = useCallback((category: string) => `sec-${category.replace(/\s+/g, "-").toLowerCase()}`, []);

  const filteredSections = useMemo(() => {
    const query = q.trim().toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((item) => {
          if (vegOnly && !item.isVeg) return false;
          if (query && !item.name.toLowerCase().includes(query) && !(item.description ?? "").toLowerCase().includes(query)) return false;
          return true;
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, vegOnly, q]);

  const effectiveActive = filteredSections.some((s) => s.category === active) ? active : (filteredSections[0]?.category ?? "");

  /* Scroll spy */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (spying.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cat = entry.target.getAttribute("data-category");
            if (cat) setActive(cat);
          }
        }
      },
      { rootMargin: "-38% 0px -55% 0px", threshold: 0 },
    );
    filteredSections.forEach((s) => {
      const el = document.getElementById(sectionId(s.category));
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [filteredSections, sectionId]);

  /* Keep active tab visible */
  useEffect(() => {
    tabRefs.current.get(active)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  /* Highlighted dish from search */
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`dish-${highlightId}`);
    if (el) {
      spying.current = true;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        spying.current = false;
      }, 600);
      const t = window.setTimeout(() => setHighlighted(null), 5000);
      return () => window.clearTimeout(t);
    }
  }, [highlightId]);

  const jumpTo = (category: string) => {
    setActive(category);
    spying.current = true;
    document.getElementById(sectionId(category))?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      spying.current = false;
    }, 700);
  };

  // A listing can legitimately have no dishes yet: a POS-connected restaurant
  // whose menu has not synced, or a brand new partner who has not added a dish.
  // Rendering an empty tab rail above a blank column reads as a broken page, so
  // say what is actually true instead.
  if (sections.length === 0) {
    return (
      <div className="min-w-0">
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-14 text-center">
          <ChefHat className="size-7 text-cream-600" />
          <h3 className="mt-3.5 font-display text-lg font-bold text-cream-100">Menu being prepared</h3>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-cream-500">
            This kitchen has not published its dishes yet. Check back shortly — the menu appears
            here as soon as it is available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* sticky category tabs + mobile filters */}
      <div className="sticky top-[100px] z-30 -mx-4 bg-void/82 px-4 py-2.5 backdrop-blur-xl md:top-16 md:mx-0 md:rounded-full md:px-0 md:py-2">
        <div className="mb-2 flex items-center gap-2 md:hidden">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
            <Search className="size-4 shrink-0 text-cream-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search in menu"
              className="w-full bg-transparent text-sm text-cream-100 placeholder:text-cream-600 focus:outline-none"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear menu search" className="text-cream-500">
                <X className="size-4" />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => setVegOnly((v) => !v)}
            aria-pressed={vegOnly}
            className={cn(
              "press inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors",
              vegOnly ? "border-mint-400/40 bg-mint-500/15 text-mint-300" : "border-white/10 bg-white/[0.04] text-cream-300",
            )}
          >
            <Leaf className="size-3.5" /> Veg
          </button>
        </div>

        <div className="no-scrollbar mask-fade-x flex gap-1.5 overflow-x-auto md:mask-none">
          {filteredSections.map((s) => (
            <button
              key={s.category}
              ref={(el) => {
                if (el) tabRefs.current.set(s.category, el);
              }}
              type="button"
              onClick={() => jumpTo(s.category)}
              aria-current={effectiveActive === s.category}
              className={cn(
                "press shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all duration-300",
                effectiveActive === s.category
                  ? "bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow"
                  : "bg-white/[0.05] text-cream-400 hover:bg-white/10 hover:text-cream-200",
              )}
            >
              {s.category}
              <span className={cn("ml-1.5 text-[10px] tabular-nums", effectiveActive === s.category ? "text-white/70" : "text-cream-600")}>
                {s.items.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* sections */}
      <div className="mt-2 space-y-8 pb-4 md:space-y-5">
        {filteredSections.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-12 text-center">
            <Search className="size-6 text-cream-600" />
            <h3 className="mt-3 font-display text-lg font-bold text-cream-100">No dishes match</h3>
            <p className="mt-1 text-sm text-cream-500">Try clearing search or veg filter.</p>
          </div>
        ) : (
          filteredSections.map((s) => (
            <section
              key={s.category}
              id={sectionId(s.category)}
              data-category={s.category}
              aria-label={s.category}
              className="scroll-mt-56 md:scroll-mt-40"
            >
              <h3 className="mb-1 flex items-baseline gap-2.5 font-display text-lg font-bold tracking-tight text-cream-50">
                {s.category}
                <span className="text-xs font-medium text-cream-600">{s.items.length} dishes</span>
              </h3>
              <div className="divide-y divide-white/5">
                {s.items.map((item, itemIdx) => (
                  <DishCard
                    key={item.id}
                    item={item}
                    restaurantSlug={restaurantSlug}
                    restaurantName={restaurantName}
                    highlighted={highlighted === item.id}
                    index={itemIdx}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
