"use client";

import { useEffect, useRef } from "react";

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
 * Ambient ember particle field. Pre-rendered glow sprites (one per hue band)
 * are blitted each frame — no per-particle gradient allocation, so it stays
 * cheap. Pauses when the tab is hidden and skips entirely under reduced motion.
 */
export function EmberField({ density = 27000 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let embers: Ember[] = [];
    let raf = 0;
    let last = performance.now();
    let paused = false;

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
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.max(16, Math.min(66, Math.round((w * h) / density)));
      embers = Array.from({ length: target }, () => spawn(true));
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (paused || !embers.length) return;

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

    const onVisibility = () => {
      paused = document.hidden;
      last = performance.now();
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2] opacity-80 mix-blend-screen"
    />
  );
}
