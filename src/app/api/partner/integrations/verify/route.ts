import { NextRequest } from "next/server";
import { readJsonBody } from "@/lib/abuse";
import {
  verifyPosConnection,
  classifyPosVerifyFailure,
  type PosConnectionIdentity,
} from "@/lib/pos-bridge";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

/**
 * Detect what a POS connection code is bound to WITHOUT consuming it.
 *
 * The attestation itself does not need the caller — but an unauthenticated `verify`
 * is a free oracle: it answers 200 for a live code and 401 for a dead one, which
 * lets anyone enumerate POS-issued codes and read back the tenant, branch and
 * outlet each one is bound to. So the route is scoped to the session instead,
 * matching its sibling `POST /api/partner/integrations` (claim) and closing the
 * anonymous probe.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;
  const connectionCode = String(body?.connection_code ?? "").trim();
  if (!connectionCode) {
    return Response.json({ ok: false, error: "connection_code is required" }, { status: 400 });
  }

  try {
    const detected = await verifyPosConnection(connectionCode);
    // `PosConnectionIdentity.webhook_secret` is documented as never echoed back
    // to clients. The claim route already answers with the stored record rather
    // than the attestation, so this is the one path that could leak it — the
    // field is dropped here rather than trusted to stay empty upstream.
    const safe: PosConnectionIdentity = { ...detected };
    delete safe.webhook_secret;
    return Response.json({ ok: true, detected: safe });
  } catch (err) {
    const outcome = classifyPosVerifyFailure(err);
    if (outcome.kind === "redeemed") {
      // 200, not 4xx: see classifyPosVerifyFailure. The claim step is where a
      // replay is actually accepted or refused, and it carries the bound
      // identity this endpoint deliberately does not expose.
      return Response.json(
        { ok: true, redeemed: true, requiresClaim: true, error: outcome.message },
        { status: 200 },
      );
    }
    return Response.json(
      { ok: false, error: outcome.message, code: outcome.code },
      { status: outcome.status },
    );
  }
}
