import { NextRequest } from "next/server";
import { createMediaAsset } from "@/db/media";
import { getOrderByCode } from "@/db/queries";
import { guardBudget, originDecision, readRawBodyCapped } from "@/lib/abuse";
import { authoriseMenu } from "@/lib/partner-menu-api";
import { parseMediaUpload } from "@/lib/media-core";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

const MAX_MEDIA_BODY_BYTES = 3 * 1024 * 1024;

/**
 * Uploads are JSON-carried base64 bytes rather than multipart so the same capped
 * reader and origin checks cover every caller. `guardWrite` cannot be used here:
 * its 16 KB JSON cap is deliberately smaller than a 2 MB image. The budget and
 * origin checks are applied explicitly instead, then the stream is capped here.
 */
export async function POST(req: NextRequest) {
  if (originDecision(req) === "cross-site") {
    return Response.json({ ok: false, error: "Cross-site request rejected" }, { status: 403 });
  }
  const blocked = guardBudget(req, "mediaUpload");
  if (blocked) return blocked;

  const raw = await readRawBodyCapped(req, MAX_MEDIA_BODY_BYTES);
  if (!raw.ok) return raw.response;

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const parsed = parseMediaUpload(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const rec = body as { code?: unknown };
  if (parsed.kind === "menu") {
    const auth = await authoriseMenu(req, true);
    if (!auth.ok) return auth.response;
    const id = await createMediaAsset({
      restaurantId: auth.restaurantId,
      kind: "menu",
      contentType: parsed.contentType,
      bytes: parsed.bytes,
    });
    return Response.json({ ok: true, id, url: `/api/media/${id}` }, { headers: { "Cache-Control": "no-store" } });
  }

  const code = typeof rec.code === "string" ? rec.code : "";
  if (!code || !(await orderAuthorized(req, code))) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  if (!order.status.delivered) {
    return Response.json(
      { ok: false, error: "You can add photos once the order has been delivered." },
      { status: 409 },
    );
  }
  const id = await createMediaAsset({
    restaurantId: order.restaurantId,
    orderId: order.id,
    kind: "review",
    contentType: parsed.contentType,
    bytes: parsed.bytes,
  });
  return Response.json({ ok: true, id, url: `/api/media/${id}` }, { headers: { "Cache-Control": "no-store" } });
}
