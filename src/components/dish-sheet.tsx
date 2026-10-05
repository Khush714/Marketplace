"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { cn, formatINR } from "@/lib/domain";
import { flyToCart } from "@/lib/fly-to-cart";
import {
  cartUnitPriceCents,
  lineKeyFor,
  useCart,
  type CartModifier,
} from "@/lib/cart";
import { useToast } from "@/lib/toast";
import type { MenuItemDto, ModifierGroupDto } from "@/lib/types";

/** groupId -> optionId -> quantity */
type Selection = Record<number, Record<number, number>>;

function groupTotal(sel: Selection, groupId: number): number {
  return Object.values(sel[groupId] ?? {}).reduce((s, q) => s + q, 0);
}

/**
 * Dish customization sheet. Opens for any dish with POS-synced modifier groups
 * and enforces the same min/max bounds computeBill validates server-side, so a
 * selection the sheet allows is always a selection checkout will accept.
 */
export function DishSheet({
  item,
  restaurantSlug,
  restaurantName,
  onClose,
}: {
  item: MenuItemDto;
  restaurantSlug: string;
  restaurantName: string;
  onClose: () => void;
}) {
  const cart = useCart();
  const { toast } = useToast();
  const groups = useMemo(() => item.modifierGroups ?? [], [item.modifierGroups]);
  const [sel, setSel] = useState<Selection>({});
  const panelRef = useRef<HTMLDivElement>(null);

  /* Escape to close, scroll lock, focus the panel so the sheet is reachable by keyboard. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock the root, not the body. `html` carries `overflow-x: clip` (see the
    // base layer in globals.css), which means it is no longer `visible` and so
    // is the element whose overflow reaches the viewport — a body-level lock
    // now configures a container that does not scroll and the page behind the
    // sheet keeps moving. Measured at an iPhone 14 viewport: with this written
    // against `body`, a real touch drag scrolled the locked page 900px.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = prev;
    };
  }, [onClose]);

  const choose = useCallback(
    (group: ModifierGroupDto, optionId: number, delta: number) => {
      setSel((prev) => {
        const current = prev[group.id] ?? {};
        const inGroup = Object.values(current).reduce((s, q) => s + q, 0);
        const currentQty = current[optionId] ?? 0;
        let nextQty = currentQty + delta;

        if (nextQty <= 0) {
          const { [optionId]: _dropped, ...rest } = current;
          return { ...prev, [group.id]: rest };
        }
        // Single-select groups behave like radio buttons.
        if (group.maxSelect === 1) return { ...prev, [group.id]: { [optionId]: 1 } };
        // Multi-select is capped by the group's total allowance, not per option.
        if (nextQty > currentQty && inGroup >= group.maxSelect) nextQty = currentQty;
        if (nextQty < 1) nextQty = 1;
        return { ...prev, [group.id]: { ...current, [optionId]: nextQty } };
      });
    },
    [],
  );

  const modifiers = useMemo<CartModifier[]>(() => {
    const out: CartModifier[] = [];
    for (const g of groups) {
      const chosen = sel[g.id] ?? {};
      for (const opt of g.options) {
        const quantity = chosen[opt.id] ?? 0;
        if (quantity <= 0) continue;
        out.push({
          optionId: opt.id,
          groupId: g.id,
          name: opt.name,
          priceCents: opt.priceCents,
          quantity,
          isVeg: opt.isVeg,
        });
      }
    }
    return out;
  }, [groups, sel]);

  const unsatisfied = groups.filter((g) => groupTotal(sel, g.id) < g.minSelect);
  const unitPrice = cartUnitPriceCents({ priceCents: item.priceCents, modifiers });
  const canAdd = unsatisfied.length === 0;

  const submit = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canAdd) {
      toast(`Select ${unsatisfied.map((g) => g.name).join(", ")}`, { kind: "error" });
      return;
    }
    const ok = cart.add(
      {
        menuItemId: item.id,
        name: item.name,
        priceCents: item.priceCents,
        imageUrl: item.imageUrl,
        isVeg: item.isVeg,
        ...(modifiers.length ? { modifiers } : {}),
        lineKey: lineKeyFor(item.id, modifiers),
      },
      restaurantSlug,
      restaurantName,
    );
    if (ok) {
      flyToCart({ x: e.clientX, y: e.clientY }, item.imageUrl);
      toast(`Added ${item.name}`, { kind: "success" });
    }
    // A false return means the cart belongs to another restaurant and the app
    // shell raised its replace-cart dialog — close so that dialog is visible.
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${item.name}`}
      className="fixed inset-0 z-[85]"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end sm:inset-0 sm:items-center sm:justify-center sm:p-4">
        <div
          ref={panelRef}
          tabIndex={-1}
          className="glass-strong animate-sheet-up pointer-events-auto flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] outline-none sm:animate-pop-in sm:rounded-3xl"
        >
          <div className="mx-auto my-2 h-1.5 w-12 shrink-0 rounded-full bg-white/25" />

          {/* header */}
          <div className="flex shrink-0 items-start gap-3 border-b border-white/8 px-5 pb-4">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl shadow-lift">
              <Image
                src={item.imageUrl}
                alt={item.name}
                fill
                sizes="64px"
                placeholder="blur"
                blurDataURL={BLUR_DATA}
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <VegDot veg={item.isVeg} />
              </div>
              <h2 className="mt-1 font-display text-base font-bold text-cream-50">{item.name}</h2>
              <p className="mt-0.5 text-sm font-semibold text-cream-200">
                {formatINR(unitPrice)}
                {modifiers.length > 0 && (
                  <span className="ml-1.5 text-xs font-medium text-cream-500">
                    base {formatINR(item.priceCents)}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="press -mr-1 rounded-full p-1.5 text-cream-400 hover:text-cream-50"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2.5} />
            </button>
          </div>

          {/* modifier groups */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {groups.map((g) => {
              const chosen = sel[g.id] ?? {};
              const total = groupTotal(sel, g.id);
              const required = g.minSelect > 0;
              const satisfied = total >= g.minSelect;
              return (
                <section key={g.id} className="mb-5 last:mb-0">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-cream-50">{g.name}</h3>
                    {required ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide",
                          satisfied ? "bg-mint-500/15 text-mint-400" : "bg-chili-500/20 text-chili-400",
                        )}
                      >
                        {satisfied ? "ADDED" : "REQUIRED"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-cream-500">
                        OPTIONAL
                      </span>
                    )}
                    <span className="ml-auto text-[11px] tabular-nums text-cream-500">
                      {g.maxSelect === 1
                        ? total > 0
                          ? "1 selected"
                          : "Select 1"
                        : `${total}/${g.maxSelect}`}
                    </span>
                  </div>

                  <ul className="space-y-1.5">
                    {g.options.map((opt) => {
                      const qty = chosen[opt.id] ?? 0;
                      const on = qty > 0;
                      return (
                        <li key={opt.id}>
                          <div
                            className={cn(
                              "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                              on
                                ? "border-ember-400/50 bg-ember-400/10"
                                : "border-white/10 bg-white/[0.03]",
                            )}
                          >
                            <button
                              type="button"
                              role={g.maxSelect === 1 ? "radio" : "checkbox"}
                              aria-checked={on}
                              disabled={!on && total >= g.maxSelect}
                              onClick={() => choose(g, opt.id, on ? -1 : 1)}
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <span
                                className={cn(
                                  "grid size-5 shrink-0 place-items-center border transition-colors",
                                  g.maxSelect === 1 ? "rounded-full" : "rounded-md",
                                  on ? "border-ember-400 bg-ember-500" : "border-cream-500/50",
                                )}
                              >
                                {on &&
                                  (g.maxSelect === 1 ? (
                                    <span className="size-2 rounded-full bg-white" />
                                  ) : (
                                    <Check className="size-3" strokeWidth={3.5} />
                                  ))}
                              </span>
                              <VegDot veg={opt.isVeg} />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-cream-100">
                                {opt.name}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-xs font-semibold tabular-nums",
                                  opt.priceCents > 0 ? "text-cream-200" : "text-mint-400",
                                )}
                              >
                                {opt.priceCents > 0 ? `+${formatINR(opt.priceCents)}` : "Included"}
                              </span>
                            </button>

                            {g.maxSelect > 1 && on && (
                              <span className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`Remove one ${opt.name}`}
                                  onClick={() => choose(g, opt.id, -1)}
                                  className="press grid size-6 place-items-center rounded-lg border border-white/15 text-cream-200 hover:bg-white/10"
                                >
                                  <Minus className="size-3" strokeWidth={3} />
                                </button>
                                <span className="w-4 text-center text-xs font-bold tabular-nums text-cream-50">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Add one ${opt.name}`}
                                  disabled={total >= g.maxSelect}
                                  onClick={() => choose(g, opt.id, 1)}
                                  className="press grid size-6 place-items-center rounded-lg border border-white/15 text-cream-200 hover:bg-white/10 disabled:opacity-40"
                                >
                                  <Plus className="size-3" strokeWidth={3} />
                                </button>
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* footer */}
          <div className="shrink-0 border-t border-white/8 bg-void/50 px-5 py-3.5">
            {unsatisfied.length > 0 && (
              <p className="mb-2 text-[11px] font-medium text-chili-400">
                {unsatisfied.length === 1
                  ? `Select ${unsatisfied[0].name.toLowerCase()} to continue`
                  : `Select ${unsatisfied.length} options to continue`}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              aria-disabled={!canAdd}
              className={cn(
                "press w-full rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow transition-all",
                canAdd ? "hover:brightness-110" : "opacity-55",
              )}
            >
              {canAdd
                ? `Add to cart · ${formatINR(unitPrice)}`
                : "Complete your selection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
