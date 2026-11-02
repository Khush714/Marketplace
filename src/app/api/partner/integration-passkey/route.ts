import { NextRequest } from "next/server";
import { issueIntegrationOneTimePasskey, recordIntegrationAudit } from "@/db/queries";
import { guardBudget } from "@/lib/abuse";
import { internalError } from "@/lib/security/errors";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "oneTimePasskeyMint");
  if (blocked) return blocked;

  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const issued = await issueIntegrationOneTimePasskey(auth.session.restaurantId);
  if (!issued) return internalError("Could not generate a POS passkey");

  await recordIntegrationAudit(
    auth.session.restaurantId,
    "one_time_passkey.generated",
    { actor: "partner" },
    { expiresAt: issued.expiresAtIso },
  );

  return Response.json({
    ok: true,
    passkey: issued.passkey,
    expiresAt: issued.expiresAtIso,
  });
}
