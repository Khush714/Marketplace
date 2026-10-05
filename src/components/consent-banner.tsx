"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cookie, ShieldCheck, X } from "lucide-react";
import { CONSENT_CATEGORIES, useConsent, type ConsentChoice } from "@/lib/consent";
import { cn } from "@/lib/domain";
import { useProfile } from "@/lib/profile";
import { LEGAL_ROUTES } from "@/lib/site-legal";

/**
 * The storage consent surfaces.
 *
 * Two, deliberately separated:
 *
 *   ConsentBanner       first visit only, and non-blocking. Nothing here is a
 *                       tracker, so declining costs the visitor nothing they
 *                       were going to use — there is no reason to stand between
 *                       them and a menu.
 *   ConsentPreferences  the same categories as a real dialog, reachable forever
 *                       from the footer so the answer can be changed.
 *
 * The brand is written literally rather than imported from `site-legal`, whose
 * doc comment is explicit that its values must not enter the client bundle.
 */

/**
 * Mount point, rendered inside both the consent and profile providers.
 *
 * Returns null once the visitor has decided and the dialog is closed, so the
 * only cost of this feature on a returning visit is one component rendering
 * nothing.
 */
export function ConsentSurface() {
  const { hydrated, choice, preferencesOpen, decide, openPreferences, closePreferences } = useConsent();
  const { clearPersonalisation } = useProfile();

  // Withdrawing consent has to reach the data already on disk, not merely stop
  // future writes. Gated on an explicit "essential", never on the absence of a
  // record — otherwise a returning visitor's favourites would be wiped by the
  // banner they have not answered yet.
  useEffect(() => {
    if (choice === "essential") clearPersonalisation();
  }, [choice, clearPersonalisation]);

  if (!hydrated) return null;

  return (
    <>
      {choice === null && <ConsentBanner onDecide={decide} onManage={openPreferences} />}
      {preferencesOpen && <ConsentPreferences onClose={closePreferences} onDecide={decide} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  First-visit banner                                                          */
/* -------------------------------------------------------------------------- */

function ConsentBanner({
  onDecide,
  onManage,
}: {
  onDecide: (choice: ConsentChoice) => void;
  onManage: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div
      // Announced rather than focused: stealing focus on load would fight the
      // header and would be hostile for a keyboard user landing on a menu page.
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[88] flex justify-center px-4 md:bottom-6"
    >
      <section
        aria-label="Storage and cookie preferences"
        className="glass-strong animate-sheet-up pointer-events-auto w-full max-w-lg rounded-3xl p-5 shadow-float"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ember-400/15 text-ember-400">
            <Cookie className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-bold text-cream-50">
              We keep a little on your device
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-cream-400">
              crave. sets no cookies and runs no trackers. Your cart, area and saved details stay
              in this browser so checkout is quick — they reach us only when you place an order.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          aria-expanded={showDetail}
          className="press mt-3 rounded-lg text-xs font-semibold text-ember-400 underline-offset-4 transition-colors hover:text-ember-300 hover:underline"
        >
          {showDetail ? "Hide what we store" : "See exactly what we store"}
        </button>

        {showDetail && (
          <ul className="mt-3 space-y-3 border-t border-white/8 pt-4">
            {CONSENT_CATEGORIES.map((category) => (
              <li key={category.id}>
                <p className="flex flex-wrap items-center gap-2 text-xs font-bold text-cream-200">
                  {category.label}
                  {category.required && (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cream-500">
                      Always on
                    </span>
                  )}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {category.held.map((item) => (
                    <li key={item} className="flex gap-2 text-xs leading-relaxed text-cream-500">
                      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-cream-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onDecide("essential")}
            className="press rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => onDecide("all")}
            className="press relative overflow-hidden rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={onManage}
            className="press ml-auto rounded-lg px-2 py-2 text-xs font-semibold text-cream-500 underline-offset-4 transition-colors hover:text-cream-200 hover:underline"
          >
            Manage choices
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-cream-600">
          Choosing essential only clears your favourites and recent searches from this browser. See
          the{" "}
          <Link
            href={LEGAL_ROUTES.privacy}
            className="text-cream-400 underline-offset-4 transition-colors hover:underline"
          >
            privacy policy
          </Link>{" "}
          for the full list.
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Preferences dialog — footer reachable, closable, fully reversible            */
/* -------------------------------------------------------------------------- */

function ConsentPreferences({
  onClose,
  onDecide,
}: {
  onClose: () => void;
  onDecide: (choice: ConsentChoice) => void;
}) {
  const { choice } = useConsent();
  const panelRef = useRef<HTMLDivElement>(null);
  const [personalisation, setPersonalisation] = useState(choice === "all");

  // Locking documentElement rather than body: the base layer routes viewport
  // height through it, so a body-level lock scrolls the page behind (measured —
  // see the note in globals.css).
  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!active || !panelRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-prefs-title"
      className="fixed inset-0 z-[86] grid place-items-center px-4"
    >
      <button
        aria-label="Close preferences"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        className="glass-strong animate-pop-in relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mint-400/15 text-mint-400">
              <ShieldCheck className="size-4.5" />
            </span>
            <h2 id="consent-prefs-title" className="font-display text-base font-bold text-cream-50">
              Storage preferences
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press -mr-1.5 rounded-full p-1.5 text-cream-400 transition-colors hover:text-cream-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-cream-400">
          crave. sets no cookies and loads no third-party trackers. These are the only things written
          to this browser, and you can change your mind at any time.
        </p>

        <ul className="mt-5 space-y-4">
          {CONSENT_CATEGORIES.map((category) => {
            const on = category.required ? true : personalisation;
            return (
              <li key={category.id} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-cream-50">{category.label}</p>
                  {category.required ? (
                    <span className="shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cream-500">
                      Always on
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={category.label}
                      onClick={() => setPersonalisation((v) => !v)}
                      className={cn(
                        "press relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
                        on ? "bg-mint-500" : "bg-white/15",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-0.5 size-5 rounded-full bg-white shadow-lift transition-transform duration-300",
                          on ? "translate-x-[22px]" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  )}
                </div>
                <ul className="mt-2.5 space-y-1">
                  {category.held.map((item) => (
                    <li key={item} className="flex gap-2 text-xs leading-relaxed text-cream-500">
                      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-cream-600" />
                      {item}
                    </li>
                  ))}
                </ul>
                {!category.required && !on && (
                  <p className="mt-2.5 text-[11px] font-medium text-gold-400">
                    Switching this off clears your existing favourites and recent searches.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="press flex-1 rounded-xl bg-white/8 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onDecide(personalisation ? "all" : "essential")}
            className="press relative flex-1 overflow-hidden rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-2.5 text-sm font-bold text-white shadow-glow"
          >
            Save choices
          </button>
        </div>
      </div>
    </div>
  );
}
