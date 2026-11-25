/** Pure cart normalization/merge shared by browser storage and account sync. */

export interface CartModifierLike {
  optionId: number;
  groupId: number;
  name: string;
  priceCents: number;
  quantity: number;
  isVeg: boolean;
}

export interface CartLineLike {
  menuItemId: number;
  name: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  quantity: number;
  modifiers?: CartModifierLike[];
  lineKey?: string;
}

export interface CartStateLike {
  restaurantSlug: string;
  restaurantName: string;
  items: CartLineLike[];
}

function keyFor(line: CartLineLike): string {
  if (typeof line.lineKey === "string" && line.lineKey) return line.lineKey;
  const opts = (line.modifiers ?? [])
    .filter((m) => m.quantity > 0)
    .map((m) => `${m.optionId}x${m.quantity}`)
    .sort();
  return opts.length ? `${line.menuItemId}::${opts.join(",")}` : String(line.menuItemId);
}

function normalizeLine(raw: unknown): CartLineLike | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CartLineLike>;
  if (!Number.isInteger(r.menuItemId) || (r.menuItemId ?? 0) <= 0 || typeof r.name !== "string") return null;
  const modifiers = Array.isArray(r.modifiers)
    ? r.modifiers.filter(
        (m): m is CartModifierLike =>
          !!m && typeof m === "object" && Number.isInteger(m.optionId) && typeof m.name === "string",
      )
    : undefined;
  const line: CartLineLike = {
    menuItemId: r.menuItemId as number,
    name: r.name,
    priceCents: Number.isFinite(r.priceCents) ? (r.priceCents as number) : 0,
    imageUrl: typeof r.imageUrl === "string" ? r.imageUrl : "",
    isVeg: Boolean(r.isVeg),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(r.quantity)) || 1)),
    ...(modifiers?.length ? { modifiers } : {}),
  };
  return { ...line, lineKey: keyFor(line) };
}

export function normalizeCartState(raw: unknown): CartStateLike | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Partial<CartStateLike>;
  if (!Array.isArray(r.items)) return null;
  const seen = new Set<string>();
  const items: CartLineLike[] = [];
  for (const entry of r.items.slice(0, 50)) {
    const line = normalizeLine(entry);
    if (!line) continue;
    const key = keyFor(line);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...line, lineKey: key });
  }
  return {
    restaurantSlug: typeof r.restaurantSlug === "string" ? r.restaurantSlug.slice(0, 120) : "",
    restaurantName: typeof r.restaurantName === "string" ? r.restaurantName.slice(0, 120) : "",
    items,
  };
}

/**
 * On sign-in the account's server cart wins when it has contents; an empty
 * server cart adopts the current browser cart so a first-time sync never wipes
 * what the customer just built.
 */
export function mergeCartStates(local: CartStateLike | null, remote: CartStateLike | null): CartStateLike {
  if (remote && remote.items.length > 0) return remote;
  if (local && local.items.length > 0) return local;
  return { restaurantSlug: "", restaurantName: "", items: [] };
}
