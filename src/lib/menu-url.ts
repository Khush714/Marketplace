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
