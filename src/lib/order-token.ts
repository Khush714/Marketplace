import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-order access token.
 *
 * The Marketplace has no customer accounts: the only identifier a browser ever
 * holds is the public order code. A code alone must therefore NOT be able to
 * read, poll, or cancel an order — anyone holding `CRV-XXXXX` could otherwise
 * pull the address, name, items and totals of somebody else's order.
 *
 * Every order is minted with an HMAC token bound to its code. It travels in a
 * header (never a query string, which leaks through logs and referrers) and is
 * kept beside the code in the browser's own profile store. Losing the token
 * loses access to the order, which is the intended trade: the alternative is
 * an unauthenticated PII read endpoint.
 */

/** `ORDER_TOKEN_SECRET` is preferred; the envelope key is the documented fallback. */
function configuredSecret(): string {
  return (process.env.ORDER_TOKEN_SECRET ?? process.env.INTEGRATION_ENVELOPE_KEY ?? "").trim();
}

// Dev only: a per-process secret so a fresh `npm run dev` still mints working
// tokens without setup. Tokens do not survive a restart, which is fine locally.
let devSecret: string | null = null;

function secret(): string | null {
  const configured = configuredSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

/** False in production without `ORDER_TOKEN_SECRET` — order access is closed. */
export function orderTokensAvailable(): boolean {
  return secret() !== null;
}

function payloadFor(code: string): string {
  return `order:v1:${code.trim().toUpperCase()}`;
}

export function signOrderToken(code: string): string {
  const key = secret();
  if (!key) return "";
  return createHmac("sha256", key).update(payloadFor(code)).digest("base64url");
}

export function verifyOrderToken(code: string, token: string | null | undefined): boolean {
  const key = secret();
  if (!key) return false;
  const provided = (token ?? "").trim();
  if (!provided) return false;
  const expected = Buffer.from(signOrderToken(code));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Read the token from the request headers (`x-order-token`, or the list form). */
export function readOrderToken(headers: Headers): string {
  return (headers.get("x-order-token") ?? headers.get("x-order-tokens") ?? "").trim();
}
