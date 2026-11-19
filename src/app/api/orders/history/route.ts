import { listOrders } from "@/db/queries";
import { guardRead } from "@/lib/abuse";
import { sessionHistoryCodes } from "@/lib/customer-session-core";
import { resolveCustomerSession } from "@/lib/customer-session";
import { toPublicOrder, type PublicOrder } from "@/lib/order-public";

export const dynamic = "force-dynamic";

/**
 * Session-backed order history. The browser places one cookie-authenticated
 * read and gets back the same customer-safe DTOs the token-based lookup returns,
 * so history survives localStorage being cleared — the credential is the
 * HttpOnly cookie naming a row of bound order codes, not a stack of tokens in
 * web storage.
 *
 * No session is not a 401: a first-time visitor has an empty history, and a
 * revoked or guessed cookie must look the same as one that was never minted.
 * The codes come only from the session row, so this cannot enumerate orders —
 * but the route is still budgeted (`orderHistory`) because a history page polls
 * it while an order is live.
 */
export async function GET(req: Request) {
  const throttled = guardRead(req, "orderHistory");
  if (throttled) return throttled;

  const session = await resolveCustomerSession(req);
  if (!session) return Response.json({ orders: [] });

  const orders: PublicOrder[] = (await listOrders(sessionHistoryCodes(session.orderCodes))).map(toPublicOrder);
  return Response.json({ orders });
}
