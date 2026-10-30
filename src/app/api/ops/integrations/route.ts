import { NextRequest } from "next/server";
import {
  countOpenOrdersForRestaurant,
  getIntegrationRecord,
  getRestaurantManageById,
  recordIntegrationAudit,
  upsertIntegrationIdentity,
} from "@/db/queries";
import {
  validateCustomPosWebhookUrl,
} from "@/integrations/pos/custom-pos-core";
import { petpoojaConfigured } from "@/integrations/pos/petpooja";
import { DEFAULT_POS_PROVIDER } from "@/integrations/pos/readiness";
import { readJsonBody } from "@/lib/abuse";
import { requireOpsToken } from "@/lib/ops-auth";
import { apiError } from "@/lib/security/errors";
import { sealWebhookSecret } from "@/lib/webhook-crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/ops/integrations?restaurant_id=N
 * PUT  /api/ops/integrations   { restaurant_id, provider, pos_restaurant_id?, status?,
 *                                webhook_url?, signing_secret? }
 *
 * Ops wiring for the provider behind a listing's POS integration record.
 *
 * The Restaurant AI connect flow owns its own identity: the POS issues a
 * single-use code and the claim writes provider + ids + sealed secret together.
 * Petpooja has no equivalent handshake in the contract this repository codes
 * against — a restaurant is identified by its `restID`, which an operator has
 * to supply. Without this route a `provider = 'petpooja'` record could not be
 * created at all, so the adapter would be unreachable.
 *
 * `custom_webhook` also has no handshake: ops supplies the listing's HTTPS
 * endpoint and its signing secret. The secret is sealed at rest exactly like
 * the Restaurant AI webhook secret, and a re-submitted secret rotates the old
 * one. Updating a URL while orders are in flight is refused for the same reason
 * a provider switch is: the journal may already have POSTed frames to the old
 * endpoint.
 *
 * Why ops-gated rather than partner-facing: the provider decides where every
 * money-bearing order for that listing is sent. Letting a session self-declare
 * an arbitrary `restID` or endpoint would let one restaurateur route another
 * kitchen's orders. This is the same trust level as the connection-code claim,
 * and the same guard (`x-ops-token`) as the rest of the ops surface.
 */
const PROVIDERS: readonly string[] = [DEFAULT_POS_PROVIDER, "petpooja", "custom_webhook"];
const STATUSES: readonly string[] = ["active", "pending", "disabled"];
const CUSTOM_POS_MIN_SECRET_LENGTH = 16;
const CUSTOM_POS_MAX_SECRET_LENGTH = 512;

/** Trim + bound a string field so a body cannot park a blob in a text column. */
function cleanString(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function restaurantIdFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function notFoundListing(): Response {
  return apiError(404, "No listing with that id", "NOT_FOUND");
}

export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const restaurantId = restaurantIdFrom(req.nextUrl.searchParams.get("restaurant_id"));
  if (restaurantId == null) {
    return apiError(400, "restaurant_id must be a positive integer", "BAD_REQUEST");
  }

  // The record is read independently of the listing's existence: a listing that
  // has never been connected has no row at all, and this route is how Petpooja
  // onboarding creates the first one.
  const listing = await getRestaurantManageById(restaurantId);
  if (!listing) return notFoundListing();
  const record = await getIntegrationRecord(restaurantId);

  return Response.json({
    ok: true,
    record,
    // Boolean only: whether the partner credentials are present on this
    // deployment. The values themselves are never returned by any route.
    petpoojaConfigured: petpoojaConfigured(),
  });
}

export async function PUT(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body =
    parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? (parsed.body as Record<string, unknown>)
      : {};

  const restaurantId = restaurantIdFrom(body.restaurant_id);
  if (restaurantId == null) {
    return apiError(400, "restaurant_id must be a positive integer", "BAD_REQUEST");
  }

  const provider = cleanString(body.provider, 40);
  if (!PROVIDERS.includes(provider)) {
    return apiError(
      400,
      `provider must be one of: ${PROVIDERS.join(", ")}`,
      "UNSUPPORTED_PROVIDER",
    );
  }

  const posRestaurantId = cleanString(body.pos_restaurant_id);
  if (!posRestaurantId) {
    return apiError(
      400,
      "pos_restaurant_id is required — it is the POS-side id orders are routed on",
      "BAD_REQUEST",
    );
  }

  const status = body.status == null ? "active" : cleanString(body.status, 20);
  if (!STATUSES.includes(status)) {
    return apiError(400, `status must be one of: ${STATUSES.join(", ")}`, "BAD_REQUEST");
  }

  if (!(await getRestaurantManageById(restaurantId))) return notFoundListing();
  const existing = await getIntegrationRecord(restaurantId);

  const switchingProvider = existing != null && existing.provider !== provider;
  if (switchingProvider) {
    const openOrders = await countOpenOrdersForRestaurant(restaurantId);
    if (openOrders > 0) {
      return apiError(
        409,
        `This listing has ${openOrders} order${openOrders === 1 ? "" : "s"} still in progress. Wait for them to finish before changing the POS provider.`,
        "OPEN_ORDERS",
      );
    }
  }

  const record = await upsertIntegrationIdentity({
    restaurantId,
    provider,
    posRestaurantId,
    status: status as "active" | "pending" | "disabled",
    // Branch/outlet are Restaurant AI routing concepts, and the sealed webhook
    // secret belongs to the previous connection. A provider switch must not
    // carry either into a provider that does not use them — a leftover secret
    // would make a re-pointed Restaurant AI record look ready when its POS was
    // never given the key.
    ...(switchingProvider
      ? { posBranchId: null, posOutletId: null, webhookSecret: null }
      : {}),
    sync: true,
  });

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  await recordIntegrationAudit(
    restaurantId,
    "pos_integration.provider_set",
    { actor: "ops", ipAddress },
    {
      provider,
      previous_provider: existing?.provider ?? null,
      pos_restaurant_id: posRestaurantId,
      status,
    },
  );

  // The record is saved even when it cannot take orders yet: an operator has to
  // be able to stage the wiring before the deployment's credentials land. The
  // readiness fields on `record` say exactly which fact is missing.
  const warnings: string[] = [];
  if (provider === "petpooja" && !petpoojaConfigured()) {
    warnings.push(
      "PETPOOJA_APP_KEY / PETPOOJA_APP_SECRET are not set on this deployment, so orders stay blocked until they are.",
    );
  }
  if (provider === DEFAULT_POS_PROVIDER && !record.ready) {
    warnings.push(
      "Restaurant AI orders are signed with a per-listing sealed webhook secret. Reconnect the POS from the partner console to obtain one.",
    );
  }

  return Response.json({ ok: true, record, ...(warnings.length ? { warnings } : {}) });
}
