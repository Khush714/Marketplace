"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChefHat,
  Clock3,
  Coffee,
  Cookie,
  Croissant,
  Drumstick,
  Fish,
  Flame,
  Pizza,
  Salad,
  Sandwich,
  Search,
  Soup,
  Sparkles,
  Star,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useSearch } from "@/components/search-overlay";
import {
  CountUp,
  Magnetic,
  Scramble,
  WordReveal,
  cssVars,
} from "@/components/motion-primitives";
import { cn, greetingFor, withLoc } from "@/lib/domain";
import { useLocation } from "@/lib/location";
import { useProfile } from "@/lib/profile";

const CRAVINGS = ["extraordinary", "fiery", "handmade", "midnight-worthy", "indulgent"];

const CATEGORIES: Array<{ label: string; q: string; Icon: LucideIcon; tint: string }> = [
  { label: "Burgers", q: "Burgers", Icon: Sandwich, tint: "text-ember-400" },
  { label: "Pizza", q: "Pizza", Icon: Pizza, tint: "text-chili-400" },
  { label: "Sushi", q: "Sushi", Icon: Fish, tint: "text-berry-400" },
  { label: "Ramen", q: "Ramen", Icon: Soup, tint: "text-gold-400" },
  { label: "Biryani", q: "Biryani", Icon: UtensilsCrossed, tint: "text-ember-400" },
  { label: "Indian", q: "North Indian", Icon: Flame, tint: "text-chili-400" },
  { label: "Tacos", q: "Mexican", Icon: ChefHat, tint: "text-mint-400" },
  { label: "Fried", q: "Fried Chicken", Icon: Drumstick, tint: "text-gold-400" },
  { label: "Healthy", q: "Healthy", Icon: Salad, tint: "text-mint-400" },
  { label: "Pasta", q: "Italian", Icon: Croissant, tint: "text-ember-300" },
  { label: "Desserts", q: "Desserts", Icon: Cookie, tint: "text-berry-400" },
  { label: "Cafe", q: "Cafe", Icon: Coffee, tint: "text-gold-400" },
];

export function HomeHero({ restaurantCount }: { restaurantCount: number }) {
  const { open } = useSearch();
  const { name } = useProfile();
  const { locality } = useLocation();
  const [greeting, setGreeting] = useState("Good evening");

  useEffect(() => {
    setGreeting(greetingFor());
  }, []);

  return (
    <section className="relative mx-auto max-w-7xl px-4 pt-10 md:px-6 md:pt-16">
      {/* local aurora — brighter than the page ambience, parallax on scroll */}
      <div
        aria-hidden
        className="parallax-far pointer-events-none absolute -top-24 left-1/2 -z-10 h-[420px] w-[860px] max-w-[110vw] -translate-x-1/2"
      >
        <div className="animate-morph animate-aurora absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,120,70,0.22),transparent_72%)] mix-blend-screen blur-2xl" />
        <div
          className="animate-morph animate-aurora absolute -right-10 top-16 h-64 w-64 bg-[radial-gradient(closest-side,rgba(196,161,255,0.16),transparent_70%)] mix-blend-screen blur-2xl"
          style={cssVars({ animationDelay: "-7s, -12s" })}
        />
      </div>

      {/* greeting */}
      <p className="animate-rise flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
        <Sparkles className="size-3.5 animate-glow-breathe" />
        {greeting}
        {name ? `, ${name.split(" ")[0]}` : ""}
      </p>

      {/* headline — masked word reveal */}
      <h1 className="mt-3 max-w-3xl font-display text-[42px] font-bold leading-[1.02] tracking-tight text-cream-50 md:text-6xl lg:text-7xl">
        <WordReveal text="Craving something" delay={80} step={95} />
        <br />
        <span className="text-gradient-flow">
          <Scramble words={CRAVINGS} />
        </span>
        <span className="mask-word ml-2">
          <span className="animate-word-up inline-block" style={cssVars({ animationDelay: "420ms" })}>
            tonight?
          </span>
        </span>
      </h1>

      <p
        className="animate-rise mt-4 max-w-md text-base leading-relaxed text-cream-400"
        style={cssVars({ animationDelay: "520ms" })}
      >
        The city&apos;s most-loved kitchens, curated — hand-tossed, flame-kissed and delivered in minutes.
      </p>

      {/* magnetic search trigger */}
      <Magnetic className="animate-rise mt-7 w-full max-w-xl" strength={0.16} max={9}>
        <button
          type="button"
          onClick={open}
          className="press group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl glass px-5 py-4 text-left transition-all duration-300 hover:bg-white/10"
          style={cssVars({ animationDelay: "600ms" })}
        >
          <span className="absolute inset-0 rounded-2xl [background:radial-gradient(60%_120%_at_0%_50%,rgba(255,158,67,0.15),transparent_70%)]" />
          <span
            aria-hidden
            className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
          />
          <Search className="relative size-5 shrink-0 text-ember-400 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" />
          <span className="relative flex-1 truncate text-[15px] text-cream-500 transition-colors group-hover:text-cream-300">
            Search “truffle fries”, “biryani”, “ramen”…
          </span>
          <span className="relative hidden items-center gap-1 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-cream-300 md:flex">
            Discover <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </button>
      </Magnetic>

      {/* stats — odometer roll-up */}
      <div
        className="animate-rise mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-cream-500"
        style={cssVars({ animationDelay: "680ms" })}
      >
        <span className="flex items-center gap-1.5">
          <span className="relative flex size-1.5" aria-hidden>
            <span className="animate-dot-ping absolute inline-flex h-full w-full rounded-full bg-mint-400" />
            <span className="relative inline-flex size-1.5 rounded-full bg-mint-400" />
          </span>
          <CountUp to={restaurantCount} className="font-semibold text-cream-300" /> kitchens open now
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="size-3.5 text-ember-400" />
          <CountUp to={15} className="font-semibold text-cream-300" /> min fastest delivery
        </span>
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 fill-gold-400 text-gold-400" />
          <CountUp to={46} className="font-semibold text-cream-300" format={(n) => (n / 10).toFixed(1)} /> average
          rating
        </span>
      </div>

      {/* categories */}
      <div className="mt-9">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-cream-500">Popular near you</p>
        <div className="no-scrollbar mask-fade-x -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {CATEGORIES.map(({ label, q, Icon, tint }, i) => (
            <Link
              key={label}
              href={withLoc(`/restaurants?cuisine=${encodeURIComponent(q)}`, locality.key)}
              data-reveal="zoom"
              style={cssVars({ "--rd": `${i * 45}ms` })}
              className="press group flex shrink-0 items-center gap-2 rounded-full border border-white/8 bg-white/[0.045] py-2 pl-3 pr-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-300 group-hover:scale-125 group-hover:-rotate-12",
                  tint,
                )}
              />
              <span className="text-sm font-medium text-cream-200">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
