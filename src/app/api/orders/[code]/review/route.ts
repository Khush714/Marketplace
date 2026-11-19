import { submitOrderFeedback } from "@/db/order-feedback";
import { getOrderByCode } from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import { parseReviewInput } from "@/lib/order-feedback";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";

export const dynamic = "force-dynamic";

/**
 * Customer review for a delivered order. The order code alone is not a
 * credential — the signed token minted at checkout is — and the rating and
 * comment are parsed again here. The stored feedback timestamp, merchant reply
 * and order identity never come from the browser.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!verifyOrderToken(code, readOrderToken(req.headers))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const blocked = await guardWrite(req, "orderReview");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
    ? parseReviewInput(parsed.body as Record<string, unknown>)
    : null;
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

  const result = await submitOrderFeedback({ code, ...input });
  if (result.kind === "NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    ok: true,
    alreadySubmitted: result.kind === "ALREADY",
    feedback: result.feedback,
  });
}
