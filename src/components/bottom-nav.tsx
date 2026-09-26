"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Search, ReceiptText, CircleUserRound, type LucideIcon } from "lucide-react";
import { useSearch } from "@/components/search-overlay";
import { cn } from "@/lib/domain";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const TABS: Tab[] = [
  { href: "/", label: "Home", icon: House, match: (p) => p === "/" },
  { href: "/orders", label: "Orders", icon: ReceiptText, match: (p) => p.startsWith("/orders") || p.startsWith("/order") },
  { href: "/profile", label: "Profile", icon: CircleUserRound, match: (p) => p.startsWith("/profile") },
];

const COLUMN_OF = [0, 2, 3];

export function BottomNav() {
  const pathname = usePathname();
  const { open, isOpen } = useSearch();

  if (pathname === "/cart" || pathname === "/checkout") return null;

  const activeIndex = TABS.findIndex((t) => t.match(pathname));
  const activeColumn = activeIndex === -1 ? -1 : COLUMN_OF[activeIndex];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-3 z-50 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="glass-strong relative mx-auto grid max-w-sm grid-cols-4 items-center overflow-hidden rounded-3xl">
        {/* sliding liquid indicator — 1/4 width, translated by column */}
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-1/4 px-1 transition-transform duration-[520ms] ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{ transform: `translateX(${Math.max(0, activeColumn) * 100}%)`, opacity: activeColumn === -1 ? 0 : 1 }}
        >
          <span className="block h-full rounded-2xl bg-gradient-to-b from-white/10 to-white/[0.04] ring-1 ring-white/10" />
        </span>

        <NavItem tab={TABS[0]} active={TABS[0].match(pathname)} />
        <NavButton icon={Search} label="Search" active={isOpen} onClick={open} />
        <NavItem tab={TABS[1]} active={TABS[1].match(pathname)} />
        <NavItem tab={TABS[2]} active={TABS[2].match(pathname)} />
      </div>
    </nav>
  );
}

function NavItem({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className="press relative z-10 flex flex-col items-center gap-0.5 rounded-2xl px-1 py-2"
    >
      <NavContents icon={tab.icon} label={tab.label} active={active} />
    </Link>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={active}
      aria-controls="search-dialog"
      className="press relative z-10 flex flex-col items-center gap-0.5 rounded-2xl px-1 py-2"
    >
      <NavContents icon={Icon} label={label} active={active} />
    </button>
  );
}

function NavContents({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <span
        className={cn(
          "relative grid place-items-center transition-all duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          active ? "-translate-y-1 scale-115 text-ember-400" : "text-cream-500",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="animate-glow-breathe absolute inset-0 -z-10 rounded-full bg-ember-400/20 blur-md"
          />
        )}
        <Icon className="size-5" strokeWidth={active ? 2.5 : 2} />
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold transition-all duration-300",
          active ? "text-cream-50" : "text-cream-500",
        )}
      >
        {label}
      </span>
    </>
  );
}
