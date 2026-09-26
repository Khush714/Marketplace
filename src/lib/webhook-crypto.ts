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
 * AES-256-GCM envelope key derived (with domain separation) from a dedicated
 * secret. Falls back to the Razorpay webhook secret in dev environments that
 * predate the dedicated variable, so sealing/opening never breaks existing
 * deployments.
 */
function envelopeKey(): Buffer {
  const raw =
    process.env.INTEGRATION_ENVELOPE_KEY || process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENVELOPE_KEY (or a fallback secret) is required to seal webhook secrets",
    );
  }
  return createHash("sha256")
    .update(`marketplace-menu-webhook-envelope:v1:${raw}`)
    .digest();
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
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
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