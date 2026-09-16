"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Bike,
  ChefHat,
  House,
  MapPin,
  PartyPopper,
  Phone,
  ReceiptText,
  RefreshCcw,
  Star,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { RollingNumber } from "@/components/motion-primitives";
import { cn, formatINR, ORDER_STAGES } from "@/lib/domain";
import type { OrderDto } from "@/lib/types";

const STAGE_ICONS: Record<string, LucideIcon> = {
  placed: ReceiptText,
  confirmed: BadgeCheck,
  preparing: ChefHat,
  ready: Store,
  rider: UserRound,
  on_the_way: Bike,
  delivered: PartyPopper,
};

interface Pt {
  x: number;
  y: number;
}

export function TrackingView({ initialOrder }: { initialOrder: OrderDto }) {
  const [order, setOrder] = useState(initialOrder);

  /* Live polling — the engine behind status updates */
  useEffect(() => {
    const poll = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${order.code}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setOrder(data.order);
        }
      } catch {
        /* keep last known state */
      }
    }, 4000);
    return () => window.clearInterval(poll);
  }, [order.code]);

  const s = order.status;
  const etaMin = Math.max(1, Math.ceil(s.etaSeconds / 60));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
            {!s.delivered && (
              <span className="relative flex size-2">
                <span className="animate-dot-ping absolute inline-flex h-full w-full rounded-full bg-ember-400" />
                <span className="relative inline-flex size-2 rounded-full bg-ember-400" />
              </span>
            )}
            {s.delivered ? "Completed" : "Live tracking"}
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
            {s.delivered ? (
              <>
                Delivered<span className="text-gradient">.</span> Enjoy
              </>
            ) : (
              <>
                Arriving in{" "}
                <span className="text-gradient-flow">
                  <RollingNumber value={etaMin} className="font-display" /> min
                </span>
              </>
            )}
          </h1>
          <p className="mt-1 text-sm text-cream-500">
            <span className="font-mono font-semibold uppercase text-cream-300">{order.code}</span> ·{" "}
            {order.restaurantName}
          </p>
        </div>

        {!s.delivered && (
          <div className="glass rounded-2xl px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cream-500">Current status</p>
            <p key={s.stageKey} className="animate-jelly mt-0.5 font-display text-base font-bold text-ember-300">
              {s.stageLabel}
            </p>
          </div>
        )}
      </header>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        {/* courier map */}
        <CourierMap order={order} />

        {/* timeline + summary */}
        <div className="space-y-6">
          <div className="glass rounded-3xl p-5 md:p-6">
            <h2 className="mb-5 font-display text-base font-bold text-cream-50">Order journey</h2>
            <ol className="relative">
              {ORDER_STAGES.map((stage, i) => {
                const done = i < s.stageIndex;
                const current = i === s.stageIndex;
                const Icon = STAGE_ICONS[stage.key] ?? ReceiptText;
                return (
                  <li key={stage.key} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < ORDER_STAGES.length - 1 && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-[17px] top-9 h-[calc(100%-28px)] w-0.5 origin-top rounded-full transition-all duration-700",
                          i < s.stageIndex
                            ? "scale-y-100 bg-gradient-to-b from-mint-400 to-mint-500/60"
                            : "scale-y-0 bg-white/10",
                        )}
                      />
                    )}
                    <span
                      key={current ? s.stageKey : "static"}
                      className={cn(
                        "relative z-10 grid size-9 shrink-0 place-items-center rounded-full transition-all duration-500",
                        done
                          ? "bg-mint-500 text-emerald-950"
                          : current
                            ? "animate-jelly bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow"
                            : "bg-white/6 text-cream-600",
                      )}
                    >
                      {current && !s.delivered && (
                        <span className="animate-ripple absolute inset-0 rounded-full border border-ember-400/60" />
                      )}
                      <Icon className="size-4" strokeWidth={done || current ? 2.4 : 2} />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p
                        className={cn(
                          "text-sm font-bold transition-colors duration-500",
                          current ? "text-cream-50" : done ? "text-cream-200" : "text-cream-600",
                        )}
                      >
                        {stage.label}
                      </p>
                      <p
                        className={cn(
                          "text-xs transition-colors duration-500",
                          current ? "text-cream-400" : "text-cream-600",
                        )}
                      >
                        {current ? stage.sub : done ? "Done" : "Upcoming"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* rider card */}
          {(s.stageKey === "rider" || s.stageKey === "on_the_way") && (
            <div className="animate-pop-in glass rounded-3xl p-5">
              <div className="flex items-center gap-3.5">
                <span className="relative grid size-12 place-items-center rounded-2xl bg-gradient-to-b from-ember-400/30 to-chili-600/20 text-ember-300 ring-1 ring-ember-400/30">
                  <Bike className="size-6" />
                  <span className="absolute -right-1 -top-1 flex size-3.5">
                    <span className="animate-dot-ping absolute inline-flex h-full w-full rounded-full bg-mint-400" />
                    <span className="relative inline-flex size-3.5 rounded-full border-2 border-void bg-mint-400" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-cream-50">{order.riderName}</p>
                  <p className="text-xs text-cream-500">Your delivery partner · 4.9 ★</p>
                </div>
                <button
                  type="button"
                  aria-label={`Call ${order.riderName}`}
                  className="press glass-strong grid size-10 place-items-center rounded-full text-mint-400 transition-colors hover:bg-white/15"
                >
                  <Phone className="size-4" />
                </button>
              </div>
            </div>
          )}

          {/* delivered celebration */}
          {s.delivered && (
            <div className="animate-pop-in rounded-3xl bg-gradient-to-br from-mint-400/15 to-transparent p-5 ring-1 ring-mint-400/25">
              <p className="flex items-center gap-2 font-display text-base font-bold text-mint-400">
                <PartyPopper className="size-5" /> Bon appétit
              </p>
              <p className="mt-1 text-sm leading-relaxed text-cream-400">
                Hope it hits the spot. Rate your meal or fire up a reorder.
              </p>
              <div className="mt-4 flex gap-2.5">
                <Link
                  href={`/restaurants/${order.restaurantSlug}`}
                  className="press flex items-center gap-1.5 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-bold text-emerald-950"
                >
                  <RefreshCcw className="size-4" /> Reorder
                </Link>
                <button
                  type="button"
                  className="press flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
                >
                  <Star className="size-4" /> Rate meal
                </button>
              </div>
            </div>
          )}

          {/* summary */}
          <div className="glass rounded-3xl p-5 md:p-6">
            <h2 className="font-display text-base font-bold text-cream-50">Order summary</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {order.items.map((i) => (
                <li key={i.menuItemId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-cream-300">
                    <span className="font-semibold text-cream-500">{i.quantity}×</span> {i.name}
                  </span>
                  <span className="shrink-0 text-cream-50 tabular-nums">{formatINR(i.priceCents * i.quantity)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-cream-500">Item total</dt>
                <dd className="text-cream-50 tabular-nums">{formatINR(order.subtotalCents)}</dd>
              </div>
              {order.discountCents > 0 && (
                <div className="flex justify-between text-mint-400">
                  <dt>Restaurant offer</dt>
                  <dd className="tabular-nums">−{formatINR(order.discountCents)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-cream-500">Delivery</dt>
                <dd className="tabular-nums">
                  {order.deliveryFeeCents === 0 ? <span className="text-mint-400">FREE</span> : formatINR(order.deliveryFeeCents)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-cream-500">Platform fee</dt>
                <dd className="text-cream-50 tabular-nums">{formatINR(order.platformFeeCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-3 font-display text-base font-bold">
                <dt className="text-cream-50">Paid via {order.paymentMethod.toUpperCase()}</dt>
                <dd className="text-cream-50 tabular-nums">{formatINR(order.totalCents)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-3.5 py-3 text-xs text-cream-400">
              <House className="mt-0.5 size-3.5 shrink-0 text-ember-400" />
              <span>
                <span className="font-semibold text-cream-200">{order.addressLabel}</span> — {order.addressText}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ courier map ------------------------------ */

const ROUTE_D = "M 52 236 C 110 178 148 226 196 178 C 244 130 268 168 308 118 C 330 92 344 84 352 78";

/** Follower lerp factors — smaller = further behind the rider. */
const TRAIL_LERP = [0.34, 0.22, 0.13];
const TRAIL_RADIUS = [7, 5.5, 4];

function CourierMap({ order }: { order: OrderDto }) {
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  const [rider, setRider] = useState<Pt | null>(null);
  const [trail, setTrail] = useState<Pt[]>([]);
  const state = useRef({ t: 0, trail: [] as Pt[], rider: null as Pt | null });

  const target = order.status.riderProgress;

  /* Measure the route once mounted. */
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    setLen(total);
    const start = path.getPointAtLength(Math.min(1, target * 0.6) * total);
    state.current.rider = { x: start.x, y: start.y };
    state.current.trail = [
      { x: start.x, y: start.y },
      { x: start.x, y: start.y },
      { x: start.x, y: start.y },
    ];
    setRider({ x: start.x, y: start.y });
    setTrail([...state.current.trail]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.code]);

  /* Butter-smooth lerp toward the live target, with a lagging comet trail. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const path = pathRef.current;
      if (path && len > 0) {
        const st = state.current;
        const nextT = st.t + (target - st.t) * 0.035;
        if (Math.abs(nextT - st.t) > 0.00003) {
          st.t = nextT;
          const p = path.getPointAtLength(Math.min(1, Math.max(0, st.t)) * len);
          st.rider = { x: p.x, y: p.y };

          // Each follower chases the one ahead of it.
          let prev = st.rider;
          st.trail = st.trail.map((pt, i) => {
            const k = TRAIL_LERP[i];
            const moved = { x: pt.x + (prev.x - pt.x) * k, y: pt.y + (prev.y - pt.y) * k };
            prev = moved;
            return moved;
          });

          setRider({ x: st.rider.x, y: st.rider.y });
          setTrail([...st.trail]);
        } else if (st.t !== target) {
          st.t = target;
          const p = path.getPointAtLength(target * len);
          setRider({ x: p.x, y: p.y });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, len]);

  const progress = order.status.riderProgress;
  const riding = !order.status.delivered;

  return (
    <div className="glass-strong relative h-[420px] overflow-hidden rounded-[28px] lg:h-auto lg:min-h-[560px]">
      {/* map base */}
      <div className="absolute inset-0 bg-[linear-gradient(160deg,#101014_0%,#0b0b10_60%,#0e0c12_100%)]" />

      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {/* road grid */}
        <g stroke="rgba(255,255,255,0.045)" strokeWidth="11" strokeLinecap="round">
          <path d="M -20 60 H 420" />
          <path d="M -20 150 H 420" />
          <path d="M -20 246 H 420" />
          <path d="M 70 -20 V 320" />
          <path d="M 172 -20 V 320" />
          <path d="M 288 -20 V 320" />
        </g>
        <g stroke="rgba(255,255,255,0.03)" strokeWidth="4">
          <path d="M 118 -20 V 320" />
          <path d="M 230 -20 V 320" />
          <path d="M 350 -20 V 320" />
          <path d="M -20 104 H 420" />
          <path d="M -20 200 H 420" />
        </g>
        <g fill="rgba(79,227,172,0.05)">
          <circle cx="330" cy="216" r="42" />
          <circle cx="60" cy="116" r="30" />
        </g>

        {/* route: dashed base + drawn glow */}
        <path ref={pathRef} d={ROUTE_D} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="0.5 9" />
        {len > 0 && (
          <path
            d={ROUTE_D}
            fill="none"
            stroke="url(#routeGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, state.current.t) * len} ${len}`}
            style={{ filter: "drop-shadow(0 0 7px rgba(255,120,70,0.7))" }}
          />
        )}
        <defs>
          <linearGradient id="routeGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-ember-400)" />
            <stop offset="100%" stopColor="var(--color-chili-500)" />
          </linearGradient>
        </defs>

        {/* comet trail behind the rider */}
        {trail.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={TRAIL_RADIUS[i]}
            fill="var(--color-ember-400)"
            opacity={0.42 - i * 0.11}
          />
        ))}

        {/* radar pings */}
        <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle className="animate-radar" cx="52" cy="236" r="16" fill="none" stroke="var(--color-chili-400)" strokeWidth="1.6" opacity="0.7" />
        </g>
        <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle
            className="animate-radar"
            style={{ animationDelay: "1.1s" }}
            cx="352"
            cy="78"
            r="16"
            fill="none"
            stroke="var(--color-mint-400)"
            strokeWidth="1.6"
            opacity="0.7"
          />
        </g>

        {/* restaurant pin */}
        <g transform="translate(52 236)">
          <circle r="17" fill="rgba(255,122,89,0.14)" />
          <circle r="8.5" fill="var(--color-chili-500)" stroke="rgba(255,255,255,0.85)" strokeWidth="2" />
        </g>
        {/* home pin */}
        <g transform="translate(352 78)">
          <circle r="17" fill="rgba(79,227,172,0.14)" />
          <circle r="8.5" fill="var(--color-mint-400)" stroke="rgba(6,40,28,0.9)" strokeWidth="2" />
        </g>

        {/* rider */}
        {rider && (
          <g transform={`translate(${rider.x} ${rider.y})`}>
            <circle className="animate-glow-breathe" r="19" fill="rgba(255,178,94,0.2)" />
            <circle r="10" fill="var(--color-ember-400)" stroke="#1a0e08" strokeWidth="2.5" />
            <circle r="3.4" fill="#fff8ee" opacity="0.9" />
          </g>
        )}
      </svg>

      {/* overlay chips */}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 backdrop-blur-md">
        <Store className="size-3.5 text-chili-400" />
        <span className="text-xs font-semibold text-cream-200">{order.restaurantName}</span>
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 backdrop-blur-md">
        <House className="size-3.5 text-mint-400" />
        <span className="text-xs font-semibold text-cream-200">{order.addressLabel}</span>
      </div>

      {/* distance remaining */}
      <div className="absolute inset-x-4 bottom-[86px]">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">
          <span>Ride progress</span>
          <span className="tabular-nums text-cream-300">{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full origin-left rounded-full bg-gradient-to-r from-ember-400 to-chili-500 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>

      {/* bottom status bar */}
      <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-2xl bg-black/60 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow">
            <Bike className="size-4.5" />
          </span>
          <div>
            <p key={order.status.stageKey} className="animate-jelly text-sm font-bold text-cream-50">
              {order.status.delivered ? "Delivered" : order.status.stageLabel}
            </p>
            <p className="text-[11px] text-cream-500">
              {order.status.delivered ? "Enjoy every bite" : order.status.stageSub}
            </p>
          </div>
        </div>
        {!order.status.delivered && riding && (
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">ETA</p>
            <RollingNumber
              value={Math.max(1, Math.ceil(order.status.etaSeconds / 60))}
              className="font-display text-lg font-bold leading-none text-ember-300"
              format={(n) => `${n}m`}
            />
          </div>
        )}
      </div>

      {/* address footer */}
      <div className="absolute bottom-[132px] left-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-md">
        <MapPin className="size-3 text-cream-400" />
        <span className="max-w-[260px] truncate text-[11px] text-cream-400">{order.addressText}</span>
      </div>
    </div>
  );
}
