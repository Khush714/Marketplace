import { NextRequest } from "next/server";
import { verifyOwner } from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/**
 * Owner-key verification — the credential check behind the partner console's
 * "restore my key" flow.
 *
 * The key is 18 random bytes, so it cannot be guessed; what this route needs to
 * refuse is *submission* volume. It is the natural script target for testing a
 * harvested or leaked key, and its 404 confirms when a key is live, so an
 * unbounded caller can sweep a credential list against it for free. Budget is
 * deliberately tight — see ABUSE_BUDGETS.ownerVerify.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "ownerVerify");
  if (blocked) return blocked;

  let ownerKey: string;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { ownerKey?: unknown } | null;
    ownerKey = String(body?.ownerKey ?? "").trim();
  }
  const restaurant = await verifyOwner(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
  return Response.json({ ok: true, restaurant });
}