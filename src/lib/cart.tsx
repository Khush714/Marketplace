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

export interface CartItem {
  menuItemId: number;
  name: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  quantity: number;
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
  quantityOf: (menuItemId: number) => number;
  /** Returns true if added; false + sets `conflict` when cart belongs to another restaurant. */
  add: (item: Omit<CartItem, "quantity">, restaurantSlug: string, restaurantName: string) => boolean;
  setQuantity: (menuItemId: number, quantity: number) => void;
  clear: () => void;
  conflict: PendingAdd | null;
  resolveConflict: (replace: boolean) => void;
  /** increments on every add — used for badge bump animation */
  bump: number;
}

const CartContext = createContext<CartContextValue | null>(null);
const KEY = "crave.cart.v1";

const EMPTY: CartState = { restaurantSlug: "", restaurantName: "", items: [] };

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [conflict, setConflict] = useState<PendingAdd | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        if (parsed && Array.isArray(parsed.items)) setState(parsed);
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
        const existing = s.items.find((i) => i.menuItemId === item.menuItemId);
        const items = existing
          ? s.items.map((i) =>
              i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i,
            )
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

  const setQuantity = useCallback((menuItemId: number, quantity: number) => {
    setState((s) => {
      if (quantity <= 0) {
        const items = s.items.filter((i) => i.menuItemId !== menuItemId);
        return items.length ? { ...s, items } : EMPTY;
      }
      return {
        ...s,
        items: s.items.map((i) => (i.menuItemId === menuItemId ? { ...i, quantity } : i)),
      };
    });
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  const { itemCount, subtotalCents } = useMemo(() => {
    let count = 0;
    let subtotal = 0;
    for (const i of state.items) {
      count += i.quantity;
      subtotal += i.priceCents * i.quantity;
    }
    return { itemCount: count, subtotalCents: subtotal };
  }, [state.items]);

  const quantityOf = useCallback(
    (menuItemId: number) => state.items.find((i) => i.menuItemId === menuItemId)?.quantity ?? 0,
    [state.items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      hydrated,
      itemCount,
      subtotalCents,
      quantityOf,
      add,
      setQuantity,
      clear,
      conflict,
      resolveConflict,
      bump,
    }),
    [state, hydrated, itemCount, subtotalCents, quantityOf, add, setQuantity, clear, conflict, resolveConflict, bump],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
