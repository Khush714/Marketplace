import { guardWrite, readJsonBody } from "@/lib/abuse";
import { appendCustomerSessionCookie, ensureCustomerSession } from "@/lib/customer-session";
import { CUSTOMER_SESSION_MAX_CODES, normalizeOrderCode } from "@/lib/customer-session-core";
import { bindOrderCodesToSession } from "@/db/queries";
import { verifyOrderToken } from "@/lib/order-token";

export const dynamic = "force-dynamic";

/**
 * Bind order codes to this browser's anonymous session — POST /api/orders/attach.
 *
 * This is the migration path out of localStorage. The browser used to keep
 * every placed order as `{ code, token, trackingToken }` inside the shared
 * profile blob; the tokens now travel here once, are verified, and are bound
 * to a server-side session row. From then on the client proves ownership with
 * an HttpOnly cookie instead of replaying tokens from web storage, and the
 * profile store holds identity, addresses and favourites — no credentials.
 *
 * Why POST (write-guarded) and not a background GET: it changes durable state
 * (a new row, or a widened `order_codes` set), and `guardWrite`'s origin check
 * is the CSRF layer a cookie-authenticated route needs — a cross-site page
 * cannot drive a browser into attaching anything, because `Sec-Fetch-Site:
 * cross-site` is refused before the body is even read. The double-submit
 * CSRF token the partner console uses is not needed on top of that, which is
 * exactly why it is not built here.
 *
 * Each pair is HMAC-verified before it is bound — the session grants only
 * codes whose token the client actually holds, so a session can never widen
 * access beyond what the browser already had. Verified-but-already-owned
 * codes are idempotent: `bound` echoes everything the session may now read,
 * so the client can drop those claims from its retry queue in one pass.
 *
 * The cookie is set only when this response changed (or created) the row's
 * window — see `ensureCustomerSession`. An attach against a fresh-enough
 * session deliberately leaves the response cookie-less so the browser's
 * `Max-Age` and the row's `expires_at` cannot drift apart.
 */
export async function POST(req: Request) {
  const blocked = await guardWrite(req, "customerSession");
  if (blocked) return blocked;

  let pairs: { code?: unknown; token?: unknown }[];
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { orders?: { code?: unknown; token?: unknown }[] } | null;
    pairs = Array.isArray(body?.orders) ? body.orders : [];
  }

  const verified: string[] = [];
  const seen = new Set<string>();
  for (const pair of pairs.slice(0, CUSTOMER_SESSION_MAX_CODES)) {
    const code = normalizeOrderCode(pair?.code);
    const token = String(pair?.token ?? "").trim();
    if (!code || seen.has(code)) continue;
    if (!verifyOrderToken(code, token)) continue;
    seen.add(code);
    verified.push(code);
  }
  if (!verified.length) {
    // Nothing valid to grant, so nothing to grant it *with*: no session row
    // is minted and no cookie is set, keeping a junk flush from littering
    // customer_sessions with empty rows.
    return Response.json({ ok: true, bound: [] });
  }

  const ensured = await ensureCustomerSession(req);
  await bindOrderCodesToSession(ensured.session.id, verified);
  const res = Response.json({ ok: true, bound: verified });
  if (ensured.expiresAt) appendCustomerSessionCookie(req, res, ensured.token, ensured.expiresAt);
  return res;
}
