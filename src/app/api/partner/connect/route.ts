import { NextRequest } from "next/server";
import { listConnections, redeemConnectionCode, type RedeemConnectionInput } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Enumerating every POS connection is ops-only.
 *
 * `POST` is deliberately NOT token-gated: redeeming a code is the restaurant's
 * own onboarding handshake, and the single-use code *is* the capability. The
 * abuse path that mattered — minting codes at will — is closed on
 * `POST /api/partner/codes`, so an attacker cannot manufacture a code to redeem.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ connections: await listConnections() });
}

export async function POST(req: NextRequest) {
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
