import { NextRequest } from "next/server";
import { getRestaurantByOwnerKey } from "@/db/queries";
import { PosBridgeError, verifyPosConnection } from "@/lib/pos-bridge";

export const dynamic = "force-dynamic";

/**
 * Detect what a POS connection code is bound to WITHOUT consuming it.
 *
 * This route needs the caller's owner key even though the attestation itself
 * doesn't: an unauthenticated `verify` is a free oracle. It answers 200 for a
 * live code and 401 for a dead one, which lets anyone enumerate POS-issued
 * codes and read back the tenant/branch/outlet each one is bound to. The sibling
 * `POST /api/partner/integrations` (claim) already required the owner key, so
 * requiring it here matches that contract and keeps the owner flow working while
 * closing the anonymous probe.
 */
export async function POST(req: NextRequest) {
  // The body is readable once, so parse it up front and read the owner key from
  // either the header (preferred, matches the sibling GET) or the payload.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ownerKey =
    String(req.headers.get("x-owner-key") ?? "").trim() || String(body?.ownerKey ?? "").trim();

  if (!ownerKey) {
    return Response.json({ ok: false, error: "ownerKey is required" }, { status: 400 });
  }

  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });

  const connectionCode = String(body?.connection_code ?? "").trim();
  if (!connectionCode) {
    return Response.json({ ok: false, error: "connection_code is required" }, { status: 400 });
  }

  try {
    const detected = await verifyPosConnection(connectionCode);
    return Response.json({ ok: true, detected });
  } catch (err) {
    if (err instanceof PosBridgeError) {
      const message =
        err.code === "ALREADY_REDEEMED"
          ? "This code has already been redeemed"
          : err.status === 401
            ? "Code is invalid or has expired"
            : err.status === 502 || err.status === 503
              ? "The POS is unreachable — try again"
              : err.message;
      return Response.json({ ok: false, error: message, code: err.code }, { status: err.status });
    }
    return Response.json({ ok: false, error: "Could not verify the code" }, { status: 500 });
  }
}
