import Link from "next/link";
import { Flame } from "lucide-react";
import { cn } from "@/lib/domain";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Crave home"
      className={cn("group flex items-center gap-2 outline-none press", className)}
    >
      <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-ember-400 via-chili-500 to-chili-600 shadow-glow transition-transform duration-300 ease-out group-hover:scale-105 group-hover:rotate-3">
        <Flame className="size-5 text-white" strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className="font-display text-xl font-bold tracking-tight text-cream-50">
          crave<span className="text-chili-500">.</span>
        </span>
      )}
    </Link>
  );
}
