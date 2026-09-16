import { ChevronRight, Leaf, Star } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/domain";

export const BLUR_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8//8/AzGAiShVDAwMAAA5/wH/AO3zbwAAAABJRU5ErkJggg==";

export function RatingBadge({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-400",
        className,
      )}
    >
      <Star className="size-3 fill-current" />
      {rating.toFixed(1)}
    </span>
  );
}

export function VegDot({ veg, className }: { veg: boolean; className?: string }) {
  return (
    <span
      title={veg ? "Pure veg" : "Contains non-veg"}
      className={cn(
        "inline-grid size-4 place-items-center rounded-[4px] border",
        veg ? "border-mint-400/60 bg-mint-500/10" : "border-chili-400/60 bg-chili-500/10",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", veg ? "bg-mint-400" : "bg-chili-400")} />
    </span>
  );
}

export function SectionHeader({
  title,
  sub,
  href,
  action,
  className,
}: {
  title: string;
  sub?: string;
  href?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-cream-50 md:text-2xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-cream-500">{sub}</p>}
      </div>
      {href ? (
        <a
          href={href}
          className="press group flex shrink-0 items-center gap-1 text-sm font-semibold text-ember-300 transition-colors hover:text-ember-400"
        >
          See all
          <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </a>
      ) : (
        action
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-in flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/12 bg-white/[0.03] px-6 py-14 text-center">
      {icon && (
        <span className="grid size-14 place-items-center rounded-2xl bg-white/6 text-cream-400">{icon}</span>
      )}
      <p className="font-display text-lg font-semibold text-cream-200">{title}</p>
      {sub && <p className="max-w-xs text-sm text-cream-500">{sub}</p>}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin-slow rounded-full border-2 border-white/20 border-t-cream-50",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PureVegTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/15 px-2 py-0.5 text-[11px] font-bold text-mint-400">
      <Leaf className="size-3" /> Pure Veg
    </span>
  );
}
