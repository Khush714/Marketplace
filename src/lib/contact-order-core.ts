/**
 * Pure policy for the `?order=<code>` hand-off from a tracking page to /contact.
 *
 * The query value is untrusted: it is rendered in a callout and folded into a
 * `mailto:` URL, so it is filtered rather than escaped at the point of use.
 * Keeping that decision here makes it testable without a server component.
 */

/** Generous cap over the real `CRV-XXXXX` shape, for legacy and test codes. */
export const CONTACT_ORDER_MAX_CHARS = 40;

/**
 * The characters an order code can contain. Codes are minted as `CRV-XXXXX`
 * (see `makeOrderCode`), but older codes and test fixtures are shorter or use
 * different prefixes, so the shape is checked rather than the exact pattern.
 */
const ORDER_CODE_CHARS = /^[A-Z0-9-]+$/;

/**
 * Accept a single, bounded order code or nothing.
 *
 * Returning `null` for anything unexpected is deliberate: a duplicated key,
 * a string with URL junk, or an over-long value must not reach the mailto link
 * or the page. The caller renders the callout only when a code came back.
 */
export function contactOrderCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > CONTACT_ORDER_MAX_CHARS) return null;
  if (!ORDER_CODE_CHARS.test(code)) return null;
  return code;
}
