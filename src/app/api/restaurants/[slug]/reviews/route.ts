import { submitReview } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

/** Legacy endpoint — delegates to the shared review write path. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const body = await request.json();
    const result = await submitReview({
      restaurant: slug,
      author: String(body.customerName ?? body.author ?? ""),
      rating: Number(body.rating),
      comment: typeof body.comment === "string" ? body.comment : "",
      orderReference:
        typeof body.orderReference === "string" ? body.orderReference : "",
    });

    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ review: result.review }, { status: 201 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to submit review" }, { status: 500 });
  }
}
