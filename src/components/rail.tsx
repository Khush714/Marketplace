"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Horizontal snap rail with edge-fade mask and desktop arrow controls. */
export function Rail({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.85, 560), behavior: "smooth" });
  };

  return (
    <div className="group/rail relative">
      <div
        ref={ref}
        role="region"
        aria-label={ariaLabel}
        className="no-scrollbar mask-fade-x flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-1 py-1"
      >
        {children}
      </div>
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-1)}
        className="press glass-strong absolute -left-2 top-1/2 z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full opacity-0 transition-opacity duration-300 hover:bg-white/15 group-hover/rail:opacity-100 md:grid"
      >
        <ChevronLeft className="size-5 text-cream-50" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(1)}
        className="press glass-strong absolute -right-2 top-1/2 z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full opacity-0 transition-opacity duration-300 hover:bg-white/15 group-hover/rail:opacity-100 md:grid"
      >
        <ChevronRight className="size-5 text-cream-50" />
      </button>
    </div>
  );
}
