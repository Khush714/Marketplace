/**
 * Pure policy and DTO mapping for delivered-order feedback.
 *
 * Kept free of `server-only` so the trust boundary can be asserted in tests:
 * a browser may propose a rating and a comment, never a feedback timestamp, a
 * merchant reply, or another order's review. The Merchant App consumes the same
 * DTO shape whether the review was written here or in its own marketplace.
 */

/** Matches the Merchant App's feedback window and review length contract. */
export const FEEDBACK_WINDOW_DAYS = 30;
export const MAX_REVIEW_CHARS = 500;

export type FeedbackRow = {
  rating: number | null;
  review: string;
  feedbackAt: Date | null;
  merchantResponse: string;
  merchantRespondedAt: Date | null;
};

export type FeedbackDto = ReturnType<typeof feedbackDto>;

export type FeedbackSummary = {
  available: true;
  windowDays: number;
  averageRating: number | null;
  reviewCount: number;
  badOrders: number;
  pendingReplies: number;
};

/** A customer rating is an integer 1–5; a comment is optional and bounded. */
export function parseReviewInput(body: Record<string, unknown>): { rating: number; review: string } | null {
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const raw = body.review;
  if (raw !== undefined && typeof raw !== "string") return null;
  return { rating, review: (raw ?? "").trim().slice(0, MAX_REVIEW_CHARS) };
}

/** A restaurant reply is required and bounded, exactly like the Merchant editor. */
export function parseReplyInput(body: Record<string, unknown>): string | null {
  const value = body.response;
  if (typeof value !== "string") return null;
  const reply = value.trim().slice(0, MAX_REVIEW_CHARS);
  return reply || null;
}

/** Never expose an internal id or order code through the review payload. */
export function feedbackDto(row: FeedbackRow) {
  return {
    rating: row.rating,
    review: row.review,
    feedbackAt: row.feedbackAt ? row.feedbackAt.toISOString() : null,
    merchantResponse: row.merchantResponse,
    merchantRespondedAt: row.merchantRespondedAt ? row.merchantRespondedAt.toISOString() : null,
  };
}

/**
 * Aggregate over reviews inside the rolling window. Rows passed in are already
 * restaurant-scoped by the query; doing the arithmetic here keeps it testable
 * without a database and gives the Merchant App the exact summary it expects.
 */
export function feedbackSummary(
  rows: readonly FeedbackRow[],
  now = new Date(),
): FeedbackSummary {
  const since = now.getTime() - FEEDBACK_WINDOW_DAYS * 86_400_000;
  const recent = rows.filter((row) => row.feedbackAt && row.feedbackAt.getTime() >= since);
  const rated = recent.filter((row) => typeof row.rating === "number");
  const total = rated.reduce((sum, row) => sum + (row.rating ?? 0), 0);
  return {
    available: true,
    windowDays: FEEDBACK_WINDOW_DAYS,
    averageRating: rated.length ? Math.round((total / rated.length) * 10) / 10 : null,
    reviewCount: recent.length,
    badOrders: recent.filter((row) => (row.rating ?? 6) <= 2).length,
    pendingReplies: recent.filter((row) => !row.merchantResponse.trim()).length,
  };
}
