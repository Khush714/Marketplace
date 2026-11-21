import { getOrderByCode } from "@/db/queries";
import { toPublicOrder, type PublicOrder } from "@/lib/order-public";
import { verifyOrderToken } from "@/lib/order-token";
import { guardWrite, readJsonBody } from "@/lib/abuse";

export const dynamic = "force-dynamic";

const MAX_CODES = 30;

/**
 * Order history for the orders this browser placed. POST rather than GET
 * because each code carries its own signed token, and tokens must never ride
 * a URL (query strings leak through logs, referrers and browser history).
 *
 * Each entry is verified independently and unverified codes are simply absent
 * from the response — no signal about whether an unknown code exists.
 *
 * The per-code tokens are what make this safe, and they are also what make it
 * worth budgeting: one request verifies up to MAX_CODES signatures and runs a
 * query per survivor. It cannot enumerate orders, but it can be used to burn
 * CPU in bulk, so it carries a per-client budget and a body cap like any other
 * unauthenticated POST.
 */
export async function POST(req: Request) {
  const blocked = await guardWrite(req, "orderLookup");
  if (blocked) return blocked;

  let pairs: { code?: unknown; token?: unknown }[];
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { orders?: { code?: unknown; token?: unknown }[] } | null;
    pairs = Array.isArray(body?.orders) ? body.orders : [];
  }

  const verified: { code: string; token: string }[] = [];
  for (const pair of pairs.slice(0, MAX_CODES)) {
    const code = String(pair?.code ?? "").trim().toUpperCase();
    const token = String(pair?.token ?? "").trim();
    if (code && verifyOrderToken(code, token)) verified.push({ code, token });
  }
  if (!verified.length) return Response.json({ orders: [] });

  const loaded = await Promise.all(verified.map((v) => getOrderByCode(v.code)));
  const orders: PublicOrder[] = [];
  for (const order of loaded) {
    if (order) orders.push(toPublicOrder(order));
  }
  orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return Response.json({ orders });
}
