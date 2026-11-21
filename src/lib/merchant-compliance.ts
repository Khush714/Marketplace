/**
 * Pure validation and DTO projection for the Merchant App compliance feed.
 *
 * Marketplace is authoritative for payout destinations and invoices. This file
 * deliberately has no `server-only` imports so the rules can be tested without
 * a database, and it only describes the wire contract the paired Merchant App
 * already parses (`parseRemotePayout` / `parseRemoteInvoiceFeed`). It adds no
 * behaviour to any existing Marketplace feature.
 */

import { type MerchantSettlementStatus } from "./merchant-settlements";

/** The Merchant App rejects feeds larger than this. */
export const MERCHANT_INVOICE_LIMIT = 500;

const UPI = /^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export class MerchantComplianceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantComplianceInputError";
  }
}

function invalid(message: string): never {
  throw new MerchantComplianceInputError(message);
}

export type MerchantPayoutStatus =
  | "not_configured" | "pending" | "configured" | "verified" | "action_required";

const PAYOUT_STATUSES = new Set<MerchantPayoutStatus>([
  "not_configured", "pending", "configured", "verified", "action_required",
]);

export type MerchantPayoutInput =
  | { method: "upi"; upiId: string }
  | { method: "bank"; accountHolderName: string; accountNumber: string; ifsc: string };

export type MerchantPayoutDto = {
  status: MerchantPayoutStatus;
  methodLabel: string;
  reference: string;
  updatedAt: string;
};

/** Only fields the projection needs; the DB layer supplies the real row. */
export type MerchantPayoutRow = {
  status: string;
  maskedLabel: string;
  reference: string | null;
  updatedAt: Date;
};

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") invalid(`${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) invalid(`Enter a valid ${label.toLowerCase()}.`);
  return trimmed;
}

/** Mirror the Merchant app's own validation so bad destinations never reach storage. */
export function normalizePayoutInput(value: unknown): MerchantPayoutInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Payout details are required.");
  const body = value as Record<string, unknown>;
  if (body.method === "upi") {
    const upiId = text(body.upiId, 120, "UPI ID");
    if (!UPI.test(upiId)) invalid("Enter a valid UPI ID.");
    return { method: "upi", upiId };
  }
  if (body.method === "bank") {
    const accountHolderName = text(body.accountHolderName, 120, "Account holder name");
    const accountNumber = text(body.accountNumber, 20, "Account number");
    const ifsc = text(body.ifsc, 20, "IFSC").toUpperCase();
    if (!/^\d{9,18}$/.test(accountNumber)) invalid("Enter a valid account number.");
    if (!IFSC.test(ifsc)) invalid("Enter a valid IFSC.");
    return { method: "bank", accountHolderName, accountNumber, ifsc };
  }
  invalid("Choose UPI or bank as the payout method.");
}

/** The only payout value that is ever returned or stored in display form. */
export function maskPayout(input: MerchantPayoutInput): string {
  if (input.method === "upi") {
    const [local, domain] = input.upiId.split("@");
    return `UPI ${local.slice(0, 2)}***@${domain}`;
  }
  return `Bank ••••${input.accountNumber.slice(-4)} (${input.ifsc})`;
}

export function payoutDto(row: MerchantPayoutRow): MerchantPayoutDto {
  const status = PAYOUT_STATUSES.has(row.status as MerchantPayoutStatus)
    ? row.status as MerchantPayoutStatus
    : "configured";
  return {
    status,
    methodLabel: row.maskedLabel.slice(0, 120),
    reference: (row.reference ?? "").slice(0, 200),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function notConfiguredPayout(now: Date = new Date()): MerchantPayoutDto {
  return { status: "not_configured", methodLabel: "", reference: "", updatedAt: now.toISOString() };
}

export type MerchantComplianceInvoice = {
  invoiceNumber: string;
  externalId: string;
  orderId: string;
  recipientName: string;
  recipientGstin: string;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  currency: string;
  status: "issued" | "proforma" | "cancelled" | "void";
  issuedAt: string;
  updatedAt: string;
};

export type ComplianceInvoiceSource = {
  paymentReference: string;
  currency: string;
  settlementStatus: MerchantSettlementStatus;
  netPaise: number;
  orderCode: string;
  customerName: string;
  issuedAt: Date;
  updatedAt: Date;
};

/**
 * Payment-derived invoice records. Marketplace has no GST configuration, so tax
 * components are zero rather than invented; the taxable amount is the merchant's
 * settled money (gross less commission and refunds), never the gross capture.
 */
export function toComplianceInvoice(source: ComplianceInvoiceSource): MerchantComplianceInvoice {
  const amount = Math.max(0, Math.trunc(source.netPaise));
  const status: MerchantComplianceInvoice["status"] =
    source.settlementStatus === "paid" ? "issued"
      : source.settlementStatus === "reversed" ? "cancelled"
        : source.settlementStatus === "failed" ? "void"
          : "proforma";
  const invoiceNumber = source.paymentReference.slice(0, 120);
  return {
    invoiceNumber,
    externalId: `payment:${source.paymentReference}`.slice(0, 200),
    orderId: source.orderCode.slice(0, 120),
    recipientName: source.customerName.slice(0, 200),
    recipientGstin: "",
    taxableAmount: amount,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    totalAmount: amount,
    currency: (source.currency.trim().toUpperCase() || "INR").slice(0, 3),
    status,
    issuedAt: source.issuedAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
