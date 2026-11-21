import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_PREFIX = "v1.";
const IV_LENGTH = 12;
/** POS/Marketplace shared timestamp skew cap for menu webhooks (5 minutes). */
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Envelope keys are per-environment, but the sealed secrets live in a table
 * that every environment shares. So a key mismatch is not a local bug — it
 * permanently breaks POS delivery for the shared database, and it does so
 * silently: the seal succeeds, the open fails, and the only trace is a
 * `sealed webhook secret could not be opened` delivery error hours later.
 *
 * That is exactly what happened in production: INTEGRATION_ENVELOPE_KEY was
 * never set there, so the fallback below silently bound production to
 * RAZORPAY_WEBHOOK_SECRET while every other environment used the dedicated
 * key. Sealing and opening diverged, and every order to the POS failed after
 * its retries.
 *
 * The fallback is kept for existing deployments, but it now announces itself,
 * and the resolved key is fingerprinted so a mismatch is diagnosable from logs
 * without ever printing the secret.
 */
let warnedFallback = false;

function envelopeKey(): Buffer {
  const raw = process.env.INTEGRATION_ENVELOPE_KEY || "";
  if (raw) return keyFrom(raw);

  const fallback = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!fallback) {
    throw new Error(
      "INTEGRATION_ENVELOPE_KEY is required to seal/open webhook secrets",
    );
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[webhook-crypto] INTEGRATION_ENVELOPE_KEY is unset; falling back to ` +
        `RAZORPAY_WEBHOOK_SECRET (fingerprint ${fingerprint(fallback)}). ` +
        `Every environment sharing this database must derive the same value, ` +
        `otherwise sealed webhook secrets cannot be opened.`,
    );
  }
  return keyFrom(fallback);
}

/** Stable, non-reversible id for a key so logs can prove which one is in use. */
export function envelopeKeyFingerprint(): string {
  return fingerprint(resolveRawKey());
}

function resolveRawKey(): string {
  const raw = process.env.INTEGRATION_ENVELOPE_KEY || process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENVELOPE_KEY is required to seal/open webhook secrets",
    );
  }
  return raw;
}

function keyFrom(raw: string): Buffer {
  return createHash("sha256")
    .update(`marketplace-menu-webhook-envelope:v1:${raw}`)
    .digest();
}

function fingerprint(raw: string): string {
  return createHash("sha256")
    .update(`marketplace-envelope-fingerprint:v1:${raw}`)
    .digest("hex")
    .slice(0, 12);
}

/** Seal the POS webhook secret at rest; the raw secret is never persisted. */
export function sealWebhookSecret(secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", envelopeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

/** Open a sealed webhook secret. Throws on tampering or malformed envelopes. */
export function openWebhookSecret(envelope: string): string {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new Error("Invalid webhook secret envelope");
  }
  const [ivB64, tagB64, encryptedB64] = envelope
    .slice(ENVELOPE_PREFIX.length)
    .split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Malformed webhook secret envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", envelopeKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    // GCM cannot tell "wrong key" from "tampered ciphertext" — both fail the
    // auth tag. In practice a wrong key is the overwhelmingly likely cause, so
    // say so and name the key in use, which makes a cross-environment mismatch
    // a two-minute diagnosis instead of a mystery.
    throw new Error(
      `Could not open sealed webhook secret using envelope key ` +
        `${envelopeKeyFingerprint()}. The secret was sealed under a different ` +
        `INTEGRATION_ENVELOPE_KEY, or the ciphertext was tampered with. Every ` +
        `environment sharing this database must use the same key; re-claiming ` +
        `the integration reseals the secret with the current one. ` +
        `Underlying: ${(e as Error).message}`,
    );
  }
}

/**
 * The exact HMAC-SHA256 frame the POS signs:
 * `HMAC(secret, "<integrationId>\n<timestamp>\n<rawBody>")` (hex).
 * Integration id is the POS's external restaurant id (rst_…), which IS the
 * Marketplace restaurant's marketplaceId.
 */
export function computeWebhookSignature(
  secret: string,
  integrationId: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${integrationId}\n${timestamp}\n${rawBody}`)
    .digest("hex");
}

/** Constant-time comparison of two hex signatures. */
export function webhookSignaturesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** True when the header timestamp is within the shared 5-minute skew. */
export function menuWebhookTimestampValid(timestamp: string, now: number = Date.now()): boolean {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  return Math.abs(now - ts) <= MAX_SKEW_MS;
}