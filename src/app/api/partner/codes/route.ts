import { NextRequest } from "next/server";
import { listConnectionCodes, mintConnectionCode } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Partner onboarding codes — the ops-only half of the partner surface.
 *
 * Both methods require the ops token. Minting in particular has to be gated:
 * a connection code is the capability that `POST /api/partner/connect` redeems
 * to create a listing, so an open mint endpoint lets anyone enrol a restaurant
 * and claim a POS tenant without an operator's involvement. See
 * src/lib/ops-auth.ts for the fail-open-in-dev / fail-closed-in-prod rule.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ codes: await listConnectionCodes() });
}

export async function POST(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  let days = 0;
  try {
    const body = await req.json();
    const raw = Math.floor(Number(body?.days));
    days = Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    // Bodies are optional — callers may mint without configuring expiry.
  }
  const code = await mintConnectionCode(days);
  return Response.json({ code }, { status: 201 });
}
