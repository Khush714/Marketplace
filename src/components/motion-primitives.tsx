"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn, formatINR } from "@/lib/domain";

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/*  TiltCard — pointer-tracked 3D tilt + glare, rAF-lerped for butter  */
/* ------------------------------------------------------------------ */

export function TiltCard({
  children,
  className,
  max = 7,
  lift = 6,
  scaleOnPress = 0.985,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  lift?: number;
  scaleOnPress?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;

    const cur = { rx: 0, ry: 0, ty: 0, sc: 1, gx: 0, gy: 0 };
    const tgt = { rx: 0, ry: 0, ty: 0, sc: 1, gx: 0, gy: 0 };
    let raf = 0;
    let hovering = false;
    let pressing = false;
    let w = 1;
    let h = 1;

    const apply = () => {
      el.style.setProperty("--rx", `${cur.rx.toFixed(3)}deg`);
      el.style.setProperty("--ry", `${cur.ry.toFixed(3)}deg`);
      el.style.setProperty("--ty", `${cur.ty.toFixed(2)}px`);
      el.style.setProperty("--sc", `${cur.sc.toFixed(4)}`);
      el.style.setProperty("--gx", `${cur.gx.toFixed(1)}px`);
      el.style.setProperty("--gy", `${cur.gy.toFixed(1)}px`);
    };

    const tick = () => {
      const k = hovering ? 0.16 : 0.09;
      cur.rx += (tgt.rx - cur.rx) * k;
      cur.ry += (tgt.ry - cur.ry) * k;
      cur.ty += (tgt.ty - cur.ty) * k;
      cur.sc += (tgt.sc - cur.sc) * 0.2;
      cur.gx += (tgt.gx - cur.gx) * 0.22;
      cur.gy += (tgt.gy - cur.gy) * 0.22;
      apply();

      const settled =
        Math.abs(cur.rx - tgt.rx) < 0.01 &&
        Math.abs(cur.ry - tgt.ry) < 0.01 &&
        Math.abs(cur.ty - tgt.ty) < 0.05 &&
        Math.abs(cur.sc - tgt.sc) < 0.0005 &&
        Math.abs(cur.gx - tgt.gx) < 0.4 &&
        Math.abs(cur.gy - tgt.gy) < 0.4;

      if (settled && !hovering) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const rect = el.getBoundingClientRect();
      w = rect.width || 1;
      h = rect.height || 1;
      hovering = true;
      tgt.ty = -lift;
      tgt.sc = 1.012;
      kick();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !hovering) return;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / (rect.width || 1);
      const py = (e.clientY - rect.top) / (rect.height || 1);
      tgt.ry = (px - 0.5) * 2 * max;
      tgt.rx = -(py - 0.5) * 2 * max;
      tgt.gx = px * (rect.width || 1);
      tgt.gy = py * (rect.height || 1);
      kick();
    };

    const onLeave = () => {
      hovering = false;
      pressing = false;
      tgt.rx = 0;
      tgt.ry = 0;
      tgt.ty = 0;
      tgt.sc = 1;
      kick();
    };

    const onDown = () => {
      pressing = true;
      tgt.sc = scaleOnPress;
      kick();
    };
    const onUp = () => {
      pressing = false;
      tgt.sc = hovering ? 1.012 : 1;
      kick();
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onLeave);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onLeave);
    };
  }, [reduced, max, lift, scaleOnPress]);

  return (
    <div ref={ref} className={cn("tilt-3d", className)}>
      {children}
      {/* cursor glare */}
      <span
        aria-hidden
        className="glare-spot pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 [transform:translateZ(0)] group-hover:opacity-100"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scroll reveal — one global observer, works with server markup      */
/* ------------------------------------------------------------------ */

export function RevealObserver() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -7% 0px", threshold: 0.06 },
    );

    let timer = 0;
    const scan = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
      }, 90);
    };

    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(timer);
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return null;
}

export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "up" | "flip" | "left" | "zoom";
}) {
  return (
    <div data-reveal={variant} className={className} style={cssVars({ "--rd": `${delay}ms` })}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Magnetic — element leans toward the cursor                          */
/* ------------------------------------------------------------------ */

export function Magnetic({
  children,
  className,
  strength = 0.28,
  max = 14,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const tick = () => {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      el.style.setProperty("--mx", `${cx.toFixed(2)}px`);
      el.style.setProperty("--my", `${cy.toFixed(2)}px`);
      if (Math.abs(cx - tx) > 0.1 || Math.abs(cy - ty) > 0.1) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      tx = Math.max(-max, Math.min(max, dx * strength));
      ty = Math.max(-max, Math.min(max, dy * strength));
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, strength, max]);

  return (
    <div ref={ref} className={cn("magnetic", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Odometer — digits roll vertically when the value changes            */
/* ------------------------------------------------------------------ */

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function RollingNumber({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const text = format ? format(value) : String(value);
  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${i}-${ch}`} className="inline-block h-[1em] overflow-hidden leading-[1]">
            <span
              className="flex flex-col transition-transform duration-[550ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `translateY(-${Number(ch)}em)` }}
            >
              {DIGITS.map((d) => (
                <span key={d} className="block h-[1em] leading-[1]">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${i}-${ch}`} className="inline-block">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/** Rupee amount that rolls digit-by-digit whenever the value changes. */
export function AnimatedPrice({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  return <RollingNumber value={cents / 100} className={className} format={(n) => formatINR(Math.round(n * 100))} />;
}

/** Eases from 0 → `to` on mount, rendering through the odometer. */
export function CountUp({
  to,
  duration = 1300,
  className,
  format,
}: {
  to: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [value, setValue] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(to * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, reduced]);

  return <RollingNumber value={Math.round(value)} className={className} format={format} />;
}

/* ------------------------------------------------------------------ */
/*  Scramble — glyph-shuffle text transition                            */
/* ------------------------------------------------------------------ */

const GLYPHS = "ABCDEFGHKMNPQRSTUVWXYZ*#%&+~".split("");

export function Scramble({ words, interval = 3200 }: { words: string[]; interval?: number }) {
  const [index, setIndex] = useState(0);
  const [display, setDisplay] = useState(words[0] ?? "");
  const reduced = useReducedMotion();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % words.length);
    }, interval);
    return () => window.clearInterval(id);
  }, [words, interval]);

  useEffect(() => {
    const target = words[index];
    if (!target) return;
    if (reduced) {
      setDisplay(target);
      return;
    }
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const total = 620;
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const reveal = Math.floor((s / steps) * target.length);
      timers.current.push(
        window.setTimeout(() => {
          let out = "";
          for (let c = 0; c < target.length; c++) {
            if (c < reveal || target[c] === " ") out += target[c];
            else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
          setDisplay(out);
        }, (s / steps) * total),
      );
    }
    timers.current.push(window.setTimeout(() => setDisplay(target), total + 40));
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [index, words, reduced]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span className="relative inline-grid align-bottom">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {longest}
      </span>
      <span className="col-start-1 row-start-1" aria-live="polite">
        {display}
        <span className="animate-blink ml-0.5 inline-block h-[0.82em] w-[3px] translate-y-[0.04em] rounded-full bg-current align-baseline" />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  WordReveal — masked, per-word 3D entrance for headlines            */
/* ------------------------------------------------------------------ */

export function WordReveal({
  text,
  className,
  wordClassName,
  delay = 0,
  step = 85,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  step?: number;
}) {
  return (
    <span className={cn("inline", className)}>
      {text.split(" ").map((word, i) => (
        <span key={`${word}-${i}`} className="mask-word">
          <span
            className={cn("animate-word-up inline-block", wordClassName)}
            style={cssVars({ animationDelay: `${delay + i * step}ms` })}
          >
            {word}
            {i < text.split(" ").length - 1 ? "\u00A0" : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Ripple — click feedback anchored at the pointer                     */
/* ------------------------------------------------------------------ */

export function Ripple({ id }: { id: number }) {
  if (id === 0) return null;
  return (
    <span
      key={id}
      aria-hidden
      className="animate-btn-ripple pointer-events-none absolute size-[220%] rounded-full bg-white/35"
      style={cssVars({ left: "var(--rx-pt, 50%)", top: "var(--ry-pt, 50%)" })}
    />
  );
}
