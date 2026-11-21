"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CartModifier {
  optionId: number;
  groupId: number;
  name: string;
  priceCents: number;
  quantity: number;
  isVeg: boolean;
}

export interface CartItem {
  menuItemId: number;
  name: string;
  /** Base dish price only — modifier prices live on `modifiers`. */
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  quantity: number;
  modifiers?: CartModifier[];
  /** Stable identity: dish + exact modifier selection. Persisted, never rebuilt. */
  lineKey: string;
}

export interface CartState {
  restaurantSlug: string;
  restaurantName: string;
  items: CartItem[];
}

interface PendingAdd {
  restaurantSlug: string;
  restaurantName: string;
  item: Omit<CartItem, "quantity">;
}

interface CartContextValue extends CartState {
  hydrated: boolean;
  itemCount: number;
  subtotalCents: number;
  /** Quantity for one exact line (dish + modifier selection). */
  quantityOf: (lineKey: string) => number;
  /** Total quantity of a dish across every modifier selection of it. */
  dishQuantityOf: (menuItemId: number) => number;
  /** Returns true if added; false + sets `conflict` when cart belongs to another restaurant. */
  add: (item: Omit<CartItem, "quantity">, restaurantSlug: string, restaurantName: string) => boolean;
  setQuantity: (lineKey: string, quantity: number) => void;
  clear: () => void;
  conflict: PendingAdd | null;
  resolveConflict: (replace: boolean) => void;
  /** increments on every add — used for badge bump animation */
  bump: number;
}

/**
 * Cart lines are identified by dish *and* modifier selection, so a burger with
 * extra cheese merges with itself but never with the same burger plain. The key
 * is built from sorted option ids so selection order can't fork a line.
 */
export function lineKeyFor(menuItemId: number, modifiers?: CartModifier[]): string {
  const opts = (modifiers ?? [])
    .filter((m) => m.quantity > 0)
    .map((m) => `${m.optionId}x${m.quantity}`)
    .sort();
  return opts.length ? `${menuItemId}::${opts.join(",")}` : String(menuItemId);
}

/** Per-unit price of a line: base dish plus its selected modifiers. */
export function cartUnitPriceCents(item: Pick<CartItem, "priceCents" | "modifiers">): number {
  const modifiers = (item.modifiers ?? []).reduce((s, m) => s + m.priceCents * m.quantity, 0);
  return item.priceCents + modifiers;
}

/** Rupee cost of a modifier selection — server bills this per line, not per unit. */
export function cartModifierTotalCents(item: Pick<CartItem, "modifiers">): number {
  return (item.modifiers ?? []).reduce((s, m) => s + m.priceCents * m.quantity, 0);
}

const CartContext = createContext<CartContextValue | null>(null);
const KEY = "crave.cart.v2";
/** v1 predates modifiers: those lines have no selection and stay valid as-is. */
const LEGACY_KEY = "crave.cart.v1";

const EMPTY: CartState = { restaurantSlug: "", restaurantName: "", items: [] };

/** Backfill `lineKey` on stored items so v1 carts survive the v2 shape change. */
function normalizeItem(raw: unknown): CartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Partial<CartItem>;
  if (typeof i.menuItemId !== "number" || typeof i.name !== "string") return null;
  const modifiers = Array.isArray(i.modifiers)
    ? i.modifiers.filter(
        (m): m is CartModifier => !!m && typeof m.optionId === "number" && typeof m.name === "string",
      )
    : undefined;
  return {
    menuItemId: i.menuItemId,
    name: i.name,
    priceCents: Number(i.priceCents) || 0,
    imageUrl: typeof i.imageUrl === "string" ? i.imageUrl : "",
    isVeg: !!i.isVeg,
    quantity: Math.max(1, Math.floor(Number(i.quantity)) || 1),
    ...(modifiers?.length ? { modifiers } : {}),
    lineKey: typeof i.lineKey === "string" && i.lineKey ? i.lineKey : lineKeyFor(i.menuItemId, modifiers),
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [conflict, setConflict] = useState<PendingAdd | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        if (parsed && Array.isArray(parsed.items)) {
          const items = parsed.items
            .map(normalizeItem)
            .filter((i): i is CartItem => i !== null);
          setState({ restaurantSlug: parsed.restaurantSlug ?? "", restaurantName: parsed.restaurantName ?? "", items });
          localStorage.removeItem(LEGACY_KEY);
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  const add = useCallback(
    (item: Omit<CartItem, "quantity">, restaurantSlug: string, restaurantName: string) => {
      if (state.items.length > 0 && state.restaurantSlug !== restaurantSlug) {
        setConflict({ restaurantSlug, restaurantName, item });
        return false;
      }
      setState((s) => {
        const existing = s.items.find((i) => i.lineKey === item.lineKey);
        const items = existing
          ? s.items.map((i) => (i.lineKey === item.lineKey ? { ...i, quantity: i.quantity + 1 } : i))
          : [...s.items, { ...item, quantity: 1 }];
        return { restaurantSlug, restaurantName, items };
      });
      setBump((b) => b + 1);
      return true;
    },
    [state.items.length, state.restaurantSlug],
  );

  const resolveConflict = useCallback(
    (replace: boolean) => {
      if (replace && conflict) {
        setState({
          restaurantSlug: conflict.restaurantSlug,
          restaurantName: conflict.restaurantName,
          items: [{ ...conflict.item, quantity: 1 }],
        });
        setBump((b) => b + 1);
      }
      setConflict(null);
    },
    [conflict],
  );

  const setQuantity = useCallback((lineKey: string, quantity: number) => {
    setState((s) => {
      if (quantity <= 0) {
        const items = s.items.filter((i) => i.lineKey !== lineKey);
        return items.length ? { ...s, items } : EMPTY;
      }
      return {
        ...s,
        items: s.items.map((i) => (i.lineKey === lineKey ? { ...i, quantity } : i)),
      };
    });
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  const { itemCount, subtotalCents } = useMemo(() => {
    let count = 0;
    let subtotal = 0;
    for (const i of state.items) {
      count += i.quantity;
      // Mirrors computeBill exactly: base × qty, modifiers charged once per line.
      subtotal += i.priceCents * i.quantity + cartModifierTotalCents(i);
    }
    return { itemCount: count, subtotalCents: subtotal };
  }, [state.items]);

  const quantityOf = useCallback(
    (lineKey: string) => state.items.find((i) => i.lineKey === lineKey)?.quantity ?? 0,
    [state.items],
  );

  const dishQuantityOf = useCallback(
    (menuItemId: number) =>
      state.items.filter((i) => i.menuItemId === menuItemId).reduce((s, i) => s + i.quantity, 0),
    [state.items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      hydrated,
      itemCount,
      subtotalCents,
      quantityOf,
      dishQuantityOf,
      add,
      setQuantity,
      clear,
      conflict,
      resolveConflict,
      bump,
    }),
    [state, hydrated, itemCount, subtotalCents, quantityOf, dishQuantityOf, add, setQuantity, clear, conflict, resolveConflict, bump],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
