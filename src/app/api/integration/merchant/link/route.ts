import { NextRequest } from "next/server";
import {
  pairMerchantWithOneTimePasskey,
  revokeMerchantIntegrationLink,
} from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import {
  isMerchantBusinessId,
  isMerchantPairingPasskey,
  merchantPairingSecretMatches,
} from "@/lib/merchant-integration-core";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerToken(req: NextRequest): string {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1] ?? "";
}

function unavailable(): Response {
  return Response.json(
    { ok: false, error: "Marketplace pairing is not configured." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/** POST pairs a Merchant business using a partner-issued, expiring passkey. */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantPairing");
  if (blocked) return blocked;

  const sharedSecret = (process.env.MERCHANT_APP_INTEGRATION_SECRET ?? "").trim();
  if (sharedSecret.length < 32) return unavailable();
  if (!merchantPairingSecretMatches(bearerToken(req), sharedSecret)) {
    emitSecurityEvent("merchant_pairing", { outcome: "failure", reason: "invalid_service_auth" });
    return Response.json(
      { ok: false, error: "Marketplace pairing authentication failed." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const body =
    parsed.body !== null && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? (parsed.body as Record<string, unknown>)
      : null;
  const businessId = body?.businessId;
  const code = body?.code;
  if (!isMerchantBusinessId(businessId) || !isMerchantPairingPasskey(code)) {
    return Response.json(
      { ok: false, error: "Enter a valid Merchant business ID and Marketplace passkey." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await pairMerchantWithOneTimePasskey(businessId, code);
  if (result.kind === "invalid_passkey") {
    emitSecurityEvent("merchant_pairing", { outcome: "failure", reason: "invalid_or_expired_passkey" });
    return Response.json(
      { ok: false, error: "This passkey is invalid or expired. Generate a new one in Marketplace." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (result.kind === "already_linked") {
    return Response.json(
      { ok: false, error: "This Marketplace listing or Merchant business is already linked." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  emitSecurityEvent("merchant_pairing", {
    outcome: "success",
    restaurantId: result.restaurant.id,
  });
  return Response.json(
    { ok: true, accessToken: result.accessToken, restaurant: result.restaurant },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

/** DELETE revokes the Merchant-specific bearer token; repeat calls are safe. */
export async function DELETE(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantPairing");
  if (blocked) return blocked;

  const token = bearerToken(req);
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
    return Response.json(
      { ok: false, error: "Invalid Merchant integration token." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const restaurantId = await revokeMerchantIntegrationLink(token);
  if (restaurantId !== null) {
    emitSecurityEvent("merchant_pairing", { outcome: "revoked", restaurantId });
  }
  return Response.json(
    { ok: true, revoked: restaurantId !== null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
