import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { merchantAppLinks } from "@/db/schema";

const BEARER_PREFIX = "Bearer ";

export function hashMerchantCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : "";
}

export function merchantPairingSecretConfigured(): boolean {
  return (process.env.MERCHANT_APP_INTEGRATION_SECRET ?? "").trim().length >= 32;
}

/** Used only for the one-time pairing endpoint; this secret must stay server-side. */
export function verifyMerchantPairingSecret(req: Request): boolean {
  const expected = (process.env.MERCHANT_APP_INTEGRATION_SECRET ?? "").trim();
  const supplied = bearer(req);
  if (expected.length < 32 || !supplied || supplied.length > 512) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every normal Merchant App API request uses a business-specific, revocable token. */
export async function authenticateMerchantApp(req: Request): Promise<{
  restaurantId: number;
  businessId: string;
} | null> {
  const token = bearer(req);
  if (token.length < 32 || token.length > 512) return null;
  const tokenHash = hashMerchantCredential(token);
  const [link] = await db
    .select({ id: merchantAppLinks.id, restaurantId: merchantAppLinks.restaurantId, businessId: merchantAppLinks.businessId })
    .from(merchantAppLinks)
    .where(eq(merchantAppLinks.accessTokenHash, tokenHash))
    .limit(1);
  if (!link) return null;
  // Best-effort usage telemetry; never make an order/menu request depend on it.
  void db.update(merchantAppLinks).set({ lastUsedAt: new Date() }).where(eq(merchantAppLinks.id, link.id)).catch(() => undefined);
  return { restaurantId: link.restaurantId, businessId: link.businessId };
}

export function integrationAuthError(req: Request): Response | null {
  if (!merchantPairingSecretConfigured()) {
    return Response.json({ ok: false, error: "Merchant integration is not configured." }, { status: 503 });
  }
  if (!verifyMerchantPairingSecret(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function unauthenticatedMerchantApp(): Response {
  return Response.json({ ok: false, error: "Marketplace link is missing or expired. Connect this business again." }, { status: 401 });
}
