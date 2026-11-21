"use client";

import { Check, LocateFixed, MapPin, TriangleAlert } from "lucide-react";
import { LOCALITIES } from "@/lib/domain";
import { cn } from "@/lib/domain";
import { useLocation } from "@/lib/location";

/**
 * Zomato-style "Choose your delivery location" picker.
 * Lists served localities + a "Use my location" GPS action.
 */
export function LocationPicker() {
  const { locality, detecting, autoDetected, status, notServed, setLocality, detect, closePicker } = useLocation();

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose your delivery location" className="fixed inset-0 z-[85]">
      <button
        aria-label="Close location picker"
        onClick={closePicker}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end sm:inset-0 sm:items-center sm:justify-center sm:p-4">
        <div className="glass-strong animate-sheet-up pointer-events-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-3 sm:animate-pop-in sm:rounded-3xl">
        {/* drag handle */}
        <div className="mx-auto my-2 h-1.5 w-12 rounded-full bg-white/25" />

        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-cream-50">Choose your location</h2>
          <button
            type="button"
            onClick={closePicker}
            className="press rounded-full p-1.5 text-cream-400 hover:text-cream-50"
            aria-label="Close"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* use my location */}
        <button
          type="button"
          onClick={detect}
          disabled={detecting}
          className={cn(
            "press relative mb-4 flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-all duration-300",
            autoDetected && !detecting
              ? "border-mint-400/40 bg-mint-500/10"
              : "border-white/12 bg-white/[0.05] hover:border-white/25 hover:bg-white/[0.09]",
          )}
        >
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              detecting ? "bg-white/8 text-chili-400" : "bg-chili-500/15 text-chili-400",
            )}
          >
            {detecting ? (
              <span className="animate-spin-slow inline-block size-4.5 rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <LocateFixed className="size-4.5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-cream-50">
              {detecting ? "Detecting your location…" : "Use my current location"}
            </span>
            <span className="block text-xs text-cream-500">
              {detecting
                ? "Snapping to the nearest area we serve"
                : status === "served" && autoDetected
                  ? `Detected — serving near ${locality.name}`
                  : status === "out-of-range"
                    ? "We don't deliver to your location yet"
                    : status === "denied"
                      ? "Location not shared — pick an area below"
                      : "Auto-detect where you are and refine the list"}
            </span>
          </span>
          {!detecting && status === "served" && autoDetected && <Check className="size-4 shrink-0 text-mint-400" strokeWidth={3} />}
        </button>

        {notServed && (
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-gold-400/25 bg-gold-400/10 px-4 py-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold-400" />
            <p className="text-xs leading-relaxed text-cream-300">
              {status === "out-of-range"
                ? "Looks like you're outside our delivery area. Pick an area below to browse restaurants, or deliveries may not reach you yet."
                : "We couldn't fetch your location. Pick an area below to browse restaurants."}
            </p>
          </div>
        )}

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">Areas we deliver to</p>
        <ul className="space-y-1">
          {LOCALITIES.map((l) => {
            const active = l.key === locality.key;
            return (
              <li key={l.key}>
                <button
                  type="button"
                  onClick={() => setLocality(l.key)}
                  aria-pressed={active}
                  className={cn(
                    "press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all duration-200",
                    active ? "bg-white/8 ring-1 ring-white/10" : "hover:bg-white/5",
                  )}
                >
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", active ? "bg-chili-500/20 text-chili-400" : "bg-white/6 text-cream-400")}>
                    <MapPin className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-semibold", active ? "text-cream-50" : "text-cream-200")}>
                      {l.name}
                    </span>
                    <span className="block text-xs text-cream-500">{l.city} {l.pincode}</span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-chili-400" strokeWidth={3} />}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-center text-[11px] text-cream-600">
          Restaurants automatically refine to serve your chosen area.
        </p>
        </div>
      </div>
    </div>
  );
}