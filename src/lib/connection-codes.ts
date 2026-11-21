import { and, eq, type SQL } from "drizzle-orm";
import { connectionCodes } from "@/db/schema";

/**
 * The status vocabulary and the one predicate that guards a connection code's
 * single use, shared by the code that spends it and the code that revokes it.
 *
 * Why this is a module and not two `eq(…, "unused")` calls inside queries.ts:
 * revocation and redemption are the same question asked from opposite sides —
 * "is this code still available?" — and the property that makes both safe is
 * that they can never disagree. Written separately, adding a state to one and
 * forgetting the other produces a bug that typechecks, reads correctly, and
 * surfaces only as a duplicate live listing: an operator revokes a code a
 * redemption already spent, or a withdrawn code slips past the pre-check and
 * gets spent anyway. One exported fragment makes that unrepresentable.
 *
 * This module deliberately holds no database handle and imports nothing
 * server-only, so the security-critical fragments can be asserted against real
 * compiled SQL in tests/*.test.ts rather than only in a smoke harness.
 */

/** The three states a connection code can be in. */
export const CODE_STATUSES = ["unused", "used", "revoked"] as const;

export type ConnectionCodeStatus = (typeof CODE_STATUSES)[number];

/**
 * A code is available only while it is still `unused`.
 *
 * Two call sites, and each is a security boundary:
 *   - the atomic spend in `redeemConnectionCode` — who may create a listing
 *   - the conditional update in `revokeConnectionCode` — who may withdraw
 *
 * Note what is *not* here: no separate "and not revoked" clause. Because revoked
 * is neither `unused` nor null, a withdrawn code fails this predicate for free,
 * with no third condition that a future state change could forget.
 */
export const UNSPENT_CODE: SQL<unknown> = eq(connectionCodes.status, "unused");

/**
 * Both halves of the claim at once: this code, and still unspent.
 *
 * Non-null asserted because both operands are always present, and drizzle types
 * `and()` as possibly-undefined purely to accommodate the variadic form.
 */
export function unspentCodeByCode(code: string): SQL<unknown> {
  return and(eq(connectionCodes.code, code), UNSPENT_CODE)!;
}

/**
 * Map a stored status onto the DTO union, failing closed.
 *
 * An unrecognised legacy value maps to `revoked`, never to `unused`. The ops
 * console would render it as dead either way, but the redemption pre-check reads
 * this — and defaulting unknown to "available" would turn schema drift or a
 * hand-edited row into a redeemable invite. Migration
 * `20261003_connection_code_revocation.sql` backfills such rows for the same
 * reason: belt and braces around one invariant.
 */
export function toCodeStatus(status: string): ConnectionCodeStatus {
  if (status === "used") return "used";
  if (status === "revoked") return "revoked";
  if (status === "unused") return "unused";
  return "revoked";
}

/**
 * Canonical form of a code as typed by a restaurant.
 *
 * Upper-cased and trimmed because the code is written on a card and read back by
 * hand. Every lookup normalises through here, so `cnx-hd6k2` and ` CNX-HD6K2 `
 * cannot open two redemption paths onto the same row.
 */
export function normalizeConnectionCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * Why a code can no longer be redeemed, per terminal status.
 *
 * Distinct messages are a support decision, not cosmetics. Collapsing `revoked`
 * into the `used` branch told a restaurant holding a legitimately withdrawn
 * invite that somebody else got there first, which sends them back to their
 * operator instead of asking for a fresh code.
 */
export const UNREDEEMABLE_STATUS: Record<ConnectionCodeStatus, string> = {
  unused: "",
  used: "Connection code already used",
  revoked: "This connection code was withdrawn",
};

/**
 * Whether a stored status blocks redemption at all.
 *
 * A `SELECT` is still needed before redemption to distinguish *why*, but the
 * ability to spend the code must come from {@link UNSPENT_CODE} in the UPDATE —
 * this predicate only chooses the error message, and must never be treated as
 * authorisation.
 */
export function blocksRedemption(status: string): boolean {
  return toCodeStatus(status) !== "unused";
}