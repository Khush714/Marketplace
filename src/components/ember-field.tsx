"use client";

import { useEffect, useRef } from "react";
import { experiments } from "@/lib/experiments";
import { usePerformanceMode } from "@/lib/performance-mode";
import { cn } from "@/lib/domain";

interface Ember {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  sprite: number;
  alpha: number;
  life: number;
  max: number;
  sway: number;
  phase: number;
}

/**
 * What a device can afford for the ember field.
 *
 * This is the app's only always-on animation: a full-viewport canvas mounted
 * under every route (see AppShell), cleared and redrawn on every frame. On a
 * 390x844 phone at dpr 2 that is ~1.3M pixels of clearRect plus a blended
 * composite, 60 times a second, for as long as the marketplace is open — while
 * the customer is reading a menu and nothing on screen is changing.
 *
 * Nothing in the effect actually needs that budget. The sprites are soft glows
 * a few dozen pixels across and the whole canvas sits at 80% opacity under a
 * near-black backdrop, so the resolution and frame rate were spending far more
 * than the look required.
 */
interface Budget {
  /** Target frames per second. */
  fps: number;
  /** Upper bound on the canvas backing-store scale. */
  maxDpr: number;
  /** Viewport pixels per particle; the count is derived from area. */
  density: number;
  /** Hard ceiling on particle count regardless of viewport area. */
  maxEmbers: number;
  /**
   * Whether the canvas blends with what is behind it. Blend modes force the
   * compositor to read back the backdrop on every frame, which is one of the
   * more expensive things on this screen. Dropped only on the low-power tier,
   * where the field is already a deliberate downgrade.
   */
  blend: boolean;
}

const BUDGETS = {
  desktop: { fps: 60, maxDpr: 2, density: 27000, maxEmbers: 66, blend: true },
  tablet: { fps: 30, maxDpr: 1.5, density: 38000, maxEmbers: 38, blend: true },
  mobile: { fps: 30, maxDpr: 1.5, density: 46000, maxEmbers: 26, blend: true },
  lowPower: { fps: 12, maxDpr: 1, density: 62000, maxEmbers: 16, blend: false },
} as const satisfies Record<string, Budget>;

type Tier = keyof typeof BUDGETS;

/** Pre-rendered glow sprites (one per hue band) are blitted each frame — no
 *  per-particle gradient allocation, so the per-particle cost stays flat. */
export function EmberField({ density }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // One classification for the whole app (Phase 12): the tier below is a pure
  // function of the shared mode, so this component no longer reads the device
  // itself or owns its own resize listener.
  const { mode, reducedMotion, largeViewport } = usePerformanceMode();
  const tier: Tier =
    mode === "full" ? "desktop" : mode === "low" ? "lowPower" : largeViewport ? "tablet" : "mobile";

  useEffect(() => {
    // Checked live rather than once at mount: the OS setting can change while
    // the marketplace is open, and the old mount-time check ignored that.
    if (reducedMotion) return;

    const budget = BUDGETS[tier];
    const area = density ?? budget.density;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dprInUse = 0;
    let embers: Ember[] = [];
    let raf = 0;
    /** Timestamp of the last frame actually drawn, not the last frame seen. */
    let last = 0;

    // Pre-render 6 warm glow sprites across the ember hue range.
    const HUES = [16, 22, 27, 32, 37, 43];
    const SPRITE_R = 18;
    const sprites = HUES.map((hue) => {
      const s = document.createElement("canvas");
      s.width = s.height = SPRITE_R * 2;
      const c = s.getContext("2d");
      if (!c) return s;
      const g = c.createRadialGradient(SPRITE_R, SPRITE_R, 0, SPRITE_R, SPRITE_R, SPRITE_R);
      g.addColorStop(0, `hsla(${hue}, 100%, 74%, 1)`);
      g.addColorStop(0.32, `hsla(${hue}, 100%, 62%, 0.42)`);
      g.addColorStop(1, `hsla(${hue}, 100%, 52%, 0)`);
      c.fillStyle = g;
      c.beginPath();
      c.arc(SPRITE_R, SPRITE_R, SPRITE_R, 0, Math.PI * 2);
      c.fill();
      return s;
    });

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const spawn = (initial = false): Ember => ({
      x: rand(0, w),
      y: initial ? rand(0, h) : h + rand(6, 60),
      r: rand(1.6, 5.2),
      vy: rand(11, 30),
      vx: rand(-7, 7),
      sprite: Math.floor(rand(0, sprites.length)),
      alpha: rand(0.22, 0.62),
      life: 0,
      max: rand(9, 18),
      sway: rand(6, 22),
      phase: rand(0, Math.PI * 2),
    });

    const resize = () => {
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      const nextDpr = Math.min(budget.maxDpr, window.devicePixelRatio || 1);

      // Mobile browsers fire `resize` every time the URL bar collapses or
      // expands, which is on every scroll. The previous handler rebuilt the
      // entire particle array each time, so scrolling on a phone respawned the
      // whole field — a visible flicker, repeated indefinitely. Only react to
      // a real change.
      if (nextW === w && nextH === h && nextDpr === dprInUse) return;

      const scaleX = w ? nextW / w : 1;
      const scaleY = h ? nextH / h : 1;
      w = nextW;
      h = nextH;
      dprInUse = nextDpr;
      canvas.width = Math.max(1, Math.floor(w * dprInUse));
      canvas.height = Math.max(1, Math.floor(h * dprInUse));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dprInUse, 0, 0, dprInUse, 0, 0);

      // Carry the live field across the resize rather than replacing it.
      for (const p of embers) {
        p.x *= scaleX;
        p.y *= scaleY;
      }

      const target = Math.max(8, Math.min(budget.maxEmbers, Math.round((w * h) / area)));
      if (target > embers.length) {
        for (let i = embers.length; i < target; i++) embers.push(spawn(true));
      } else if (target < embers.length) {
        embers.length = target;
      }

      // Writing to canvas.width clears the backing store, so the field is now
      // blank. Force a repaint next frame rather than leaving a hole in it for
      // up to 1/fps seconds.
      last = 0;
    };

    const minFrameMs = 1000 / budget.fps;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);

      /* Frame pacing. rAF still fires at display rate, but the expensive half —
       * full-surface clear plus a blended composite — runs at the tier budget.
       * A rAF callback that returns immediately costs a fraction of a
       * millisecond; a full-viewport clear on a phone does not. */
      if (now - last < minFrameMs) return;
      /* Capped against a long stall (a restored tab, a GC pause) so the field
       * never teleports. The cap sits above 1/lowPower.fps so the slowest tier
       * still advances at true wall-clock speed rather than in slow motion. */
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!embers.length) return;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < embers.length; i++) {
        const p = embers[i];
        p.life += dt;
        p.y -= p.vy * dt;
        p.x += (p.vx + Math.sin(p.phase + p.life * 1.35) * p.sway * 0.4) * dt;

        const t = p.life / p.max;
        if (t >= 1 || p.y < -40) {
          embers[i] = spawn();
          continue;
        }
        const fadeIn = Math.min(1, t * 7);
        const fadeOut = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        const size = p.r * 7;
        ctx.globalAlpha = p.alpha * fadeIn * fadeOut;
        ctx.drawImage(sprites[p.sprite], p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const start = () => {
      if (raf) return;
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    /* Stop completely when hidden, rather than keeping the callback scheduled
     * and skipping the draw. The old `paused` flag did the latter: the loop
     * stayed alive for the entire time the tab was in the background. */
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        last = 0;
        start();
      }
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tier, reducedMotion, density]);

  if (reducedMotion) return null;
  // Profiling-only switch (Test B/D in Phase 13), after all hooks so hook order
  // is unchanged whether or not the field is disabled.
  if (experiments.emberOff()) return null;

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-[2] opacity-80",
        BUDGETS[tier].blend && "mix-blend-screen",
      )}
    />
  );
}
