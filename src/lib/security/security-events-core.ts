/**
 * Phase 12 — structured security events: vocabulary + the never-log guarantee.
 *
 * Every security-relevant decision the app makes emits exactly one JSON line
 * through this vocabulary, so "what happened, to whom, and why" is answerable
 * by grepping one stream instead of reconstructing it from scattered
 * console statements. The set below is the Phase 12 list, fixed, and each
 * name is wired at one family of call sites — `tests/security-events.test.ts`
 * pins both the vocabulary and the wiring, so an event that is dropped from a
 * route fails the suite rather than silently vanishing from production logs.
 *
 * The second job of this module is the part that must not drift: the
 * never-log list. Six classes of secret must never reach the log stream —
 * database password, owner key, integration bearer token, admin session
 * token, payment secret, full customer address — plus the natural
 * neighbours that carry the same blast radius (passkeys, tracking/session
 * tokens, cookies, raw connection strings). Redaction runs INSIDE
 * `buildSecurityEvent`, not at each call site: every emission passes through
 * it, so a future caller cannot forget the rule, and `formatSecurityEvent`
 * only ever sees an already-redacted object.
 *
 * Keys are matched case-insensitively and punctuation-insensitively, so
 * "ownerKey", "owner_key" and "OWNER_KEY" are one rule. Values are checked
 * against a smaller pattern set for the one shape that hides a secret inside
 * an innocently-named field: a `postgres://` URL embeds its password in the
 * connection string itself.
 *
 * Deliberately dependency-free and `server-only`-free: this module is
 * imported by the edge proxy (through rate-limit.ts) and by `node --test`.
 */

/** The fixed Phase 12 event vocabulary. One JSON line per emission. */
export const SECURITY_EVENTS = [
  /** Ops/admin credential check — requireOpsToken, success and failure. */
  "admin_login",
  /** An ops operator minted a single-use onboarding code. */
  "connection_code_created",
  /** A redemption attempt against a connection code, success or failure. */
  "connection_code_redeemed",
  /** A restaurant session was minted (login, signup, or post-redeem). */
  "restaurant_session_created",
  /** A session was revoked — logout, owner-key rotation, or passkey rotation. */
  "restaurant_session_revoked",
  /** Integration (POS) credential login, success or failure. */
  "integration_login",
  /** The restaurant rotated its POS passkey. */
  "passkey_rotated",
  /** Listing deletion attempted, succeeded, or was refused. */
  "restaurant_deleted",
  /** The payment webhook rejected or could not process a delivery. */
  "payment_webhook_failure",
  /** An order-tracking lookup that failed the token gate. */
  "order_tracking_suspicious",
  /** Any rate limiter in the app refused a request. */
  "rate_limit_violation",
] as const;

export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

/** Caller-supplied context. Redacted before it is ever formatted. */
export type SecurityEventFields = Record<string, unknown>;

export interface SecurityEvent {
  /** Always first, always one of SECURITY_EVENTS. */
  event: SecurityEventName;
  /** ISO-8601 emission time, set by buildSecurityEvent. */
  at: string;
  [field: string]: unknown;
}

/** Placeholder written in place of a value that must not be logged. */
export const REDACTED = "[redacted]";

/** Keys reserved by the envelope; ignored if a caller tries to pass them. */
const RESERVED_KEYS = new Set(["event", "at"]);

/**
 * Key patterns that mark a field as never-log.
 *
 * Each entry maps onto the Phase 12 never-log list (or a credential of the
 * same class); the list is deliberately wider than the six named items
 * because a leaked sibling — a CSRF token beside a session token — costs the
 * same breach.
 */
export const FORBIDDEN_KEY_PATTERNS: readonly RegExp[] = [
  // Database password: "password", "dbPassword", "DATABASE_PASSWORD"...
  /pass(word|phrase)/,
  // The integration passkey itself, and anything hashed from it.
  /passkey/,
  // Payment secret: RAZORPAY_WEBHOOK_SECRET, *_SECRET keys...
  /secret/,
  // Integration bearer token, admin session token, tracking token, CSRF
  // token, and their hashes: any token-shaped value is a bearer credential.
  /token/,
  // Authorization/cookie headers passed through as field names.
  /^authorization$/,
  /^cookie$/,
  // The owner key (raw or hash): "ownerKey", "owner_key", "OWNER-KEY".
  /owner.?key/,
  // Bare { key: ... } payloads — the shape the owner-key exchange uses.
  /^key$/,
  // Generic credential bags.
  /credential/,
  // Connection strings / database URLs: the password lives IN the value.
  /(database|db)[_-]?(url|password)/,
  /connection[_-]?string/,
  // The full customer address. Short forms ("addressLabel", the neighbourhood
  // name) are public and stay loggable; only the full text is forbidden.
  /address[_-]?(text|line|full)/,
  /^address$/,
];

/**
 * Value patterns for secrets smuggled under an innocent key.
 *
 * A field called `url` or `endpoint` can still carry the database password
 * inside a connection string; the key rules above cannot see that, the value
 * rules can.
 */
export const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  // postgres://user:password@host/db — DATABASE_URL in value form.
  /^postgres(ql)?:\/\//i,
];

function keyIsForbidden(rawKey: string): boolean {
  const key = rawKey.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function valueIsForbidden(value: string): boolean {
  return FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively replace forbidden values with {@link REDACTED}, keeping the
 * key so the log still shows the field existed.
 *
 * Depth is capped as a fail-closed guard: the event shapes here are flat, so
 * anything unexpectedly deep is treated as untrusted and redacted rather
 * than walked. Non-plain leaves (numbers, dates, strings already checked)
 * pass through untouched.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (isPlainObject(value)) return redactObject(value, depth);
  if (typeof value === "string" && valueIsForbidden(value)) return REDACTED;
  return value;
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (RESERVED_KEYS.has(key)) continue;
    out[key] = keyIsForbidden(key) ? REDACTED : redactValue(val, depth + 1);
  }
  return out;
}

/** Redact a caller's field map (recursively). Exported for direct testing. */
export function redactEventFields(fields: SecurityEventFields): SecurityEventFields {
  return redactObject(fields, 0);
}

/**
 * Build the envelope: vocabulary name + timestamp + redacted context.
 *
 * Redaction happens here, once, so every emission path — routes, the db
 * layer, the edge proxy — shares the same guarantee.
 */
export function buildSecurityEvent(
  name: SecurityEventName,
  fields: SecurityEventFields = {},
): SecurityEvent {
  // Envelope first so every line in the stream starts with `{"event":...}`
  // and grep hits column zero; `redactEventFields` has already stripped any
  // attempt to pass `event`/`at` as context, so the spread cannot override.
  return {
    event: name,
    at: new Date().toISOString(),
    ...redactEventFields(fields),
  };
}

/** One compact JSON line, ready for the log stream. */
export function formatSecurityEvent(event: SecurityEvent): string {
  return JSON.stringify(event);
}
