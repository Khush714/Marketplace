/**
 * Authenticated customer account policy, as pure functions.
 *
 * Split from server wiring for the same reason as `restaurant-session-core.ts`
 * and `customer-session-core.ts`: the decisions worth asserting — phone
 * normalization, challenge/OTP handling, session/cookie shape, and liveness —
 * stay testable without `server-only` or a database.
 *
 * MVP assumptions encoded here (adjust if product decisions change):
 *   - identity is a verified phone number in E.164 form;
 *   - login/signup is OTP-based with a pluggable sender and a dev stub only
 *     (no external SMS wired, fail-closed outside allowed dev paths);
 *   - order linking/claiming is explicit/proven, never inferred from phone;
 *   - guest checkout and token/session ownership remain supported.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookieAttributes } from "@/lib/restaurant-session-core";

/** Cookie carrying the authenticated account session token (HttpOnly). */
export const CUSTOMER_ACCOUNT_SESSION_COOKIE = "crave_customer_account_session";

/**
 * Cookie carrying the paired CSRF token. Not HttpOnly: the browser must be able
 * to read it and echo it back as a header on state-changing requests, while the
 * session credential itself stays unreadable to script (same split as the
 * partner console).
 */
export const CUSTOMER_ACCOUNT_CSRF_COOKIE = "crave_customer_account_csrf";

/** Header carrying the CSRF token on mutating account requests. */
export const CUSTOMER_ACCOUNT_CSRF_HEADER = "x-csrf-token";

/** Account session lifetime. Bounded and revocable; renewed on activity if desired. */
export const CUSTOMER_ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Sliding renewal threshold: below this remaining, a read can renew the window. */
export const CUSTOMER_ACCOUNT_SESSION_RENEW_BELOW_MS = 7 * 24 * 60 * 60 * 1000;

/** OTP validity window. Short enough to limit replay, long enough for delivery. */
export const CUSTOMER_AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Maximum verification attempts per challenge. */
export const CUSTOMER_AUTH_MAX_ATTEMPTS = 5;

/** Digits in a generated OTP. */
export const CUSTOMER_AUTH_OTP_LENGTH = 6;

/** Max saved addresses per account (MVP guardrail). */
export const CUSTOMER_MAX_ADDRESSES = 20;

/** Max favorites per account (MVP guardrail). */
export const CUSTOMER_MAX_FAVORITES = 100;

export function makeAccountSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function makeAccountCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashValue(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function constantTimeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex);
  const b = Buffer.from(bHex);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SessionCookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function buildAccountSessionCookie(token: string, opts: SessionCookieOptions): string {
  return [`${CUSTOMER_ACCOUNT_SESSION_COOKIE}=${token}`, ...cookieAttributes({ ...opts, httpOnly: true })].join("; ");
}

export function buildAccountCsrfCookie(token: string, opts: SessionCookieOptions): string {
  return [`${CUSTOMER_ACCOUNT_CSRF_COOKIE}=${token}`, ...cookieAttributes({ ...opts, httpOnly: false })].join("; ");
}

export function buildClearedAccountSessionCookies(opts: { secure: boolean }): string[] {
  const base = { secure: opts.secure, maxAgeSeconds: 0 };
  return [
    [`${CUSTOMER_ACCOUNT_SESSION_COOKIE}=`, ...cookieAttributes({ ...base, httpOnly: true })].join("; "),
    [`${CUSTOMER_ACCOUNT_CSRF_COOKIE}=`, ...cookieAttributes({ ...base, httpOnly: false })].join("; "),
  ];
}

export interface AccountSessionRowLike {
  expiresAt: Date;
  revokedAt: Date | null;
}

export function accountSessionIsLive(row: AccountSessionRowLike | null | undefined, now: number = Date.now()): boolean {
  if (!row) return false;
  if (row.revokedAt) return false;
  return row.expiresAt.getTime() > now;
}

export function accountCsrfMatches(storedHash: string, submitted: unknown): boolean {
  const presented = String(submitted ?? "").trim();
  if (!presented) return false;
  return constantTimeHexEqual(storedHash, hashValue(presented));
}

/**
 * Normalize a phone number to E.164 for storage and lookup.
 *
 * Accepts common Indian formats (10 digits, 0-prefixed, +91/91-prefixed) and
 * already-E.164 numbers. Returns null for anything that cannot be normalized
 * confidently, so callers fail closed rather than creating ambiguous accounts.
 */
export function normalizePhoneE164(raw: unknown): string | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const compact = input.replace(/[\s\-()]/g, "");
  if (!compact) return null;

  // Reject obvious non-phone characters early (allow leading + and digits).
  if (!/^\+?\d+$/.test(compact)) return null;

  let digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;

  // India-focused normalization (primary market): 10-digit mobile -> +91...
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;

  // Generic E.164 passthrough: leading + with 8-15 digits total.
  if (compact.startsWith("+") && /^\d{8,15}$/.test(digits)) return `+${digits}`;

  // Conservative fallback: 11-15 digits without + treated as international number.
  if (/^\d{11,15}$/.test(digits)) return `+${digits}`;

  return null;
}

/** Format a phone for display/log-safe contexts (no secrets; still PII-lite). */
export function maskPhoneE164(phoneE164: string): string {
  const p = String(phoneE164 ?? "");
  if (p.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`;
}

/**
 * Generate a numeric OTP. Uses rejection-free mapping over random bytes to avoid
 * modulo bias for a 6-digit code space.
 */
export function generateOtpCode(length: number = CUSTOMER_AUTH_OTP_LENGTH): string {
  const len = Math.max(4, Math.min(8, Math.floor(length)));
  const max = 10 ** len;
  // 4 bytes gives 0..2^32-1; reject values that would bias the distribution.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  while (true) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n >= limit) continue;
    return String(n % max).padStart(len, "0");
  }
}

/**
 * Derive the stored OTP verifier.
 *
 * Uses HMAC-SHA256 keyed by a server secret when provided, so an offline read of
 * the challenges table cannot be brute-forced without the secret (6-digit codes
 * are otherwise trivial). Falls back to plain SHA-256 only when no secret is
 * available in non-production contexts; production callers must supply a secret
 * and fail closed if absent.
 */
export function otpVerifier(code: string, phoneE164: string, purpose: string, secret: string): string {
  const material = `otp:v1:${purpose}:${phoneE164}:${code}`;
  if (secret) return createHmac("sha256", secret).update(material).digest("hex");
  return hashValue(material);
}

export function otpMatches(
  storedHash: string,
  code: unknown,
  phoneE164: string,
  purpose: string,
  secret: string,
): boolean {
  const presented = String(code ?? "").trim();
  if (!/^\d{4,8}$/.test(presented)) return false;
  return constantTimeHexEqual(storedHash, otpVerifier(presented, phoneE164, purpose, secret));
}

export interface ChallengeRowLike {
  codeHash: string;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type ChallengeVerifyState =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "consumed" | "too_many_attempts" | "invalid" };

export function challengeState(row: ChallengeRowLike | null | undefined, now: number = Date.now()): Exclude<ChallengeVerifyState, { ok: true }> | null {
  if (!row) return { ok: false, reason: "missing" };
  if (row.consumedAt) return { ok: false, reason: "consumed" };
  if (row.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  if (row.attemptCount >= row.maxAttempts) return { ok: false, reason: "too_many_attempts" };
  return null;
}

export function newChallengeExpiry(now: number = Date.now()): Date {
  return new Date(now + CUSTOMER_AUTH_CHALLENGE_TTL_MS);
}

export function newAccountSessionExpiry(now: number = Date.now()): Date {
  return new Date(now + CUSTOMER_ACCOUNT_SESSION_TTL_MS);
}

export function accountSessionNeedsRenewal(expiresAt: Date, now: number = Date.now()): boolean {
  return expiresAt.getTime() - now < CUSTOMER_ACCOUNT_SESSION_RENEW_BELOW_MS;
}

export function normalizeAccountName(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 80);
}

export type CustomerAvatar = "" | "male" | "female";

export function normalizeCustomerAvatar(raw: unknown): CustomerAvatar {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "male" || v === "female") return v;
  return "";
}

export function normalizeAddressLabel(raw: unknown): "Home" | "Work" | "Other" {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "home") return "Home";
  if (v === "work") return "Work";
  return "Other";
}

export function normalizeAddressText(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}
