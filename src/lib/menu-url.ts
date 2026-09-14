/**
 * Restaurant menu / ordering URL.
 *
 * The marketplace does not create the order — ORDER ONLINE deep-links to
 * whatever URL the restaurant's existing POS exposes. This module validates
 * and normalises that URL before we persist it.
 *
 * For production we would eventually require HTTPS (except in local dev);
 * today we accept both http and https so localhost testing still works.
 */
export function normalizeMenuUrl(value: string): string {
  const raw = value.trim();

  if (!raw) {
    return "";
  }

  if (raw.length > 2048) {
    throw new Error("Menu URL is too long");
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("Menu URL must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Menu URL must use HTTP or HTTPS");
  }

  return url.toString();
}

/**
 * True when the menu URL is a real, externally-hosted URL the customer should
 * be sent to directly — as opposed to a localhost/dev or placeholder
 * (example.com) value, in which case the marketplace keeps customers on its
 * own rendered menu page instead.
 */
export function isRemoteMenuUrl(value: string): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  if (host === "example.com" || host.endsWith(".example.com")) return false;
  return true;
}

/**
 * The customer-facing menu link.
 *
 * Two product modes are supported:
 *   • Ordering reactivated (`preferInternal`): every customer is sent to the
 *     in-marketplace menu/checkout page (`/restaurants/{slug}/menu`), which
 *     runs the preserved ordering pipeline. The external POS URL is ignored for
 *     navigation (still managed) — the marketplace takes the order.
 *   • Discovery-only (external): when the restaurant publishes a real remote
 *     URL, ORDER ONLINE deep-links to it; otherwise we fall back to the
 *     marketplace's stable internal menu page for the slug.
 */
export function resolveMenuLink(
  menuUrl: string,
  slug: string,
  opts: { preferInternal?: boolean } = {},
): string {
  if (opts.preferInternal) return `/restaurants/${slug}/menu`;
  if (isRemoteMenuUrl(menuUrl)) return menuUrl;
  return `/restaurants/${slug}/menu`;
}
