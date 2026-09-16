"use client";

import { useEffect, useRef } from "react";

/** Slim scroll-progress rail along the very top of the viewport. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let current = 0;

    const tick = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      current += (target - current) * 0.18;
      el.style.transform = `scaleX(${current.toFixed(4)})`;
      if (Math.abs(target - current) > 0.0008) {
        raf = requestAnimationFrame(tick);
      } else {
        current = target;
        el.style.transform = `scaleX(${current.toFixed(4)})`;
        raf = 0;
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[2px]">
      <div
        ref={ref}
        className="h-full origin-left scale-x-0 bg-gradient-to-r from-ember-400 via-chili-500 to-berry-400 shadow-[0_0_14px_2px_rgba(255,120,70,0.6)]"
      />
    </div>
  );
}
