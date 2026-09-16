"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Ripple } from "@/components/motion-primitives";
import { cn } from "@/lib/domain";
import { flyToCart } from "@/lib/fly-to-cart";
import { useCart, type CartItem } from "@/lib/cart";
import { useToast } from "@/lib/toast";

/**
 * "Add" ⟷ quantity stepper morph. Fires a fly-to-cart arc and a click ripple
 * anchored at the pointer. All cart mutations stay in the cart engine.
 */
export function AddButton({
  item,
  restaurantSlug,
  restaurantName,
  className,
  compact = false,
}: {
  item: Omit<CartItem, "quantity">;
  restaurantSlug: string;
  restaurantName: string;
  className?: string;
  compact?: boolean;
}) {
  const cart = useCart();
  const { toast } = useToast();
  const [ripple, setRipple] = useState(0);
  const qty = cart.quantityOf(item.menuItemId);

  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--rx-pt", `${e.clientX - rect.left}px`);
          e.currentTarget.style.setProperty("--ry-pt", `${e.clientY - rect.top}px`);

          const ok = cart.add(item, restaurantSlug, restaurantName);
          if (ok) {
            flyToCart({ x: e.clientX, y: e.clientY }, item.imageUrl);
            setRipple((r) => r + 1);
            toast(`Added ${item.name}`, { kind: "success" });
          }
        }}
        className={cn(
          "press relative overflow-hidden rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 font-bold text-white shadow-glow",
          "transition-all duration-200 hover:shadow-[0_12px_42px_-6px_rgba(255,90,60,0.65)] hover:brightness-110",
          compact ? "px-4 py-1.5 text-xs" : "px-6 py-2 text-sm",
          className,
        )}
        aria-label={`Add ${item.name} to cart`}
      >
        <span className="relative z-10">ADD</span>
        <Ripple id={ripple} />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Quantity of ${item.name}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "animate-pop-in relative flex items-center overflow-hidden rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 font-bold text-white shadow-glow",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => cart.setQuantity(item.menuItemId, qty - 1)}
        className={cn(
          "press relative grid place-items-center rounded-l-xl transition-colors hover:bg-white/15",
          compact ? "px-2 py-1.5" : "px-2.5 py-2",
        )}
      >
        <Minus className={compact ? "size-3.5" : "size-4"} strokeWidth={3} />
      </button>
      <span
        key={qty}
        className={cn("animate-count-pop grid min-w-6 place-items-center tabular-nums", compact ? "text-xs" : "text-sm")}
      >
        {qty}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => {
          cart.setQuantity(item.menuItemId, qty + 1);
          setRipple((r) => r + 1);
        }}
        className={cn(
          "press relative grid place-items-center rounded-r-xl transition-colors hover:bg-white/15",
          compact ? "px-2 py-1.5" : "px-2.5 py-2",
        )}
      >
        <Plus className={compact ? "size-3.5" : "size-4"} strokeWidth={3} />
        <Ripple id={ripple} />
      </button>
    </div>
  );
}
