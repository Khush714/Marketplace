/**
 * Public review DTO and pagination policy.
 *
 * Kept dependency-free so the trust boundary can be tested without a database:
 * a browser may choose a page size and carry an opaque cursor, but never a
 * restaurant id, an order code, a customer identity, or another order's review.
 */

import { feedbackDto, type FeedbackRow } from "@/lib/order-feedback";

export const DEFAULT_PUBLIC_REVIEW_PAGE_SIZE = 6;
export const MAX_PUBLIC_REVIEW_PAGE_SIZE = 20;

const CURSOR_PREFIX = "pr1";

export type PublicReviewRow = Omit<FeedbackRow, "rating" | "feedbackAt"> & {
  id: number;
  rating: number;
  feedbackAt: Date;
};

export type PublicReviewCursor = {
  feedbackAt: Date;
  id: number;
};

export type PublicReviewDto = {
  rating: number;
  review: string;
  feedbackAt: string;
  merchantResponse: string;
  merchantRespondedAt: string | null;
};

export type PublicReviewPage = {
  reviews: PublicReviewDto[];
  nextCursor: string | null;
};

/** The public shape deliberately omits the row id and the order code. */
export function publicReviewDto(row: PublicReviewRow): PublicReviewDto {
  const dto = feedbackDto(row);
  return {
    rating: dto.rating ?? row.rating,
    review: dto.review,
    feedbackAt: dto.feedbackAt ?? row.feedbackAt.toISOString(),
    merchantResponse: dto.merchantResponse,
    merchantRespondedAt: dto.merchantRespondedAt,
  };
}

export function parsePublicReviewLimit(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_PUBLIC_REVIEW_PAGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PUBLIC_REVIEW_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PUBLIC_REVIEW_PAGE_SIZE, Math.floor(parsed)));
}

/** The id breaks ties between reviews left at the same millisecond. */
export function encodePublicReviewCursor(cursor: PublicReviewCursor): string {
  return [
    CURSOR_PREFIX,
    String(cursor.feedbackAt.getTime()),
    String(cursor.id),
  ].join(".");
}

export function decodePublicReviewCursor(raw: string | null | undefined): PublicReviewCursor | null {
  if (!raw) return null;
  const match = new RegExp(`^${CURSOR_PREFIX}\\.(\\d{1,15})\\.([1-9]\\d{0,15})$`).exec(raw.trim());
  if (!match) return null;

  const time = Number.parseInt(match[1], 10);
  const id = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(id) || id <= 0) return null;

  const feedbackAt = new Date(time);
  if (Number.isNaN(feedbackAt.getTime())) return null;
  return { feedbackAt, id };
}
