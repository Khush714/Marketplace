import { createHash } from "node:crypto";
import { db } from "@/db";
import { integrationIdempotency } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PHASE 17 — idempotency helper.
 *
 * Wraps an inbound handler so that a retried request with the same
 * (scope, idempotencyKey) returns the cached first response instead of
 * executing the side effect twice. This is what makes "Marketplace retries
 * MKT-10291 after a network failure" safe: the receiver keys on
 * external_order_id, sees it already handled the order, and returns the
 * existing order rather than creating a duplicate.
 *
 *   replays a duplicate with:
 *     - same key + same body  → cached response, marked `replayed: true`
 *     - same key + different body → 409 conflict (the key is taken)
 *     - new key               → runs `run()`, caches its response
 */

export type IdempotentResult<T> = {
  replayed: boolean;
  conflict: boolean;
  status: number;
  body: T;
};

type Options<T> = {
  /** Namespace the key lives in, e.g. `restaurant:3` or `integration:1`. */
  scope: string;
  /** Stable dedup key (external_order_id / event_id). */
  key: string;
  /** Function that performs the (once-only) side effect and returns its response. */
  run: () => Promise<{ status: number; body: T }>;
  /** Raw request body bytes to fingerprint; omitted → no conflict detection. */
  rawBody?: string | null;
};

export function requestHash(rawBody?: string | null): string {
  if (!rawBody) return "";
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function withIdempotency<T>(opts: Options<T>): Promise<IdempotentResult<T>> {
  const hash = opts.rawBody ? requestHash(opts.rawBody) : "";

  // 1. Look up an existing record for this (scope, key).
  const [existing] = await db
    .select()
    .from(integrationIdempotency)
    .where(
      and(
        eq(integrationIdempotency.scope, opts.scope),
        eq(integrationIdempotency.idempotencyKey, opts.key),
      ),
    )
    .limit(1);

  if (existing) {
    // Same key, different body → the key is taken by a different request.
    if (hash && existing.requestHash && existing.requestHash !== hash) {
      return {
        replayed: false,
        conflict: true,
        status: 409,
        body: { error: "Idempotency key reuse: a different request used this key" } as T,
      };
    }
    // Same key, same body → return the cached original response.
    return {
      replayed: true,
      conflict: false,
      status: existing.statusCode,
      body: JSON.parse(existing.response) as T,
    };
  }

  // 2. First time — run the side effect.
  const result = await opts.run();

  // 3. Cache it. A concurrent first request may have won the race; if so we
  //    return the winner's response (replayed) rather than erroring.
  try {
    await db.insert(integrationIdempotency).values({
      scope: opts.scope,
      idempotencyKey: opts.key,
      requestHash: hash,
      response: JSON.stringify(result.body),
      statusCode: result.status,
    });
  } catch {
    const [winner] = await db
      .select()
      .from(integrationIdempotency)
      .where(
        and(
          eq(integrationIdempotency.scope, opts.scope),
          eq(integrationIdempotency.idempotencyKey, opts.key),
        ),
      )
      .limit(1);
    if (winner) {
      return {
        replayed: true,
        conflict: false,
        status: winner.statusCode,
        body: JSON.parse(winner.response) as T,
      };
    }
  }

  return { replayed: false, conflict: false, status: result.status, body: result.body };
}