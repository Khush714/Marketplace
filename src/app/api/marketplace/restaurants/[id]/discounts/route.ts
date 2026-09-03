import { lookupDiscount } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/restaurants/:id/discounts?code=WELCOME10
 * Consumer-facing: returns the amount only after the min-subtotal check succeeds
 * so the client can compute the same total as the server.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const result = await lookupDiscount(id, code);
  if (!result.ok) return errorJson(result.error, 404);
  return safeJson({ discount: result.discount });
}
