/**
 * Cursor pagination shared by list routes.
 *
 * The cursor is an opaque base64url encoding of an integer offset. Offset
 * pagination is the pragmatic choice here: browse supports five different sort
 * orders, and a keyset cursor would need a per-sort tuple (rating/id,
 * deliveryMinutes/id, priceLevel/id, distanceKm-null-last/id, featured/rating/id)
 * that is easy to get subtly wrong. The trade-off — a row inserted mid-walk can
 * shift a later page — is acceptable for a low-write public catalogue.
 *
 * It lives in a `*-core.ts` module (pure, no `server-only`, no DB, no network)
 * so the clamping and cursor round-trip can be unit tested on their own.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/** Hard cap applied when a caller does not paginate (e.g. an RSC list). */
export const DEFAULT_LIST_LIMIT = 60;

export interface PageParams {
  limit?: number;
  offset?: number;
}

/** Clamp a caller-supplied page size into (0, MAX_PAGE_SIZE]. */
export function parsePageSize(
  raw: string | null | undefined,
  fallback: number = DEFAULT_PAGE_SIZE,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string | null {
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** Encode an offset as an opaque, URL-safe cursor. */
export function encodeCursor(offset: number): string {
  return toBase64Url(`o:${Math.max(0, Math.floor(offset))}`);
}

/**
 * Decode a cursor back to an offset. Anything malformed, negative or missing
 * decodes to 0 rather than throwing — a bad cursor is a fresh start, not a 500.
 */
export function decodeCursor(raw: string | null | undefined): number {
  if (!raw) return 0;
  const decoded = fromBase64Url(raw);
  if (!decoded) return 0;
  const match = /^o:(\d+)$/.exec(decoded);
  if (!match) return 0;
  return Math.max(0, Number(match[1]));
}

/**
 * The cursor for the page after a full page, or `null` when the listing is
 * exhausted. Callers must request exactly `pageSize` rows; a short page means
 * there is nothing more to fetch.
 */
export function nextCursor(
  offset: number,
  pageSize: number,
  rowCount: number,
): string | null {
  return rowCount < pageSize ? null : encodeCursor(offset + rowCount);
}
