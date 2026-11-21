/**
 * Every published legal detail lives here, in one file.
 *
 * /terms, /privacy, /refunds and /contact all read from this module, so the
 * registered entity name, address and grievance contacts are stated in exactly
 * one place and can never drift between policies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE LAUNCH: replace every value below whose string starts with `FILL`.
 *
 * Razorpay's Payment Aggregator guidelines require the registered legal entity
 * (the brand name "crave." is not sufficient), a physical registered address, a
 * monitored support email and a support phone to be published on the live site,
 * and they verify each of these before activating a merchant id. Publishing the
 * placeholders fails that check.
 *
 * `npm run verify:legal` fails while any placeholder remains. It is deliberately
 * NOT wired into `npm run build` or CI so local work is never blocked — run it
 * as a release gate.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module is imported by server components only. Do not move these values
 * into a "use client" module: that would inline them into the client bundle.
 */

/** Sentinel prefix marking a value that must be replaced before launch. */
export const PLACEHOLDER_PREFIX = "FILL";

export const LEGAL = {
  /** Consumer-facing brand. Not a legal entity. */
  brand: "crave.",

  /**
   * Registered legal entity that contracts with customers and the payment
   * gateway, e.g. "Example Foods Private Limited".
   */
  entityName: "FILL — registered legal entity name (not the brand)",

  /** e.g. "Private Limited", "LLP", "OPC". */
  entityType: "FILL — entity type (Private Limited / LLP / OPC)",

  /** Full registered address with PIN code. A PO box will not be accepted. */
  registeredAddress: "FILL — full registered address with PIN code",

  /** GST registration number, or null if not registered for GST. */
  gstin: null,

  /**
   * FSSAI (food safety) licence number covering the platform's food operations,
   * or null. Restaurants carry their own licences; display theirs on their
   * listing where a licence number is held.
   */
  fssaiLicense: null,

  /** Monitored support mailbox. Unmonitored mailboxes fail verification. */
  supportEmail: "FILL — monitored support email",

  /** Support phone, with the hours a caller can expect a human. */
  supportPhone: "FILL — support phone number",

  /** Business hours, e.g. "9:00 AM – 9:00 PM IST, all days". */
  supportHours: "FILL — support hours (IST)",

  /**
   * Data Protection Grievance contact, published separately from general
   * support. Required by the DPDP Act, 2023 and the IT Act, 2000 §43A regime.
   * May be the same address as supportEmail, but must be monitored.
   */
  grievanceEmail: "FILL — Data Protection Grievance Officer / DPO contact email",

  /** Named grievance owner, or null if the entity is not yet required to name one. */
  grievanceOfficer: null,

  /** Date these policies take effect. Bump on any substantive change. */
  effectiveDate: "2026-10-04",

  /** Courts with exclusive jurisdiction over disputes. */
  jurisdiction: "Courts at Bharuch, Gujarat, India",

  /** Governing law. */
  governingLaw: "the laws of India",
} as const;

export type Legal = typeof LEGAL;

/** True when a published value is still a pre-launch placeholder. */
export function isPlaceholder(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith(PLACEHOLDER_PREFIX);
}

/**
 * "Example Foods Private Limited" — the entity name, with its type appended once
 * that is filled in. Used wherever prose needs to name the operator, so the
 * wording around a placeholder stays grammatical either way.
 */
export function legalEntityLabel(): string {
  return isPlaceholder(LEGAL.entityType)
    ? LEGAL.entityName
    : `${LEGAL.entityName} (${LEGAL.entityType})`;
}

/** Published keys still holding a placeholder — drives `npm run verify:legal`. */
export function unfilledLegalFields(): string[] {
  return Object.entries(LEGAL)
    .filter(([, value]) => isPlaceholder(value))
    .map(([key]) => key);
}

/**
 * Canonical URLs. Referenced by the footer, the checkout consent copy and the
 * per-page metadata so a policy is never linked from a stale path.
 */
export const LEGAL_ROUTES = {
  terms: "/terms",
  privacy: "/privacy",
  refunds: "/refunds",
  contact: "/contact",
} as const;

/** Support address rendered as a single mailto line. */
export function supportMailto(): string {
  return `mailto:${LEGAL.supportEmail}`;
}