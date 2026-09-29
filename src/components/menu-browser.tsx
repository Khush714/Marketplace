"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChefHat } from "lucide-react";
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
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const spying = useRef(false);

  const sectionId = useCallback((category: string) => `sec-${category.replace(/\s+/g, "-").toLowerCase()}`, []);

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
    sections.forEach((s) => {
      const el = document.getElementById(sectionId(s.category));
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections, sectionId]);

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
      {/* sticky category tabs */}
      <div className="sticky top-[108px] z-30 -mx-4 bg-void/82 px-4 py-2.5 backdrop-blur-xl md:top-16 md:mx-0 md:rounded-full md:px-0">
        <div className="no-scrollbar mask-fade-x flex gap-1.5 overflow-x-auto md:mask-none">
          {sections.map((s) => (
            <button
              key={s.category}
              ref={(el) => {
                if (el) tabRefs.current.set(s.category, el);
              }}
              type="button"
              onClick={() => jumpTo(s.category)}
              aria-current={active === s.category}
              className={cn(
                "press shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all duration-300",
                active === s.category
                  ? "bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow"
                  : "bg-white/[0.05] text-cream-400 hover:bg-white/10 hover:text-cream-200",
              )}
            >
              {s.category}
              <span className={cn("ml-1.5 text-[10px] tabular-nums", active === s.category ? "text-white/70" : "text-cream-600")}>
                {s.items.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* sections */}
      <div className="mt-2 space-y-8 pb-4">
        {sections.map((s) => (
          <section
            key={s.category}
            id={sectionId(s.category)}
            data-category={s.category}
            aria-label={s.category}
            className="scroll-mt-44 md:scroll-mt-40"
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
        ))}
      </div>
    </div>
  );
}
