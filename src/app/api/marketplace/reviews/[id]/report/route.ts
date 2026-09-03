import { db } from "@/db";
import { reviewReports, reviews } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** POST /api/marketplace/reviews/:id/report  { reason, note? } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: "Invalid review" }, { status: 400 });
  }
  const [exists] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  if (!exists) return Response.json({ error: "Review not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason ?? "inappropriate").slice(0, 80);
  const note = String(body.note ?? "").slice(0, 500);

  await db.insert(reviewReports).values({ reviewId, reason, note });
  return Response.json({ ok: true }, { status: 201 });
}
