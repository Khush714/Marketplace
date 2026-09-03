"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Discovery-only marketplace shell. No cart, no checkout — ordering happens on
 * each restaurant's own POS via the ORDER ONLINE deep-link.
 */

const BARE_ROUTES: string[] = [];

const TABS = [
  { href: "/", label: "Home", icon: "🏠", match: (p: string) => p === "/" },
  {
    href: "/restaurants",
    label: "Restaurants",
    icon: "🍽️",
    match: (p: string) => p.startsWith("/restaurant"),
  },
  {
    href: "/search",
    label: "Search",
    icon: "🔍",
    match: (p: string) => p.startsWith("/search"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: "👤",
    match: (p: string) => p.startsWith("/profile"),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="flex min-h-screen flex-col">
      {!bare && <TopBar />}
      <div className="flex-1 pb-24 md:pb-8">{children}</div>
      {!bare && <TabBar pathname={pathname} />}
      <ServiceWorker />
    </div>
  );
}

function TopBar() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-500 text-lg text-white shadow-sm">
            🍽️
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            TABL<span className="text-orange-500">Z</span>
          </span>
        </Link>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim())
              router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="relative hidden flex-1 md:block"
        >
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search restaurants or food"
            className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-4 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
          />
        </form>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {TABS.filter((t) => t.href !== "/").map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <div className="mx-auto flex max-w-lg">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                active ? "text-orange-600" : "text-slate-400"
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
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
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
