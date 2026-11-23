/**
 * Google Sign-In for customers — the policy, as pure functions.
 *
 * Split from `customer-google-auth.ts` for the same reason the other `*-core.ts`
 * modules exist: `server-only` throws by design outside the Next bundler, so the
 * decisions worth asserting — what a valid state blob looks like, which return
 * paths are internal, how a PKCE challenge is derived — live here where a plain
 * node test can reach them. No DB, no network, no environment access.
 *
 * The OAuth state travels in an HttpOnly cookie rather than the redirect URL so
 * the verifier cannot be read or rewritten by script on the page. It is still
 * decoded strictly on the way back in: a cookie is client-held bytes, and a
 * tampered one must fail closed instead of steering a redirect or widening an
 * identity check.
 */

import { createHash } from "node:crypto";

/** Google's OAuth 2.0 authorization endpoint. */
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
/** Google's OAuth 2.0 token endpoint (authorization-code + PKCE exchange). */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Google's ID-token introspection endpoint. */
export const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

/** Cookie carrying the short-lived OAuth state/verifier pair. */
export const CUSTOMER_GOOGLE_OAUTH_COOKIE = "crave_customer_google_oauth";
/** Ten minutes: long enough for a sign-in prompt, short enough to blunt replay. */
export const CUSTOMER_GOOGLE_OAUTH_TTL_SECONDS = 600;

/** How the callback reports its outcome to the initiating page. */
export type GoogleOAuthMode = "popup" | "redirect";

/** The state carried through the round trip in the HttpOnly OAuth cookie. */
export interface GoogleOAuthState {
  state: string;
  verifier: string;
  returnTo: string;
  /** Client-generated correlation token echoed back in the popup postMessage. */
  nonce: string;
  mode: GoogleOAuthMode;
}

/** Base64url shape, no padding: what `randomBytes(n).toString("base64url")` emits. */
export function isBase64UrlToken(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function isBoundedToken(value: unknown): value is string {
  if (!isBase64UrlToken(value)) return false;
  return typeof value === "string" && value.length >= 16 && value.length <= 256;
}

/**
 * Serialise the OAuth state into the cookie value.
 *
 * Base64url rather than raw JSON so the value drops into a `Set-Cookie` without
 * quoting or escaping — every character is cookie-safe, and `decodeURIComponent`
 * on the way in cannot change its meaning.
 */
export function encodeGoogleOAuthState(value: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Parse and validate a state cookie. `null` for anything malformed or tampered.
 *
 * Each field is re-derived rather than trusted: tokens must be bounded base64url
 * values (the exact shape this module generates), the mode must be one of the two
 * known values, and `returnTo` is passed through the same internal-path filter it
 * went through on the way out. A hostile cookie can therefore never turn a
 * redirect into an off-site navigation or smuggle a script payload into the
 * popup HTML, where the nonce is the only interpolated value.
 */
export function decodeGoogleOAuthState(raw: string | undefined | null): GoogleOAuthState | null {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || !isBase64UrlToken(raw)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  const { state, verifier, nonce, mode, returnTo } = candidate;
  if (!isBoundedToken(state) || !isBoundedToken(verifier)) return null;
  if (!isBoundedToken(nonce)) return null;
  if (mode !== "popup" && mode !== "redirect") return null;

  return {
    state,
    verifier,
    returnTo: safeGoogleReturnTo(returnTo),
    nonce,
    mode,
  };
}

/**
 * Restrict a post-sign-in destination to an internal path.
 *
 * Rejecting `//` and backslashes is the load-bearing part: browsers treat both
 * as scheme-relative in a `Location` header, so `/\\evil.example` would otherwise
 * be an open redirect even though it starts with a slash. Control characters are
 * refused because they can split a header or terminate a script literal, and the
 * length cap keeps a crafted cookie bounded.
 */
export function safeGoogleReturnTo(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.length > 300) return fallback;
  if (value.includes("\\")) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(value)) return fallback;
  return value;
}

/** Normalise a verified Google email, or `null` when it is not usable. */
export function normalizeGoogleEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Normalise a Google display name; whitespace collapsed and bounded. */
export function normalizeGoogleName(raw: unknown, fallback = ""): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return name ? name.slice(0, 80) : fallback;
}

/** Google's `sub` is opaque but stable: keep only its documented alphabet. */
export function normalizeGoogleSub(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const sub = raw.trim();
  return /^[A-Za-z0-9_-]{6,255}$/.test(sub) ? sub : null;
}

/** S256 PKCE challenge: base64url(SHA-256(verifier)), as Google requires. */
export function googleCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
