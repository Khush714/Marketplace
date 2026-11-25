import { getReviewAssetIds } from "@/db/media";
import { submitOrderFeedback } from "@/db/order-feedback";
import { getOrderByCode } from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import { parsePhotoIds } from "@/lib/media-core";
import { parseReviewInput } from "@/lib/order-feedback";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

/**
 * Customer review for a delivered order. The order code alone is not a
 * credential — the signed token minted at checkout, or a live session bound to
 * it, is — and the rating and comment are parsed again here. The stored
 * feedback timestamp, merchant reply and order identity never come from the
 * browser. The budget is charged before either credential is checked.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "orderReview");
  if (blocked) return blocked;
  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
    ? (parsed.body as Record<string, unknown>)
    : {};
  const input = parseReviewInput(body);
  if (!input) {
    return Response.json({ ok: false, error: "Choose a rating between 1 and 5 stars." }, { status: 400 });
  }

  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });
  // The same lifecycle projection the tracking screen renders is the authority
  // here, so a cancelled or merely placed order can never be reviewed.
  if (!order.status.delivered) {
    return Response.json(
      { ok: false, error: "You can rate this order once it has been delivered." },
      { status: 409 },
    );
  }

  // Ids are only accepted when the uploaded row belongs to THIS order and
  // restaurant; an id from another tenant is silently dropped, not an oracle.
  const photoIds = await getReviewAssetIds(
    order.id,
    order.restaurantId,
    parsePhotoIds(body.photoIds),
  );
  const result = await submitOrderFeedback({ code, ...input, photoIds });
  if (result.kind === "NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    ok: true,
    alreadySubmitted: result.kind === "ALREADY",
    feedback: result.feedback,
  });
}
