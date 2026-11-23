import { NextRequest } from "next/server";
import { applyMerchantMenuReplace } from "@/db/merchant-menu-import";
import { guardBudget, readRawBodyCapped } from "@/lib/abuse";
import {
  MenuImportError,
  parseMenuImportReplace,
} from "@/lib/menu-import-core";
import { authenticateMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";

/** Full menus can exceed the standard 16 KB JSON cap; 5 MiB matches the CSV limit. */
const REPLACE_MAX_BODY_BYTES = 5 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(error: MenuImportError): Response {
  const body: Record<string, unknown> = {
    ok: false,
    error: error.message,
    code: error.code,
  };
  if (error.issues.length > 0) body.issues = error.issues;
  if (error.currentRevision !== undefined) body.currentRevision = error.currentRevision;
  return Response.json(body, { status: error.status, headers: NO_STORE });
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64) || null;
  return req.headers.get("x-real-ip")?.trim().slice(0, 64) || null;
}

export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;

  const auth = await authenticateMerchantApp(req);
  if (!auth) {
    return Response.json(
      { ok: false, error: "Marketplace link is missing or expired. Connect this business again.", code: "invalid_token" },
      { status: 401, headers: NO_STORE },
    );
  }

  const raw = await readRawBodyCapped(req, REPLACE_MAX_BODY_BYTES);
  if (!raw.ok) {
    if (raw.response.status === 413) return fail(MenuImportError.payloadTooLarge());
    return Response.json({ ok: false, error: "Invalid request", code: "validation_failed" }, { status: 400, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.text) as unknown;
  } catch {
    return fail(MenuImportError.validation([{ row: null, column: "body", code: "invalid_json", message: "Request body must be valid JSON." }]));
  }

  try {
    const payload = parseMenuImportReplace(body, req.headers.get("idempotency-key"));
    const result = await applyMerchantMenuReplace(payload, {
      restaurantId: auth.restaurantId,
      businessId: auth.businessId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 256) ?? null,
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MenuImportError) return fail(error);
    return fail(MenuImportError.replaceFailed());
  }
}
