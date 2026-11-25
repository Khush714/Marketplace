import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  marketplacePayments,
  merchantPayoutBatchLines,
  merchantPayoutBatches,
  merchantPayoutEvents,
  merchantPayoutOutbox,
  merchantPayoutSettings,
  orders,
  type MerchantPayoutBatchRow,
} from "@/db/schema";
import { getPayoutAccount } from "@/db/merchant-compliance";
import { emptyMerchantPayoutFeed, toMerchantPayoutBatch } from "@/lib/merchant-payout-feed";
import {
  assertPayoutBatchTransition,
  buildPayoutPreview,
  payoutCycleWindow,
  PayoutConflictError,
  PayoutInputError,
  PayoutNotFoundError,
  type PayoutBatchStatus,
  type PayoutCycle,
  type PayoutWindow,
} from "@/lib/payout-core";
import { toMerchantSettlement } from "@/lib/merchant-settlements";

/**
 * Bounded read for one closed window. An overflow refuses the preview instead
 * of returning a partial payout: money must never be priced from a truncated
 * settlement set.
 */
const MAX_PREVIEW_SETTLEMENTS = 5_000;
const FEED_BATCH_STATUSES = ["APPROVED", "PROCESSING", "PAID", "FAILED"];

/** Both `db` and a transaction expose the same select builder. */
type PayoutReadClient = { select: typeof db.select };

export type MerchantPayoutSettingsDto = {
  cycle: PayoutCycle;
  enabled: boolean;
  updatedAt: string | null;
};

export type MerchantPayoutBatchLineDto = {
  settlementExternalId: string;
  amountPaise: number;
};

export type MerchantPayoutBatchDto = {
  reference: string;
  cycle: PayoutCycle;
  status: PayoutBatchStatus;
  periodStart: string;
  periodEnd: string;
  idempotencyKey: string;
  checksum: string;
  grossPaise: number;
  commissionPaise: number;
  refundPaise: number;
  adjustmentPaise: number;
  netPaise: number;
  lineCount: number;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lines: MerchantPayoutBatchLineDto[];
  notice: string;
};

export type MerchantPayoutPreviewResult = {
  settings: MerchantPayoutSettingsDto;
  window: {
    cycle: PayoutCycle;
    periodStart: string;
    periodEnd: string;
    idempotencyKey: string;
  };
  available: boolean;
  overflow: boolean;
  preview: ReturnType<typeof buildPayoutPreview>;
  notice: string;
};

function settingsDto(row: typeof merchantPayoutSettings.$inferSelect | undefined): MerchantPayoutSettingsDto {
  if (!row) return { cycle: "weekly", enabled: false, updatedAt: null };
  return {
    cycle: row.cycle as PayoutCycle,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type PayoutWindowLoad = {
  settings: MerchantPayoutSettingsDto;
  window: PayoutWindow;
  settlements: ReturnType<typeof toSettlementInputs>;
  overflow: boolean;
  allocated: Set<string>;
};

function toSettlementInputs(rows: {
  payment: typeof marketplacePayments.$inferSelect;
  order: typeof orders.$inferSelect;
}[]) {
  return rows.map(({ payment, order }) => {
    const record = toMerchantSettlement({
      paymentReference: payment.paymentReference,
      providerPaymentId: payment.providerPaymentId,
      currency: payment.currency,
      status: payment.status,
      signatureVerified: payment.signatureVerified,
      amountCents: payment.amountCents,
      refundedAmountCents: payment.refundedAmountCents,
      capturedAt: payment.capturedAt,
      updatedAt: payment.updatedAt,
      order: { id: order.id, code: order.code, platformFeeCents: order.platformFeeCents },
    });
    return {
      externalId: record.externalId,
      marketplaceOrderId: record.marketplaceOrderId,
      currency: payment.currency,
      status: payment.status,
      signatureVerified: payment.signatureVerified,
      grossPaise: record.grossPaise,
      commissionPaise: record.commissionPaise,
      refundPaise: record.refundPaise,
      adjustmentPaise: record.adjustmentPaise,
      netPaise: record.netPaise,
      capturedAt: payment.capturedAt,
    };
  });
}

/**
 * Loads one closed window and the settlements already priced into other
 * batches. `excludedBatchId` is used when revalidating an existing batch so its
 * own lines are not mistaken for a double allocation.
 */
async function loadPayoutWindow(
  database: PayoutReadClient,
  restaurantId: number,
  now: Date,
  excludedBatchId?: string,
): Promise<PayoutWindowLoad> {
  const settingRows = await database
    .select()
    .from(merchantPayoutSettings)
    .where(eq(merchantPayoutSettings.restaurantId, restaurantId))
    .limit(1);
  const settings = settingsDto(settingRows[0]);
  const window = payoutCycleWindow(settings.cycle, now);

  const rows = await database
    .select({ payment: marketplacePayments, order: orders })
    .from(marketplacePayments)
    .innerJoin(orders, eq(marketplacePayments.marketplaceOrderId, orders.id))
    .where(and(
      eq(marketplacePayments.restaurantId, restaurantId),
      eq(orders.restaurantId, restaurantId),
      gte(marketplacePayments.capturedAt, window.periodStart),
      lt(marketplacePayments.capturedAt, window.periodEnd),
    ))
    .orderBy(asc(marketplacePayments.capturedAt))
    .limit(MAX_PREVIEW_SETTLEMENTS + 1);

  const overflow = rows.length > MAX_PREVIEW_SETTLEMENTS;
  const settlements = overflow ? [] : toSettlementInputs(rows);
  const allocated = new Set<string>();
  if (settlements.length > 0) {
    const allocationRows = await database
      .select({ settlementExternalId: merchantPayoutBatchLines.settlementExternalId, batchId: merchantPayoutBatchLines.batchId })
      .from(merchantPayoutBatchLines)
      .where(and(
        eq(merchantPayoutBatchLines.restaurantId, restaurantId),
        inArray(merchantPayoutBatchLines.settlementExternalId, settlements.map((row) => row.externalId)),
      ));
    for (const row of allocationRows) {
      if (row.batchId !== excludedBatchId) allocated.add(row.settlementExternalId);
    }
  }

  return { settings, window, settlements, overflow, allocated };
}

export async function getPayoutSettings(restaurantId: number): Promise<MerchantPayoutSettingsDto> {
  const rows = await db
    .select()
    .from(merchantPayoutSettings)
    .where(eq(merchantPayoutSettings.restaurantId, restaurantId))
    .limit(1);
  return settingsDto(rows[0]);
}

export async function savePayoutSettings(
  restaurantId: number,
  input: { cycle: PayoutCycle; enabled: boolean },
): Promise<MerchantPayoutSettingsDto> {
  const now = new Date();
  const [row] = await db
    .insert(merchantPayoutSettings)
    .values({ restaurantId, cycle: input.cycle, enabled: input.enabled, updatedAt: now })
    .onConflictDoUpdate({
      target: merchantPayoutSettings.restaurantId,
      set: { cycle: input.cycle, enabled: input.enabled, updatedAt: now },
    })
    .returning();
  return settingsDto(row);
}

/** Read-only payout pricing for the Merchant App. No batch row is written here. */
export async function previewMerchantPayout(restaurantId: number, now = new Date()): Promise<MerchantPayoutPreviewResult> {
  const { settings, window, settlements, overflow, allocated } = await loadPayoutWindow(db, restaurantId, now);
  const preview = buildPayoutPreview({ window, settlements, alreadyAllocated: allocated });
  return {
    settings,
    window: {
      cycle: window.cycle,
      periodStart: window.periodStart.toISOString(),
      periodEnd: window.periodEnd.toISOString(),
      idempotencyKey: window.idempotencyKey,
    },
    available: !overflow,
    overflow,
    preview: {
      ...preview,
      exclusions: preview.exclusions.slice(0, 50),
    },
    notice: overflow
      ? "This payout window exceeds the preview limit. No payout is priced until it is reviewed."
      : "Preview only. No bank transfer has been created.",
  };
}

async function loadBatchLines(
  database: PayoutReadClient,
  batchIds: readonly string[],
): Promise<Map<string, MerchantPayoutBatchLineDto[]>> {
  const byBatch = new Map<string, MerchantPayoutBatchLineDto[]>();
  if (batchIds.length === 0) return byBatch;
  const rows = await database
    .select()
    .from(merchantPayoutBatchLines)
    .where(inArray(merchantPayoutBatchLines.batchId, [...batchIds]));
  for (const row of rows) {
    const list = byBatch.get(row.batchId) ?? [];
    list.push({ settlementExternalId: row.settlementExternalId, amountPaise: row.netCents });
    byBatch.set(row.batchId, list);
  }
  return byBatch;
}

function batchDto(
  row: MerchantPayoutBatchRow,
  lines: readonly MerchantPayoutBatchLineDto[],
): MerchantPayoutBatchDto {
  return {
    reference: row.reference,
    cycle: row.cycle as PayoutCycle,
    status: row.status as PayoutBatchStatus,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum,
    grossPaise: row.grossCents,
    commissionPaise: row.commissionCents,
    refundPaise: row.refundCents,
    adjustmentPaise: row.adjustmentCents,
    netPaise: row.netCents,
    lineCount: row.lineCount,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lines: [...lines].sort((a, b) => a.settlementExternalId.localeCompare(b.settlementExternalId)),
    notice: row.status === "APPROVED"
      ? "Approved and queued. No bank transfer has been initiated by Marketplace."
      : "Preview only. Approval rechecks the money snapshot before queueing.",
  };
}

/**
 * Persists an immutable payout snapshot for the closed window. Replay with the
 * same checksum returns the existing batch; changed money is a conflict, never
 * a second batch that could pay the same settlement twice.
 */
export async function createPayoutBatch(restaurantId: number, now = new Date()): Promise<MerchantPayoutBatchDto> {
  return db.transaction(async (tx) => {
    const loaded = await loadPayoutWindow(tx, restaurantId, now);
    if (loaded.overflow) {
      throw new PayoutConflictError("This payout window exceeds the pricing limit.");
    }
    if (!loaded.settings.enabled) {
      throw new PayoutInputError("Payouts are disabled for this outlet.");
    }

    const preview = buildPayoutPreview({
      window: loaded.window,
      settlements: loaded.settlements,
      alreadyAllocated: loaded.allocated,
    });
    if (preview.lines.length === 0) {
      throw new PayoutInputError("No eligible settlements are available for this payout window.");
    }

    const [existing] = await tx
      .select()
      .from(merchantPayoutBatches)
      .where(and(
        eq(merchantPayoutBatches.restaurantId, restaurantId),
        eq(merchantPayoutBatches.idempotencyKey, loaded.window.idempotencyKey),
      ))
      .limit(1)
      .for("update");
    if (existing) {
      if (existing.checksum !== preview.checksum) {
        throw new PayoutConflictError("The payout window changed after it was first priced.");
      }
      const lines = await loadBatchLines(tx, [existing.id]);
      return batchDto(existing, lines.get(existing.id) ?? []);
    }

    const reference = `pb_${randomBytes(12).toString("hex")}`;
    const [batch] = await tx
      .insert(merchantPayoutBatches)
      .values({
        restaurantId,
        reference,
        idempotencyKey: loaded.window.idempotencyKey,
        cycle: loaded.window.cycle,
        periodStart: loaded.window.periodStart,
        periodEnd: loaded.window.periodEnd,
        status: "PREVIEW",
        currency: "INR",
        grossCents: preview.totals.grossPaise,
        commissionCents: preview.totals.commissionPaise,
        refundCents: preview.totals.refundPaise,
        adjustmentCents: preview.totals.adjustmentPaise,
        netCents: preview.totals.netPaise,
        lineCount: preview.totals.lineCount,
        checksum: preview.checksum,
      })
      .onConflictDoNothing({ target: [merchantPayoutBatches.restaurantId, merchantPayoutBatches.idempotencyKey] })
      .returning();

    if (!batch) {
      throw new PayoutConflictError("This payout window was priced concurrently. Retry the read.");
    }

    const insertedLines = await tx
      .insert(merchantPayoutBatchLines)
      .values(preview.lines.map((line) => ({
        restaurantId,
        batchId: batch.id,
        settlementExternalId: line.settlementExternalId,
        marketplaceOrderId: line.marketplaceOrderId,
        grossCents: line.grossPaise,
        commissionCents: line.commissionPaise,
        refundCents: line.refundPaise,
        adjustmentCents: line.adjustmentPaise,
        netCents: line.netPaise,
        currency: line.currency,
        capturedAt: line.capturedAt,
      })))
      .onConflictDoNothing({ target: [merchantPayoutBatchLines.restaurantId, merchantPayoutBatchLines.settlementExternalId] })
      .returning({ id: merchantPayoutBatchLines.id });
    if (insertedLines.length !== preview.lines.length) {
      throw new PayoutConflictError("A settlement in this window is already allocated to another payout.");
    }

    await tx.insert(merchantPayoutEvents).values({
      restaurantId,
      batchId: batch.id,
      eventType: "BATCH_CREATED",
      detail: { reference: batch.reference, checksum: batch.checksum, lineCount: batch.lineCount },
    });

    return batchDto(batch, preview.lines.map((line) => ({
      settlementExternalId: line.settlementExternalId,
      amountPaise: line.netPaise,
    })));
  });
}

/**
 * Human approval gate. The snapshot is repriced inside the same locked
 * transaction; only an exact match can enqueue a durable outbox intent. No
 * processor or bank-transfer provider consumes that intent in this slice.
 */
export async function approvePayoutBatch(
  restaurantId: number,
  reference: string,
  expectedChecksum: string,
  now = new Date(),
): Promise<MerchantPayoutBatchDto> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(merchantPayoutBatches)
      .where(and(
        eq(merchantPayoutBatches.restaurantId, restaurantId),
        eq(merchantPayoutBatches.reference, reference),
      ))
      .limit(1)
      .for("update");
    if (!batch) throw new PayoutNotFoundError();
    if (batch.checksum !== expectedChecksum) {
      throw new PayoutConflictError("The submitted checksum does not match this payout batch.");
    }

    const linesByBatch = await loadBatchLines(tx, [batch.id]);
    const storedLines = linesByBatch.get(batch.id) ?? [];
    if (batch.status === "APPROVED") {
      return batchDto(batch, storedLines);
    }
    assertPayoutBatchTransition(batch.status as PayoutBatchStatus, "APPROVED");

    const loaded = await loadPayoutWindow(tx, restaurantId, now, batch.id);
    if (loaded.window.idempotencyKey !== batch.idempotencyKey) {
      throw new PayoutConflictError("The payout cycle changed before approval.");
    }
    if (loaded.overflow) {
      throw new PayoutConflictError("The payout window can no longer be priced safely.");
    }
    const repriced = buildPayoutPreview({
      window: loaded.window,
      settlements: loaded.settlements,
      alreadyAllocated: loaded.allocated,
    });
    if (
      repriced.checksum !== batch.checksum
      || repriced.totals.lineCount !== batch.lineCount
      || repriced.totals.netPaise !== batch.netCents
    ) {
      throw new PayoutConflictError("The payout snapshot changed before approval.");
    }

    const [approved] = await tx
      .update(merchantPayoutBatches)
      .set({ status: "APPROVED", approvedAt: now, updatedAt: now })
      .where(and(
        eq(merchantPayoutBatches.id, batch.id),
        eq(merchantPayoutBatches.status, "PREVIEW"),
      ))
      .returning();
    if (!approved) throw new PayoutConflictError("This payout batch is no longer in preview.");

    await tx.insert(merchantPayoutOutbox).values({
      restaurantId,
      batchId: approved.id,
      eventId: `payout_batch:${approved.reference}:approved`,
      jobType: "PAYOUT_BATCH_APPROVED",
      status: "PENDING",
      nextAttemptAt: now,
      payload: {
        reference: approved.reference,
        checksum: approved.checksum,
        amountPaise: approved.netCents,
        lineCount: approved.lineCount,
      },
    }).onConflictDoNothing({ target: merchantPayoutOutbox.eventId });

    await tx.insert(merchantPayoutEvents).values({
      restaurantId,
      batchId: approved.id,
      eventType: "BATCH_APPROVED",
      detail: { reference: approved.reference, checksum: approved.checksum, amountPaise: approved.netCents },
    });

    return batchDto(approved, storedLines);
  });
}

/** Merchant feed of approved payouts. Empty until a batch has been approved. */
export async function listMerchantPayoutFeed(restaurantId: number) {
  const batches = await db
    .select()
    .from(merchantPayoutBatches)
    .where(and(
      eq(merchantPayoutBatches.restaurantId, restaurantId),
      inArray(merchantPayoutBatches.status, FEED_BATCH_STATUSES),
    ))
    .orderBy(desc(merchantPayoutBatches.createdAt))
    .limit(100);
  if (batches.length === 0) return emptyMerchantPayoutFeed();

  const lines = await db
    .select()
    .from(merchantPayoutBatchLines)
    .where(and(
      eq(merchantPayoutBatchLines.restaurantId, restaurantId),
      inArray(merchantPayoutBatchLines.batchId, batches.map((batch) => batch.id)),
    ));
  const account = await getPayoutAccount(restaurantId);
  const byBatch = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byBatch.get(line.batchId) ?? [];
    list.push(line);
    byBatch.set(line.batchId, list);
  }

  const payouts = batches
    .map((batch) => toMerchantPayoutBatch({
      reference: batch.reference,
      status: batch.status as Parameters<typeof toMerchantPayoutBatch>[0]["status"],
      netPaise: batch.netCents,
      approvedAt: batch.approvedAt,
      createdAt: batch.createdAt,
      paidAt: batch.paidAt,
      maskedLabel: account?.maskedLabel ?? "",
      allocations: (byBatch.get(batch.id) ?? []).map((line) => ({
        settlementExternalId: line.settlementExternalId,
        netPaise: line.netCents,
      })),
    }))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (payouts.length === 0) return emptyMerchantPayoutFeed();
  return { ok: true as const, available: true, payouts };
}
