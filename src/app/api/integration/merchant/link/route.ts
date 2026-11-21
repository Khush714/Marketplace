import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { merchantAppLinks, merchantLinkCodes, restaurants } from "@/db/schema";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { hashMerchantCredential, integrationAuthError } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-to-server pairing: a human proves control of the Marketplace listing with a one-time code. */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const unauthorized = integrationAuthError(req);
  if (unauthorized) return unauthorized;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const record = body as Record<string, unknown>;
  const businessId = typeof record.businessId === "string" ? record.businessId.trim() : "";
  const code = typeof record.code === "string" ? record.code.trim() : "";
  if (!UUID.test(businessId) || !/^[A-Za-z0-9_-]{24,128}$/.test(code)) {
    return Response.json({ ok: false, error: "Enter a valid pairing code." }, { status: 400 });
  }

  const accessToken = randomBytes(32).toString("base64url");
  const now = new Date();
  try {
    const outcome = await db.transaction(async (tx) => {
      const [pairing] = await tx.select().from(merchantLinkCodes)
        .where(eq(merchantLinkCodes.codeHash, hashMerchantCredential(code))).limit(1).for("update");
      if (!pairing || pairing.consumedAt || pairing.expiresAt <= now) return { ok: false as const, code: "PAIRING_CODE_INVALID" };

      const [businessLink] = await tx.select().from(merchantAppLinks)
        .where(eq(merchantAppLinks.businessId, businessId)).limit(1);
      if (businessLink && businessLink.restaurantId !== pairing.restaurantId) {
        return { ok: false as const, code: "BUSINESS_ALREADY_LINKED" };
      }
      const [restaurantLink] = await tx.select().from(merchantAppLinks)
        .where(eq(merchantAppLinks.restaurantId, pairing.restaurantId)).limit(1);
      if (restaurantLink && restaurantLink.businessId !== businessId) {
        return { ok: false as const, code: "RESTAURANT_ALREADY_LINKED" };
      }
      const [consumed] = await tx.update(merchantLinkCodes).set({ consumedAt: now })
        .where(and(eq(merchantLinkCodes.id, pairing.id), isNull(merchantLinkCodes.consumedAt), gt(merchantLinkCodes.expiresAt, now)))
        .returning({ id: merchantLinkCodes.id });
      if (!consumed) return { ok: false as const, code: "PAIRING_CODE_INVALID" };

      const [restaurant] = await tx.select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug, marketplaceId: restaurants.marketplaceId })
        .from(restaurants).where(eq(restaurants.id, pairing.restaurantId)).limit(1);
      if (!restaurant) return { ok: false as const, code: "RESTAURANT_NOT_FOUND" };
      const tokenHash = hashMerchantCredential(accessToken);
      if (restaurantLink) {
        await tx.update(merchantAppLinks).set({ accessTokenHash: tokenHash, lastUsedAt: null })
          .where(eq(merchantAppLinks.id, restaurantLink.id));
      } else {
        await tx.insert(merchantAppLinks).values({ restaurantId: restaurant.id, businessId, accessTokenHash: tokenHash });
      }
      return { ok: true as const, restaurant };
    });

    if (!outcome.ok) {
      const status = outcome.code === "RESTAURANT_NOT_FOUND" ? 404 : 409;
      const message = outcome.code === "PAIRING_CODE_INVALID"
        ? "This pairing code has expired or was already used. Generate a new code in the Marketplace partner console."
        : outcome.code === "BUSINESS_ALREADY_LINKED"
          ? "This Merchant App business is already linked to another Marketplace listing."
          : outcome.code === "RESTAURANT_ALREADY_LINKED"
            ? "This Marketplace listing is linked to a different Merchant App business. Disconnect it first if you intend to replace it."
            : "Marketplace listing not found.";
      return Response.json({ ok: false, error: message, code: outcome.code }, { status, headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({
      ok: true,
      accessToken,
      restaurant: { id: outcome.restaurant.id, name: outcome.restaurant.name, slug: outcome.restaurant.slug, marketplaceId: outcome.restaurant.marketplaceId },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[merchant-link] pairing failed", error);
    return Response.json({ ok: false, error: "Could not connect this Merchant App business. Please try again." }, { status: 500 });
  }
}

/** A business-specific token may revoke only its own link. */
export async function DELETE(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const { authenticateMerchantApp, unauthenticatedMerchantApp } = await import("@/lib/merchant-app-auth");
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  await db.transaction(async (tx) => {
    await tx.delete(merchantAppLinks).where(and(eq(merchantAppLinks.restaurantId, auth.restaurantId), eq(merchantAppLinks.businessId, auth.businessId)));
    await tx.delete(merchantLinkCodes).where(eq(merchantLinkCodes.restaurantId, auth.restaurantId));
  });
  return Response.json({ ok: true, linked: false }, { headers: { "Cache-Control": "no-store" } });
}
