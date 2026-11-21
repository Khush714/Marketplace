import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { consumeMerchantAuthorizationCode, createRestaurantSession, getRestaurantManageById } from "@/db/queries";
import { readJsonBody, guardWrite } from "@/lib/abuse";
import { cookieShouldBeSecure, setSessionCookies } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantOAuthExchange");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { code?: unknown; verifier?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.verifier === "string" ? body.verifier : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) {
    return Response.json({ ok: false, error: "Authorization expired or invalid. Start again from Merchant." }, { status: 400 });
  }

  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const restaurantId = await consumeMerchantAuthorizationCode(code, codeChallenge);
  if (!restaurantId) {
    return Response.json({ ok: false, error: "Authorization expired or already used. Start again from Merchant." }, { status: 400 });
  }
  const restaurant = await getRestaurantManageById(restaurantId);
  if (!restaurant) return Response.json({ ok: false, error: "Restaurant not found." }, { status: 404 });

  const session = await createRestaurantSession(restaurant.id);
  const response = Response.json({
    ok: true,
    restaurant,
    expiresAt: session.expiresAt.toISOString(),
  }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  setSessionCookies(response, session, cookieShouldBeSecure(req));
  return response;
}
