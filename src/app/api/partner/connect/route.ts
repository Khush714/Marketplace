import { NextRequest } from "next/server";
import { listConnections, redeemConnectionCode, type RedeemConnectionInput } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";
import { checkRateLimit, clientKey, rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Redemption budget per caller per window.
 *
 * A real restaurant redeems one code, once, then shows the owner key. A handful
 * of retries covers a mistyped name or a double-click. 10/10min is loose enough
 * for a genuine partner and tight enough that 24.3M codes cannot be walked at a
 * useful rate from one address.
 */
const REDEEM_LIMIT = 10;
const REDEEM_WINDOW_MS = 10 * 60 * 1000;

/**
 * Enumerating every POS connection is ops-only.
 *
 * `POST` is deliberately NOT token-gated: redeeming a code is the restaurant's
 * own onboarding handshake, and the single-use code *is* the capability. The
 * abuse path that mattered — minting codes at will — is closed on
 * `POST /api/partner/codes`, so an attacker cannot manufacture a code to redeem.
 *
 * What an open redemption endpoint does leave open is *guessing* one, which is
 * why POST is rate-limited per caller.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ connections: await listConnections() });
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(clientKey(req, "partner-connect"), REDEEM_LIMIT, REDEEM_WINDOW_MS);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

  let body: RedeemConnectionInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await redeemConnectionCode(body);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 201 });
}
