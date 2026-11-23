import "server-only";
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { merchantOrderEvents, orders } from "@/db/schema";
import {
  feedbackDto,
  feedbackSummary,
  feedbackThemes,
  FEEDBACK_WINDOW_DAYS,
  type FeedbackRow,
  type FeedbackSummary,
  type FeedbackTheme,
} from "@/lib/order-feedback";
import { recordOrderNotification } from "@/lib/customer-notifications";

type Feedback = ReturnType<typeof feedbackDto>;

export type SubmitFeedbackResult =
  | { kind: "OK"; feedback: Feedback }
  | { kind: "ALREADY"; feedback: Feedback }
  | { kind: "NOT_FOUND" };

/**
 * One immutable review per order. The row is locked and the UPDATE carries the
 * `feedback_at IS NULL` predicate, so two tabs submitting together cannot both
 * win — the loser reads back the row the winner wrote instead of overwriting it.
 */
export async function submitOrderFeedback(input: {
  code: string;
  rating: number;
  review: string;
}): Promise<SubmitFeedbackResult> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders)
      .where(eq(orders.code, input.code)).limit(1).for("update");
    if (!current) return { kind: "NOT_FOUND" } as const;
    if (current.feedbackAt) {
      return { kind: "ALREADY" as const, feedback: feedbackDto(current) };
    }

    const [updated] = await tx.update(orders)
      .set({ rating: input.rating, review: input.review, feedbackAt: new Date() })
      .where(and(eq(orders.id, current.id), isNull(orders.feedbackAt)))
      .returning();
    if (!updated) {
      const [existing] = await tx.select().from(orders).where(eq(orders.id, current.id)).limit(1);
      return { kind: "ALREADY" as const, feedback: feedbackDto(existing) };
    }
    await tx.insert(merchantOrderEvents).values({
      orderId: current.id,
      restaurantId: current.restaurantId,
      fromStatus: current.merchantStatus,
      toStatus: current.merchantStatus,
      reason: "CUSTOMER_FEEDBACK",
    });
    return { kind: "OK" as const, feedback: feedbackDto(updated) };
  });
  return result;
}

export type ReplyFeedbackResult =
  | { kind: "OK"; feedback: Feedback; orderId: number }
  | { kind: "ALREADY_REPLIED"; feedback: Feedback }
  | { kind: "NOT_FOUND" }
  | { kind: "NO_FEEDBACK" }
  | { kind: "CONFLICT" };

/** A single public reply, scoped to the restaurant resolved from the bearer token. */
export async function replyToOrderFeedback(input: {
  restaurantId: number;
  orderCode: string;
  response: string;
}): Promise<ReplyFeedbackResult> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders)
      .where(and(
        eq(orders.code, input.orderCode),
        eq(orders.restaurantId, input.restaurantId),
        eq(orders.merchantManaged, true),
      )).limit(1).for("update");
    if (!current) return { kind: "NOT_FOUND" } as const;
    if (!current.feedbackAt) return { kind: "NO_FEEDBACK" } as const;
    if (current.merchantResponse) {
      return { kind: "ALREADY_REPLIED" as const, feedback: feedbackDto(current) };
    }

    const now = new Date();
    const [updated] = await tx.update(orders)
      .set({ merchantResponse: input.response, merchantRespondedAt: now })
      .where(and(eq(orders.id, current.id), eq(orders.merchantResponse, "")))
      .returning();
    if (!updated) return { kind: "CONFLICT" } as const;
    await tx.insert(merchantOrderEvents).values({
      orderId: current.id,
      restaurantId: current.restaurantId,
      fromStatus: current.merchantStatus,
      toStatus: current.merchantStatus,
      reason: "MERCHANT_FEEDBACK_REPLY",
    });
    return { kind: "OK" as const, feedback: feedbackDto(updated), orderId: current.id };
  });
  if (result.kind === "OK") {
    await recordOrderNotification({ orderId: result.orderId, kind: "feedback_reply" });
  }
  return result;
}

/** Rolling feedback summary for the Merchant App's paired-listing overview. */
export async function orderFeedbackSummary(restaurantId: number): Promise<FeedbackSummary> {
  const since = new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 86_400_000);
  const rows = await db.select({
    rating: orders.rating,
    review: orders.review,
    feedbackAt: orders.feedbackAt,
    merchantResponse: orders.merchantResponse,
    merchantRespondedAt: orders.merchantRespondedAt,
  }).from(orders).where(and(
    eq(orders.restaurantId, restaurantId),
    eq(orders.merchantManaged, true),
    isNotNull(orders.feedbackAt),
    gte(orders.feedbackAt, since),
  ));
  return feedbackSummary(rows as FeedbackRow[]);
}

type MerchantFeedbackRow = FeedbackRow & { code: string };

/** The order code is the reply handle; the customer DTO deliberately omits it. */
function merchantFeedbackDto(row: MerchantFeedbackRow) {
  return { orderCode: row.code, ...feedbackDto(row) };
}

export type MerchantFeedbackInbox = {
  reviews: ReturnType<typeof merchantFeedbackDto>[];
  summary: FeedbackSummary;
  themes: FeedbackTheme[];
};

/**
 * Merchant-owned review inbox. Both the base row and the rolling aggregates are
 * scoped to the restaurant resolved from the paired business token, so knowing
 * an order code can never expose another restaurant's feedback.
 */
export async function orderFeedbackInbox(restaurantId: number, limit = 50): Promise<MerchantFeedbackInbox> {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const since = new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 86_400_000);
  const [rows, recent] = await Promise.all([
    db.select({
      code: orders.code,
      rating: orders.rating,
      review: orders.review,
      feedbackAt: orders.feedbackAt,
      merchantResponse: orders.merchantResponse,
      merchantRespondedAt: orders.merchantRespondedAt,
    }).from(orders).where(and(
      eq(orders.restaurantId, restaurantId),
      eq(orders.merchantManaged, true),
      isNotNull(orders.feedbackAt),
    )).orderBy(desc(orders.feedbackAt)).limit(bounded),
    db.select({
      rating: orders.rating,
      review: orders.review,
      feedbackAt: orders.feedbackAt,
      merchantResponse: orders.merchantResponse,
      merchantRespondedAt: orders.merchantRespondedAt,
    }).from(orders).where(and(
      eq(orders.restaurantId, restaurantId),
      eq(orders.merchantManaged, true),
      isNotNull(orders.feedbackAt),
      gte(orders.feedbackAt, since),
    )),
  ]);
  return {
    reviews: rows.map(merchantFeedbackDto),
    summary: feedbackSummary(recent as FeedbackRow[]),
    themes: feedbackThemes(recent as FeedbackRow[]),
  };
}
