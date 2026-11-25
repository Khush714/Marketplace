import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, orders } from "@/db/schema";
import type { MediaKind } from "@/lib/media-core";

export async function createMediaAsset(input: {
  restaurantId: number;
  orderId?: number | null;
  kind: MediaKind;
  contentType: string;
  bytes: Uint8Array;
}): Promise<number> {
  const [row] = await db
    .insert(mediaAssets)
    .values({
      restaurantId: input.restaurantId,
      orderId: input.orderId ?? null,
      kind: input.kind,
      contentType: input.contentType,
      byteSize: input.bytes.length,
      dataBase64: Buffer.from(input.bytes).toString("base64"),
    })
    .returning({ id: mediaAssets.id });
  return row.id;
}

export type ServableMedia = {
  id: number;
  restaurantId: number;
  kind: string;
  contentType: string;
  bytes: Buffer;
};

/** Review photos are publishable only once their order actually has a review. */
export async function getServableMedia(id: number): Promise<ServableMedia | null> {
  const [row] = await db
    .select({
      id: mediaAssets.id,
      restaurantId: mediaAssets.restaurantId,
      kind: mediaAssets.kind,
      contentType: mediaAssets.contentType,
      dataBase64: mediaAssets.dataBase64,
      feedbackAt: orders.feedbackAt,
      reviewPhotoIds: orders.reviewPhotoIds,
    })
    .from(mediaAssets)
    .leftJoin(orders, eq(mediaAssets.orderId, orders.id))
    .where(eq(mediaAssets.id, id))
    .limit(1);
  if (!row) return null;
  // A review photo becomes public only when it is actually attached to a
  // published review — otherwise an uploaded-but-discarded image would be
  // reachable by enumerating ids on any reviewed order.
  if (row.kind === "review" && (!row.feedbackAt || !row.reviewPhotoIds?.includes(id))) return null;
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    kind: row.kind,
    contentType: row.contentType,
    bytes: Buffer.from(row.dataBase64, "base64"),
  };
}

/** Only ids belonging to this order/restaurant may be attached to a review. */
export async function getReviewAssetIds(orderId: number, restaurantId: number, ids: readonly number[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(
      eq(mediaAssets.orderId, orderId),
      eq(mediaAssets.restaurantId, restaurantId),
      eq(mediaAssets.kind, "review"),
      inArray(mediaAssets.id, [...ids]),
    ));
  return rows.map((r) => r.id);
}
