import { getCustomerCart, saveCustomerCart } from "@/db/customer-cart";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { resolveAccountSession } from "@/lib/security/customer-account-session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Account cart mirror. The browser cart stays the source for guests; a signed-in
 * account gets a bounded server copy so a lost device does not lose the cart.
 * Identity is resolved from the HttpOnly account session, never from the body.
 */
export async function GET(req: Request) {
  const blocked = guardRead(req, "cartSync");
  if (blocked) return blocked;
  const session = await resolveAccountSession(req);
  if (!session) return Response.json({ ok: true, state: null }, { headers: NO_STORE });
  const state = await getCustomerCart(session.account.id);
  return Response.json({ ok: true, state }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  const blocked = await guardWrite(req, "cartSync");
  if (blocked) return blocked;
  const session = await resolveAccountSession(req);
  if (!session) {
    return Response.json({ ok: false, error: "Sign in to sync your cart" }, { status: 401 });
  }
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { state?: unknown };
  const state = await saveCustomerCart(session.account.id, body?.state);
  return Response.json({ ok: true, state }, { headers: NO_STORE });
}
