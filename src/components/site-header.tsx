"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, MapPin, ShoppingBag, CircleUserRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { useSearch } from "@/components/search-overlay";
import { useCart } from "@/lib/cart";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/domain";

function SearchTrigger({ className }: { className?: string }) {
  const { open } = useSearch();
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "group flex items-center gap-2.5 rounded-full glass px-4 py-2.5 text-left transition-all duration-300",
        "hover:bg-white/10 hover:shadow-hairline-bright press",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4 text-cream-400 transition-colors group-hover:text-ember-400" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="flex-1 truncate text-sm text-cream-400 transition-colors group-hover:text-cream-200">
        Search restaurants, dishes, cravings…
      </span>
      <kbd className="hidden rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-cream-500 md:block">
        /
      </kbd>
    </button>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const { itemCount, bump } = useCart();
  const { name } = useProfile();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-white/8 bg-void/75 shadow-lift backdrop-blur-2xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pt-3 md:h-16 md:gap-5 md:pt-0 lg:px-6">
        {/* Mobile row-1: location + profile */}
        <div className="flex flex-1 items-center justify-between md:hidden">
          <button type="button" className="flex items-center gap-1.5 press" aria-label="Change delivery location">
            <MapPin className="size-4 text-chili-400" />
            <span className="text-left">
              <span className="block text-[13px] font-semibold leading-tight text-cream-50">
                Indiranagar <ChevronDown className="inline size-3 -translate-y-px text-cream-400" />
              </span>
              <span className="block text-[11px] leading-tight text-cream-500">Bengaluru</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <HeaderCart itemCount={itemCount} bump={bump} />
            <Link
              href="/profile"
              aria-label="Profile"
              className="grid size-9 place-items-center rounded-full glass text-sm font-bold text-ember-300 press"
            >
              {name ? name.slice(0, 1).toUpperCase() : <CircleUserRound className="size-5 text-cream-300" />}
            </Link>
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:flex md:items-center md:gap-5">
          <Logo />
        </div>
        <button
          type="button"
          className="hidden items-center gap-1.5 rounded-full px-2 py-1.5 press md:flex"
          aria-label="Change delivery location"
        >
          <MapPin className="size-4 text-chili-400" />
          <span className="text-left leading-tight">
            <span className="flex items-center gap-1 text-[13px] font-semibold text-cream-50">
              Indiranagar <ChevronDown className="size-3 text-cream-500" />
            </span>
            <span className="block text-[11px] text-cream-500">Bengaluru 560038</span>
          </span>
        </button>

        <SearchTrigger className="hidden md:flex md:min-w-0 md:flex-1 md:max-w-md md:mx-auto" />

        <div className="hidden items-center gap-2.5 md:flex">
          <HeaderCart itemCount={itemCount} bump={bump} labelled />
          <Link
            href="/profile"
            className="press grid size-10 place-items-center rounded-full glass text-sm font-bold text-ember-300 transition-colors hover:bg-white/10"
            aria-label="Profile"
          >
            {name ? name.slice(0, 1).toUpperCase() : <CircleUserRound className="size-5 text-cream-300" />}
          </Link>
        </div>
      </div>

      {/* Mobile search row */}
      <div className="px-4 pb-3 pt-2.5 md:hidden">
        <SearchTrigger className="w-full" />
      </div>
    </header>
  );
}

function HeaderCart({ itemCount, bump, labelled = false }: { itemCount: number; bump: number; labelled?: boolean }) {
  return (
    <Link
      href="/cart"
      data-cart-anchor
      aria-label={`Cart, ${itemCount} items`}
      className={cn(
        "press relative grid place-items-center rounded-full glass transition-colors hover:bg-white/10",
        labelled ? "h-10 gap-1.5 px-4" : "size-9",
      )}
    >
      <span className="flex items-center gap-1.5">
        <ShoppingBag className="size-[18px] text-cream-200" />
        {labelled && <span className="text-sm font-semibold text-cream-50">Cart</span>}
      </span>
      {itemCount > 0 && (
        <span
          key={bump}
          className="animate-scale-bump absolute -right-1 -top-1 grid min-w-[19px] place-items-center rounded-full bg-gradient-to-br from-ember-400 to-chili-600 px-1 py-0.5 text-[10px] font-bold text-white shadow-glow"
        >
          {itemCount}
        </span>
      )}
    </Link>
  );
}
