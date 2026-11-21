import { NextRequest } from "next/server";
import { getRestaurantManageById, createMerchantAuthorizationCode } from "@/db/queries";
import { readJsonBody } from "@/lib/abuse";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

function merchantCallbackUrl(): string | null {
  const raw = process.env.MERCHANT_LINK_CALLBACK_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/merchant/marketplace/callback"
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePartnerSession(request, { mutating: true });
  if (!auth.ok) return auth.response;

  const callback = merchantCallbackUrl();
  if (!callback) {
    return Response.json({ ok: false, error: "Merchant linking is not configured." }, { status: 503 });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { state?: unknown; codeChallenge?: unknown } | null;
  const state = body?.state;
  const codeChallenge = body?.codeChallenge;
  if (
    typeof state !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    typeof codeChallenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
  ) {
    return Response.json({ ok: false, error: "Invalid authorization request." }, { status: 400 });
  }

  const restaurant = await getRestaurantManageById(auth.session.restaurantId);
  if (!restaurant) return Response.json({ ok: false, error: "Restaurant not found." }, { status: 404 });

  const code = await createMerchantAuthorizationCode(restaurant.id, codeChallenge);
  const redirect = new URL(callback);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", state);
  return Response.json(
    { ok: true, redirectUrl: redirect.toString() },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}
