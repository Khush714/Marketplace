/**
 * Public rating policy for Marketplace listings.
 *
 * `restaurants.rating` and `ratings_count` are onboarding defaults, not measured
 * customer opinion. Once a restaurant has real delivered-order reviews, those
 * reviews are the only honest source for the score a diner sees and ranks by.
 * Kept dependency-free so the policy can be unit-tested without a database.
 */

export type PublicRatingBase = { rating: number; ratingsCount: number };
export type PublicReviewAggregate = { averageRating: number; reviewCount: number };

export function publicRating(base: PublicRatingBase, review: PublicReviewAggregate | null | undefined) {
  if (!review || review.reviewCount <= 0 || !Number.isFinite(review.averageRating)) {
    return { rating: base.rating, ratingsCount: base.ratingsCount };
  }
  const bounded = Math.min(5, Math.max(1, review.averageRating));
  return {
    rating: Math.round(bounded * 10) / 10,
    ratingsCount: review.reviewCount,
  };
}
