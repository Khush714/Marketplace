import { NextRequest } from "next/server";
import { listConnectionCodes, mintConnectionCode } from "@/db/queries";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { requireOpsToken } from "@/lib/ops-auth";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

/**
 * Partner onboarding codes — the ops-only half of the partner surface.
 *
 * Both methods require the ops token. Minting in particular has to be gated:
 * a connection code is the capability that `POST /api/partner/connect` redeems
 * to create a listing, so an open mint endpoint lets anyone enrol a restaurant
 * and claim a POS tenant without an operator's involvement. See
 * src/lib/ops-auth.ts for the fail-open-in-dev / fail-closed-in-prod rule.
 *
 * Both methods are also budgeted — `opsCodeList` on GET, `opsCodeMint` on
 * POST, see ABUSE_BUDGETS — and in both the budget is charged BEFORE
 * `requireOpsToken`, so a wrong token counts against it instead of costing
 * nothing. The limiter is part of the credential defence, and it is what
 * bounds the development surface, where the token is optional and these
 * routes answer for anyone who calls them.
 */
export async function GET(req: NextRequest) {
  const throttled = guardRead(req, "opsCodeList");
  if (throttled) return throttled;

  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ codes: await listConnectionCodes() });
}

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "opsCodeMint");
  if (blocked) return blocked;

  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  let days = 0;
  // Bodies are optional — callers may mint without configuring expiry, and a
  // missing or unparseable one mints with no expiry exactly as before. What
  // changes is that the read is capped at 16 KB (guardWrite has already
  // refused an absurd declared length), so an open mint endpoint in
  // development cannot be handed a payload of any size it likes.
  const parsed = await readJsonBody(req);
  if (parsed.ok) {
    const raw = Math.floor(Number((parsed.body as { days?: unknown } | null)?.days));
    days = Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  const code = await mintConnectionCode(days);
  // Phase 12: the code string is a spendable capability until it is redeemed
  // or withdrawn, so only its id and expiry cross into the log.
  emitSecurityEvent("connection_code_created", {
    codeId: code.id,
    daysValid: days,
    outcome: "success",
  });
  return Response.json({ code }, { status: 201 });
}
