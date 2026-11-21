import { NextRequest } from "next/server";

import { guardWrite, readJsonBody } from "@/lib/abuse";
import { normalizeOrderCode } from "@/lib/customer-session-core";
import { verifyOrderToken } from "@/lib/order-token";
import { requireAccountSession } from "@/lib/security/customer-account-session";
import { linkUnlinkedOrdersToAccountByCodes } from "@/db/customer-accounts";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

/**
 * Explicit/proven order claiming for the signed-in account.
 *
 * Proven sources accepted:
 * - explicit {code, token} pairs whose signed order tokens verify
 *
 * Anonymous session auto-claim is intentionally disabled to prevent shared-browser
 * cross-customer leakage. No auto-link by phone. Linking is additive and only
 * affects unlinked orders.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  let requestedPairs: { code?: unknown; token?: unknown }[] = [];
  {
    const parsed = await readJsonBody(req);
    if (parsed.ok && parsed.body && typeof parsed.body === "object") {
      const body = parsed.body as { orders?: { code?: unknown; token?: unknown }[] };
      if (Array.isArray(body.orders)) requestedPairs = body.orders;
    }
  }

  const proven = new Set<string>();
  for (const pair of requestedPairs.slice(0, 30)) {
    const code = normalizeOrderCode(pair?.code);
    const token = String(pair?.token ?? "").trim();
    if (!code || !token) continue;
    if (verifyOrderToken(code, token)) proven.add(code);
  }

  if (!proven.size) {
    return Response.json({ ok: true, linked: 0 });
  }

  const linked = await linkUnlinkedOrdersToAccountByCodes(
    auth.session.account.id,
    Array.from(proven),
  ).catch(() => 0);

  if (linked > 0) {
    // PII-safe audit: count/identifier only (no order codes, tokens, phone).
    emitSecurityEvent("customer_orders_claimed", {
      outcome: "success",
      accountId: auth.session.account.id,
      linkedCount: linked,
    });
  }

  return Response.json({ ok: true, linked });
}
