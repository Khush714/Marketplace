"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PushNotifications } from "@/components/PushNotifications";
import {
  BagIcon,
  BellIcon,
  CompassIcon,
  SearchIcon,
  StoreIcon,
  UserIcon,
} from "@/components/ui/icons";

/**
 * Discovery-only marketplace shell. No cart, no checkout — ordering happens on
 * each restaurant's own POS via the ORDER ONLINE deep-link.
 */

const BARE_ROUTES: string[] = [];

const TABS = [
  { href: "/", label: "Home", icon: CompassIcon, match: (p: string) => p === "/" },
  {
    href: "/restaurants",
    label: "Restaurants",
    icon: StoreIcon,
    match: (p: string) => p.startsWith("/restaurant"),
  },
  {
    href: "/search",
    label: "Search",
    icon: SearchIcon,
    match: (p: string) => p.startsWith("/search"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: BagIcon,
    match: (p: string) => p.startsWith("/profile"),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="min-h-screen">
      {!bare && <TopBar pathname={pathname} />}
      <main className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      {!bare && <TabBar pathname={pathname} />}
      <ServiceWorker />
      <PushNotifications />
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-ember-500 text-lg font-bold text-ink-950 shadow-[0_4px_16px_rgba(255,122,26,0.35)]">
        T
      </span>
      <span className="text-xl font-bold tracking-tight">
        <span className="text-white">tabl</span>
        <span className="text-ember-400">z</span>
      </span>
    </Link>
  );
}

function TopBar({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/8 bg-ink-950/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="relative hidden flex-1 md:block"
        >
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
            <SearchIcon className="text-lg" />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search restaurants or food"
            className="h-11 w-full rounded-full border border-white/10 bg-white/5 py-2.5 pl-11 pr-4 text-white placeholder-white/40 outline-none transition focus:border-ember-500/50 focus:bg-white/8"
          />
        </form>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {TABS.filter((t) => t.href !== "/").map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/8 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                <t.icon className="text-base" />
                {t.label}
              </Link>
            );
          })}
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative grid h-10 w-10 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <BellIcon className="text-lg" />
            <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-ember-400" />
          </Link>
          <Link
            href="/profile"
            className="hidden h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 sm:inline-flex"
          >
            <UserIcon className="text-base text-ember-400" />
            Profile
          </Link>
        </nav>
      </div>
    </header>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="app-tabbar fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-ink-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                active ? "text-ember-400" : "text-white/50"
              }`}
            >
              <t.icon className="text-xl" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Register in dev too — Web Push needs an active worker to subscribe.
    // The worker's fetch handler is network-only on dev ports, so caching
    // never interferes with the dev server.
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}