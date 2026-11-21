import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { merchantAppLinks, merchantLinkCodes } from "@/db/schema";
import { hashMerchantCredential } from "@/lib/merchant-app-auth";
import { guardRead, guardWrite } from "@/lib/abuse";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";
const CODE_TTL_MS = 10 * 60_000;

/** Current connection state; never return a bearer token or a token hash. */
export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "orderLookup");
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;
  const [link] = await db.select({ createdAt: merchantAppLinks.createdAt, lastUsedAt: merchantAppLinks.lastUsedAt })
    .from(merchantAppLinks).where(eq(merchantAppLinks.restaurantId, auth.session.restaurantId)).limit(1);
  return Response.json({ ok: true, linked: Boolean(link), connectedAt: link?.createdAt.toISOString() ?? null, lastUsedAt: link?.lastUsedAt?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store" } });
}

/** Mint a one-time 10-minute code from the authenticated restaurant's own session. */
export async function POST(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const code = randomBytes(24).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(merchantLinkCodes).where(and(eq(merchantLinkCodes.restaurantId, auth.session.restaurantId), isNull(merchantLinkCodes.consumedAt)));
    await tx.insert(merchantLinkCodes).values({ restaurantId: auth.session.restaurantId, codeHash: hashMerchantCredential(code), expiresAt });
  });
  return Response.json({ ok: true, code, expiresAt: expiresAt.toISOString(), ttlSeconds: CODE_TTL_MS / 1000 }, { headers: { "Cache-Control": "no-store" } });
}

/** Disconnect the mapped Merchant App and revoke its per-business API token. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;
  await db.transaction(async (tx) => {
    await tx.delete(merchantAppLinks).where(eq(merchantAppLinks.restaurantId, auth.session.restaurantId));
    await tx.delete(merchantLinkCodes).where(eq(merchantLinkCodes.restaurantId, auth.session.restaurantId));
  });
  return Response.json({ ok: true, linked: false });
}
