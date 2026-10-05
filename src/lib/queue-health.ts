import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { posBaseUrlProblem } from "@/lib/pos-bridge";

/**
 * Queue health for the two at-least-once delivery journals.
 *
 * Both journals are the only place a failed marketplace→POS push is visible.
 * A delivery that exhausts its retries lands as terminal `FAILED` and is never
 * retried again, so nothing surfaces it: the customer sees an order that never
 * reaches the kitchen and the restaurant never sees it. Without a counter there
 * is no signal to alert on, which is why this exists.
 *
 * `oldestPendingAgeSeconds` is the other half. On a serverless host the drain is
 * a scheduled HTTP call (see vercel.json), so "PENDING" is normal for up to one
 * schedule interval; a growing oldest-pending age means the schedule is not
 * firing or the drain is erroring, which is invisible from the row count alone.
 *
 * Counts are aggregates over journal tables only — no tenant data, no secrets —
 * and the whole report sits behind the ops token.
 */
export type QueueHealth = {
  orders: JournalHealth;
  payments: JournalHealth;
};

export type JournalHealth = {
  pending: number;
  delivered: number;
  failed: number;
  /** Age of the oldest still-owed row, or null when nothing is pending. */
  oldestPendingAgeSeconds: number | null;
};

const ORDERS_SQL = sql`
  select
    count(*) filter (where status = 'PENDING')::int                       as pending,
    count(*) filter (where status = 'DELIVERED')::int                     as delivered,
    count(*) filter (where status = 'FAILED')::int                        as failed,
    extract(epoch from (now() - min(created_at) filter (where status = 'PENDING')))::float8
                                                                          as oldest_pending_age
  from marketplace_pos_order_deliveries
`;

const PAYMENTS_SQL = sql`
  select
    count(*) filter (where status = 'PENDING')::int                       as pending,
    count(*) filter (where status = 'DELIVERED')::int                     as delivered,
    count(*) filter (where status = 'FAILED')::int                        as failed,
    extract(epoch from (now() - min(created_at) filter (where status = 'PENDING')))::float8
                                                                          as oldest_pending_age
  from marketplace_pos_payment_deliveries
`;

type RawRow = {
  pending: number | null;
  delivered: number | null;
  failed: number | null;
  oldest_pending_age: number | null;
};

function toJournalHealth(row: RawRow): JournalHealth {
  const age = row.oldest_pending_age;
  return {
    pending: row.pending ?? 0,
    delivered: row.delivered ?? 0,
    failed: row.failed ?? 0,
    oldestPendingAgeSeconds: age == null ? null : Math.max(0, Math.round(age)),
  };
}

export async function readQueueHealth(): Promise<QueueHealth> {
  const [orders, payments] = await Promise.all([
    db.execute(ORDERS_SQL),
    db.execute(PAYMENTS_SQL),
  ]);
  return {
    orders: toJournalHealth((orders as unknown as RawRow[])[0]),
    payments: toJournalHealth((payments as unknown as RawRow[])[0]),
  };
}

export type DrainHealth = {
  /** Whether an in-process drain loop can run on this host at all. */
  inProcessLoop: boolean;
  /** Whether a scheduled drain is the only thing that will run here. */
  schedulerRequired: boolean;
  configured: boolean;
  problem: string | null;
};

/**
 * Where the drain actually runs on THIS host. The in-process loop in
 * src/instrumentation.ts is skipped on Vercel (functions are ephemeral), so on
 * that host a missing/failing schedule means orders silently never reach the
 * POS — worth stating explicitly rather than leaving an operator to infer it.
 */
export function readDrainHealth(): DrainHealth {
  const onVercel = !!process.env.VERCEL || !!process.env.VERCEL_ENV;
  const problem = posBaseUrlProblem();
  return {
    inProcessLoop: !onVercel,
    schedulerRequired: onVercel,
    configured: !problem,
    problem: problem ? `${problem.reason}: ${problem.detail}` : null,
  };
}