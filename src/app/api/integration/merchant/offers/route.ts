import { NextRequest } from "next/server";
import {
  archiveMerchantOffer,
  createMerchantOffer,
  findMerchantOffer,
  listMerchantOffers,
  updateMerchantOffer,
} from "@/db/merchant-offers";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { merchantOfferDto, parseMerchantOfferInput } from "@/lib/merchant-offer";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

async function auth(req: NextRequest, write: boolean) {
  const blocked = guardBudget(req, write ? "merchantServiceWrite" : "merchantServiceRead");
  if (blocked) return { response: blocked };
  const merchant = await authenticateMerchantApp(req);
  if (!merchant) return { response: unauthenticatedMerchantApp() };
  return { merchant };
}

async function jsonBody(req: NextRequest) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return { response: parsed.response };
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) {
    return { response: Response.json({ ok: false, error: "Invalid request" }, { status: 400 }) };
  }
  return { body: parsed.body as Record<string, unknown> };
}

/** Merchant App offer library for the authenticated listing. */
export async function GET(req: NextRequest) {
  const result = await auth(req, false);
  if ("response" in result) return result.response;
  const rows = await listMerchantOffers(result.merchant.restaurantId);
  return Response.json(
    { offers: rows.map((row) => merchantOfferDto(row, result.merchant.businessId)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  let input;
  try {
    input = parseMerchantOfferInput(body.body);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Please check the offer details." }, { status: 400 });
  }
  try {
    const row = await createMerchantOffer(result.merchant.restaurantId, input);
    return Response.json({ offer: merchantOfferDto(row, result.merchant.businessId) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ ok: false, error: "That code is already in use. Choose another one." }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  const id = String(body.body.id ?? "");
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Offer not found." }, { status: 404 });
  const current = await findMerchantOffer(result.merchant.restaurantId, id);
  if (!current) return Response.json({ ok: false, error: "Offer not found." }, { status: 404 });

  let changes: Parameters<typeof updateMerchantOffer>[2];
  if (body.body.action === "toggle") {
    changes = { active: !current.active };
  } else if (typeof body.body.action !== "undefined") {
    return Response.json({ ok: false, error: "Invalid offer action." }, { status: 400 });
  } else {
    let input;
    try {
      input = parseMerchantOfferInput(body.body);
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Please check the offer details." }, { status: 400 });
    }
    changes = {
      code: input.code, title: input.title, description: input.description,
      discountType: input.discountType, value: input.value, minOrder: input.minOrder,
      maxDiscount: input.maxDiscount, startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null, usageLimit: input.usageLimit,
      active: input.active,
    };
  }

  try {
    const row = await updateMerchantOffer(result.merchant.restaurantId, id, changes);
    if (!row) return Response.json({ ok: false, error: "Offer not found." }, { status: 404 });
    return Response.json({ offer: merchantOfferDto(row, result.merchant.businessId) });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ ok: false, error: "That code is already in use. Choose another one." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  const id = String(body.body.id ?? "");
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Offer not found." }, { status: 404 });
  const removed = await archiveMerchantOffer(result.merchant.restaurantId, id);
  if (!removed) return Response.json({ ok: false, error: "Offer not found." }, { status: 404 });
  return Response.json({ ok: true });
}
