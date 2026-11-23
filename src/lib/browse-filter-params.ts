/**
 * URL ⇄ filter values for the customer browse grid.
 *
 * Every browse filter is a URL param: the page is shareable, the back button
 * works, and the server can render the filtered grid without a client fetch.
 * Keeping the parsing/serialising here (instead of in the page, the API and the
 * filter bar) means all three agree on which values are real. Unknown or
 * hand-typed values are dropped rather than passed into SQL.
 */

export interface BrowseParams {
  q?: string | string[];
  cuisine?: string | string[];
  sort?: string | string[];
  offers?: string | string[];
  minRating?: string | string[];
  veg?: string | string[];
  /** Open right now according to the merchant's published IST hours. */
  open?: string | string[];
  /** Merchant App says delivery is enabled, and it is within those hours. */
  delivery?: string | string[];
  /** Cost-for-two tier shown on cards as ₹…₹₹₹₹. */
  price?: string | string[];
  /** Upper bound on the published delivery estimate, in minutes. */
  maxTime?: string | string[];
  loc?: string | string[];
}

export type BrowseSort = "rating" | "fast" | "near" | "price-low" | "price-high";

export const PRICE_LEVELS = [1, 2, 3, 4] as const;
export const DELIVERY_TIMES = [20, 30, 45] as const;
export const BROWSE_SORTS: readonly BrowseSort[] = ["rating", "fast", "near", "price-low", "price-high"];

const PARAM_KEYS = [
  "q",
  "cuisine",
  "sort",
  "offers",
  "minRating",
  "veg",
  "open",
  "delivery",
  "price",
  "maxTime",
  "loc",
] as const;

/** Next.js gives string | string[] | undefined; a repeated param is not a filter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function paramOn(value: string | string[] | undefined): boolean {
  return firstParam(value) === "1";
}

export function parseSort(value: string | string[] | undefined): BrowseSort | undefined {
  const raw = firstParam(value);
  return BROWSE_SORTS.find((sort) => sort === raw);
}

export function parsePriceLevel(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const level = Number(raw);
  return PRICE_LEVELS.find((candidate) => candidate === level);
}

export function parseMaxDeliveryMinutes(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const minutes = Number(raw);
  return DELIVERY_TIMES.find((candidate) => candidate === minutes);
}

export interface ParsedBrowseParams {
  q?: string;
  cuisine?: string;
  sort?: BrowseSort;
  offers: boolean;
  minRating: boolean;
  veg: boolean;
  openNow: boolean;
  delivery: boolean;
  price?: number;
  maxTime?: number;
  loc?: string;
}

export function parseBrowseParams(params: BrowseParams): ParsedBrowseParams {
  return {
    q: firstParam(params.q),
    cuisine: firstParam(params.cuisine),
    sort: parseSort(params.sort),
    offers: paramOn(params.offers),
    minRating: paramOn(params.minRating),
    veg: paramOn(params.veg),
    openNow: paramOn(params.open),
    delivery: paramOn(params.delivery),
    price: parsePriceLevel(params.price),
    maxTime: parseMaxDeliveryMinutes(params.maxTime),
    loc: firstParam(params.loc),
  };
}

/** Serialise a whole filter state. Falsy values are omitted, so toggles remove their key. */
export function browseHref(params: BrowseParams): string {
  const query = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = firstParam(params[key]);
    if (value) query.set(key, value);
  }
  const tail = query.toString();
  return `/restaurants${tail ? `?${tail}` : ""}`;
}

export function withBrowseParam(params: BrowseParams, patch: Partial<BrowseParams>): string {
  return browseHref({ ...params, ...patch });
}

/** Counts only real, applied filters — used by the mobile sheet badge. */
export function activeFilterCount(params: BrowseParams): number {
  const parsed = parseBrowseParams(params);
  return (
    (parsed.offers ? 1 : 0) +
    (parsed.minRating ? 1 : 0) +
    (parsed.veg ? 1 : 0) +
    (parsed.openNow ? 1 : 0) +
    (parsed.delivery ? 1 : 0) +
    (parsed.price !== undefined ? 1 : 0) +
    (parsed.maxTime !== undefined ? 1 : 0) +
    (parsed.sort ? 1 : 0)
  );
}
