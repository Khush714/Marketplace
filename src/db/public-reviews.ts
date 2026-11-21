import "server-only";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { orders, restaurants } from "@/db/schema";
import {
  decodePublicReviewCursor,
  encodePublicReviewCursor,
  publicReviewDto,
  type PublicReviewCursor,
  type PublicReviewDto,
  type PublicReviewPage,
  type PublicReviewRow,
} from "@/lib/public-review-core";

type PublicReviewQueryRow = Omit<PublicReviewRow, "rating" | "feedbackAt"> & {
  rating: number | null;
  feedbackAt: Date | null;
};

function isPublicReviewRow(row: PublicReviewQueryRow): row is PublicReviewRow {
  return typeof row.rating === "number" && row.feedbackAt instanceof Date;
}

/**
 * Public review list for one active listing. The conditions mirror
 * `publicRatingSql`, so the reviews a diner can read are exactly the reviews
 * behind the rating shown on the same page.
 */
export async function listPublicRestaurantReviews(
  slug: string,
  options: { limit: number; cursor?: string | null },
): Promise<PublicReviewPage | null> {
  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(eq(restaurants.slug, slug), eq(restaurants.isActive, true)))
    .limit(1);
  if (!restaurant) return null;

  const cursor = decodePublicReviewCursor(options.cursor);
  const afterCursor = cursor
    ? or(
      lt(orders.feedbackAt, cursor.feedbackAt),
      and(eq(orders.feedbackAt, cursor.feedbackAt), lt(orders.id, cursor.id)),
    )
    : undefined;

  const rows = await db
    .select({
      id: orders.id,
      rating: orders.rating,
      review: orders.review,
      feedbackAt: orders.feedbackAt,
      merchantResponse: orders.merchantResponse,
      merchantRespondedAt: orders.merchantRespondedAt,
    })
    .from(orders)
    .where(and(
      eq(orders.restaurantId, restaurant.id),
      isNotNull(orders.feedbackAt),
      isNotNull(orders.rating),
      afterCursor,
    ))
    .orderBy(desc(orders.feedbackAt), desc(orders.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const page = (hasMore ? rows.slice(0, options.limit) : rows).filter(isPublicReviewRow);
  const last = page.at(-1);

  return {
    reviews: page.map((row) => publicReviewDto(row) as PublicReviewDto),
    nextCursor: hasMore && last ? encodePublicReviewCursor(last) : null,
  };
}
