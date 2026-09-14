import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  SIGNATURE_FRESHNESS_MS,
  signaturePayload,
  API_KEY_HEADER,
} from "./integration-contract";
import { restaurantForPosKey } from "./pos";

/**
 * PHASE 12 — server-side API key for Marketplace → RestaurantAI auth.
 *
 * The API key is a per-restaurant credential the marketplace presents when
 * calling RestaurantAI's endpoint_url. The raw key is shown exactly once to
 * the admin; a SHA-256 hash is stored in `api_key_hash` (for RestaurantAI to
 * verify) and the raw is stored in `api_key_raw` so the outbound dispatcher
 * can include it in request headers — like webhook_secret, it never leaves
 * the server. `api_key_prefix` renders a human-readable hint in the UI.
 */

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `int_${randomBytes(20).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Rotate the integration API key for a restaurant. Returns the raw key ONCE
 * (never logged); the hash + raw + prefix are persisted server-side only.
 */
export async function rotateApiKey(restaurantId: number): Promise<string> {
  const { key, hash, prefix } = generateApiKey();
  await db
    .update(restaurantIntegrations)
    .set({
      apiKeyHash: hash,
      apiKeyRaw: key,
      apiKeyPrefix: prefix,
      updatedAt: new Date(),
    })
    .where(eq(restaurantIntegrations.restaurantId, restaurantId));
  return key;
}

/**
 * Check whether an API key has been generated for this restaurant.
 */
export async function hasApiKey(restaurantId: number): Promise<boolean> {
  const [row] = await db
    .select({ apiKeyRaw: restaurantIntegrations.apiKeyRaw })
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .limit(1);
  return Boolean(row?.apiKeyRaw);
}

/**
 * Revoke the API key (clears the hash, raw, prefix). The key can no longer be
 * used; a new rotation is required to re-establish outbound auth.
 */
export async function revokeApiKey(restaurantId: number): Promise<void> {
  await db
    .update(restaurantIntegrations)
    .set({
      apiKeyHash: "",
      apiKeyRaw: "",
      apiKeyPrefix: "",
      updatedAt: new Date(),
    })
    .where(eq(restaurantIntegrations.restaurantId, restaurantId));
}

/**
 * PHASE 33 — generate a webhook signing secret for a restaurant integration
 * record. 48 hex characters (24 random bytes).
 *
 * Unlike API keys — which are stored only as a SHA-256 hash — a webhook secret
 * is stored raw in `restaurant_integrations.webhook_secret` because the
 * marketplace must re-derive auth hashes and verify POS signatures on inbound
 * webhooks, and hand the exact secret to the POS once at connection time.
 */
export function webhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Safely parse the `config` JSON column of an integration record.
 * Never throws — malformed config degrades to an empty object so downstream
 * code (connection codes, capabilities) can read defensively.
 */
export function parseConfig(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Sign an integration request body exactly as RestaurantAI must: an HMAC-SHA256
 * hex digest of `<epochMs>\n<rawBody>` keyed with the webhook secret. The
 * timestamp scopes the signature so a captured request cannot be replayed later.
 */
export function signWebhookPayload(
  secret: string,
  epochMs: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(signaturePayload(epochMs, rawBody))
    .digest("hex");
}

/**
 * Constant-time verification of an inbound/outbound signature header value.
 */
export function verifyWebhookSignature(
  secret: string,
  epochMs: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!secret || !signature) return false;
  const expected = signWebhookPayload(secret, epochMs, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Authenticate an inbound integration REST call with the POS key credential,
 * passed as `?key=` or `x-pos-key` header (same key the POS queue uses).
 * Returns the owning restaurantId, or null when unauthenticated.
 */
export async function authenticateIntegrationKey(
  request: Request,
): Promise<number | null> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? request.headers.get("x-pos-key") ?? "";
  return restaurantForPosKey(key);
}

/**
 * Authenticate a signed inbound webhook. Reads and verifies the raw request
 * body (timestamp freshness + HMAC against the stored webhook secret) and
 * returns the signing restaurant + integration and the raw body — which the
 * caller re-parses (it was consumed by the signature check).
 */
export async function verifyInboundWebhook(
  request: Request,
  rawBody: string,
): Promise<{ restaurantId: number; integrationId: number } | null> {
  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  if (!signature || !timestamp) return null;
  return restaurantForWebhookSecret(timestamp, signature, rawBody);
}

/**
 * Resolve the signing restaurant for a webhook delivery: validates the
 * timestamp freshness + HMAC signature against the stored webhook secret and
 * returns the matching integration + restaurant id, or null.
 */
export async function restaurantForWebhookSecret(
  timestamps: string,
  signature: string,
  rawBody: string,
): Promise<{ restaurantId: number; integrationId: number } | null> {
  const epoch = Number(timestamps);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch) > SIGNATURE_FRESHNESS_MS) {
    return null;
  }

  const rows = await db
    .select({
      id: restaurantIntegrations.id,
      restaurantId: restaurantIntegrations.restaurantId,
      webhookSecret: restaurantIntegrations.webhookSecret,
    })
    .from(restaurantIntegrations);
  for (const row of rows) {
    if (!row.webhookSecret) continue;
    if (verifyWebhookSignature(row.webhookSecret, timestamps, rawBody, signature)) {
      return { restaurantId: row.restaurantId, integrationId: row.id };
    }
  }
  return null;
}