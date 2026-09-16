"use client";

/**
 * Fly-to-cart: launches the tapped dish along a bezier arc into the cart
 * anchor, then fires a shockwave ring on arrival. Pure DOM/WAAPI — no React
 * state, no re-renders, and it never touches cart logic.
 */

interface Point {
  x: number;
  y: number;
}

export function flyToCart(from: Point, imageUrl?: string): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const anchor = document.querySelector<HTMLElement>("[data-cart-anchor]");
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  const to: Point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:46px",
    "height:46px",
    "pointer-events:none",
    "z-index:200",
    "will-change:transform,opacity",
  ].join(";");

  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "";
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;border-radius:999px;outline:2px solid rgba(255,178,94,0.75);box-shadow:0 14px 34px -8px rgba(0,0,0,0.85)";
    el.appendChild(img);
  } else {
    const dot = document.createElement("div");
    dot.style.cssText =
      "width:100%;height:100%;border-radius:999px;background:linear-gradient(180deg,var(--color-ember-400),var(--color-chili-600));box-shadow:0 12px 30px -6px rgba(255,90,60,0.85)";
    el.appendChild(dot);
  }

  document.body.appendChild(el);

  // Arc control point: rise above the start, biased toward the target.
  const ctrl: Point = {
    x: from.x + (to.x - from.x) * 0.22,
    y: Math.min(from.y, to.y) - Math.min(190, Math.abs(to.y - from.y) * 0.55 + 90),
  };

  const STEPS = 30;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const inv = 1 - t;
    const x = inv * inv * from.x + 2 * inv * t * ctrl.x + t * t * to.x;
    const y = inv * inv * from.y + 2 * inv * t * ctrl.y + t * t * to.y;
    const scale = 1 - 0.74 * Math.pow(t, 1.5);
    const opacity = t > 0.88 ? String(Math.max(0, 1 - (t - 0.88) / 0.12)) : "1";
    frames.push({
      transform: `translate3d(${x - 23}px, ${y - 23}px, 0) scale(${scale.toFixed(3)}) rotate(${(t * 200).toFixed(1)}deg)`,
      opacity,
    });
  }

  const anim = el.animate(frames, { duration: 760, easing: "linear", fill: "forwards" });
  const cleanup = () => {
    el.remove();
    shockwave(to);
  };
  anim.onfinish = cleanup;
  anim.oncancel = () => el.remove();
}

function shockwave(at: Point): void {
  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  ring.style.cssText = [
    "position:fixed",
    `left:${at.x - 26}px`,
    `top:${at.y - 26}px`,
    "width:52px",
    "height:52px",
    "border-radius:999px",
    "border:2px solid rgba(255,178,94,0.9)",
    "pointer-events:none",
    "z-index:199",
    "will-change:transform,opacity",
  ].join(";");
  document.body.appendChild(ring);
  const a = ring.animate(
    [
      { transform: "scale(0.35)", opacity: 0.95 },
      { transform: "scale(1.9)", opacity: 0 },
    ],
    { duration: 620, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "forwards" },
  );
  a.onfinish = () => ring.remove();
  a.oncancel = () => ring.remove();
}
