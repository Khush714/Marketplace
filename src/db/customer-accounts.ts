import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customerAccounts,
  customerAccountSessions,
  customerAddresses,
  customerAuthChallenges,
  customerFavorites,
  orders,
  type CustomerAccountRow,
  type CustomerAccountSessionRow,
  type CustomerAddressRow,
  type CustomerFavoriteRow,
  type CustomerAuthChallengeRow,
  type OrderRow,
} from "@/db/schema";
import {
  CUSTOMER_AUTH_MAX_ATTEMPTS,
  hashValue,
  newAccountSessionExpiry,
  newChallengeExpiry,
  normalizeAccountName,
  normalizeAddressLabel,
  normalizeAddressText,
  normalizeCustomerAvatar,
  normalizePhoneE164,
} from "@/lib/customer-account-core";
import { normalizeOrderCode } from "@/lib/customer-session-core";
import { makeAccessToken } from "@/lib/owner-key";

/* -------------------------------- challenges ------------------------------- */

export interface CreatedChallenge {
  id: number;
  phoneE164: string;
  purpose: string;
  expiresAt: Date;
}

/**
 * Create a fresh OTP challenge for a normalized phone/purpose.
 *
 * Stores only the verifier hash (never the plaintext code). Any previously
 * unconsumed, unexpired challenges for the same phone+purpose are left in place
 * but the newest challenge is the one callers should verify against; callers may
 * optionally invalidate older ones if desired. We keep it simple and bounded by
 * TTL/attempts on each row.
 */
export async function createCustomerAuthChallenge(opts: {
  phoneE164: string;
  purpose: string;
  codeHash: string;
  maxAttempts?: number;
}): Promise<CreatedChallenge> {
  const phoneE164 = normalizePhoneE164(opts.phoneE164);
  if (!phoneE164) throw new Error("INVALID_PHONE");
  const purpose = String(opts.purpose || "login").slice(0, 32);
  const expiresAt = newChallengeExpiry();
  const [row] = await db
    .insert(customerAuthChallenges)
    .values({
      phoneE164,
      purpose,
      codeHash: opts.codeHash,
      attemptCount: 0,
      maxAttempts: opts.maxAttempts ?? CUSTOMER_AUTH_MAX_ATTEMPTS,
      expiresAt,
      consumedAt: null,
    })
    .returning({
      id: customerAuthChallenges.id,
      phoneE164: customerAuthChallenges.phoneE164,
      purpose: customerAuthChallenges.purpose,
      expiresAt: customerAuthChallenges.expiresAt,
    });
  if (!row) throw new Error("CHALLENGE_CREATE_FAILED");
  return row;
}

/**
 * Latest challenge for a phone+purpose that is still potentially verifiable by
 * state (not consumed). Expiry/attempt limits are enforced by the caller/core so
 * we can distinguish reasons without leaking them to clients.
 */
export async function getLatestCustomerAuthChallenge(
  phoneE164: string,
  purpose: string,
): Promise<CustomerAuthChallengeRow | null> {
  const phone = normalizePhoneE164(phoneE164);
  if (!phone) return null;
  const [row] = await db
    .select()
    .from(customerAuthChallenges)
    .where(
      and(
        eq(customerAuthChallenges.phoneE164, phone),
        eq(customerAuthChallenges.purpose, purpose),
        isNull(customerAuthChallenges.consumedAt),
      ),
    )
    .orderBy(desc(customerAuthChallenges.createdAt), desc(customerAuthChallenges.id))
    .limit(1);
  return row ?? null;
}

export async function incrementChallengeAttempts(id: number): Promise<void> {
  await db
    .update(customerAuthChallenges)
    .set({ attemptCount: sql`${customerAuthChallenges.attemptCount} + 1` })
    .where(eq(customerAuthChallenges.id, id));
}

export async function consumeChallenge(id: number): Promise<boolean> {
  const [row] = await db
    .update(customerAuthChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(customerAuthChallenges.id, id), isNull(customerAuthChallenges.consumedAt)))
    .returning({ id: customerAuthChallenges.id });
  return !!row;
}

/* -------------------------------- accounts --------------------------------- */

export async function getAccountByPhone(phoneE164: string): Promise<CustomerAccountRow | null> {
  const phone = normalizePhoneE164(phoneE164);
  if (!phone) return null;
  const [row] = await db
    .select()
    .from(customerAccounts)
    .where(eq(customerAccounts.phoneE164, phone))
    .limit(1);
  return row ?? null;
}

export async function getAccountById(id: number): Promise<CustomerAccountRow | null> {
  const [row] = await db.select().from(customerAccounts).where(eq(customerAccounts.id, id)).limit(1);
  return row ?? null;
}

/**
 * Find or create an active account for a verified phone. On create, marks the
 * phone verified now. Idempotent under concurrent verification for the same
 * phone via unique index + conflict handling.
 */
export async function getOrCreateVerifiedAccount(phoneE164: string): Promise<CustomerAccountRow> {
  const phone = normalizePhoneE164(phoneE164);
  if (!phone) throw new Error("INVALID_PHONE");
  const now = new Date();
  const [inserted] = await db
    .insert(customerAccounts)
    .values({
      phoneE164: phone,
      phoneVerifiedAt: now,
      name: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: customerAccounts.phoneE164 })
    .returning();
  if (inserted) return inserted;

  // Existing: ensure verified timestamp/status are set (idempotent repair).
  const existing = await getAccountByPhone(phone);
  if (!existing) throw new Error("ACCOUNT_CREATE_RACE");
  if (!existing.phoneVerifiedAt || existing.status !== "active") {
    const [updated] = await db
      .update(customerAccounts)
      .set({
        phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
        status: "active",
        updatedAt: now,
      })
      .where(eq(customerAccounts.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  return existing;
}

/* ---------------------------- google accounts ------------------------------- */

/**
 * Data-layer validation for Google's stable subject id. Deliberately local to
 * this module so the persistence layer never imports the OAuth integration.
 */
function normalizeGoogleSub(raw: unknown): string {
  const sub = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(sub)) throw new Error("INVALID_GOOGLE_SUB");
  return sub;
}

function normalizeGoogleEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || email.length > 254) throw new Error("INVALID_GOOGLE_EMAIL");
  return email;
}

export async function getAccountByGoogleSub(googleSub: string): Promise<CustomerAccountRow | null> {
  const sub = normalizeGoogleSub(googleSub);
  const [row] = await db
    .select()
    .from(customerAccounts)
    .where(eq(customerAccounts.googleSub, sub))
    .limit(1);
  return row ?? null;
}

/**
 * Find or create an account for a verified Google identity. Google-only rows
 * carry no phone and no OTP verification timestamp; phone/OTP rows are never
 * touched here because the lookup and the guarded update both require a
 * matching google_sub. Never synthesizes a phone number from an email.
 */
export async function getOrCreateGoogleAccount(input: {
  googleSub: string;
  email: string;
  name: string;
}): Promise<CustomerAccountRow> {
  const sub = normalizeGoogleSub(input.googleSub);
  const email = normalizeGoogleEmail(input.email);
  const name = normalizeAccountName(input.name);
  const now = new Date();

  const [inserted] = await db
    .insert(customerAccounts)
    .values({
      phoneE164: null,
      phoneVerifiedAt: null,
      email,
      googleSub: sub,
      name,
      status: "active",
      avatar: "",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: customerAccounts.googleSub })
    .returning();
  if (inserted) return inserted;

  const existing = await getAccountByGoogleSub(sub);
  if (!existing) throw new Error("ACCOUNT_CREATE_RACE");
  if (existing.email === email && existing.name === name) return existing;

  const [updated] = await db
    .update(customerAccounts)
    .set({ email, name, updatedAt: now })
    .where(and(eq(customerAccounts.id, existing.id), eq(customerAccounts.googleSub, sub)))
    .returning();
  if (updated) return updated;

  // Lost an update race: return the row that won rather than a stale snapshot.
  const fresh = await getAccountByGoogleSub(sub);
  if (!fresh) throw new Error("ACCOUNT_CREATE_RACE");
  return fresh;
}

export async function updateAccountProfile(
  accountId: number,
  patch: { name?: string; avatar?: string },
): Promise<CustomerAccountRow | null> {
  const set: { name?: string; avatar?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = normalizeAccountName(patch.name);
  if (patch.avatar !== undefined) set.avatar = normalizeCustomerAvatar(patch.avatar);
  const [row] = await db
    .update(customerAccounts)
    .set(set)
    .where(and(eq(customerAccounts.id, accountId), eq(customerAccounts.status, "active")))
    .returning();
  return row ?? null;
}

/* -------------------------------- sessions --------------------------------- */

export interface IssuedAccountSession {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  sessionId: number;
}

export async function createCustomerAccountSession(accountId: number): Promise<IssuedAccountSession> {
  const sessionToken = makeAccessToken();
  const csrfToken = makeAccessToken();
  const expiresAt = newAccountSessionExpiry();
  const [row] = await db
    .insert(customerAccountSessions)
    .values({
      accountId,
      tokenHash: hashValue(sessionToken),
      csrfHash: hashValue(csrfToken),
      expiresAt,
      revokedAt: null,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    })
    .returning({ id: customerAccountSessions.id, expiresAt: customerAccountSessions.expiresAt });
  if (!row) throw new Error("SESSION_CREATE_FAILED");
  return { sessionToken, csrfToken, expiresAt: row.expiresAt, sessionId: row.id };
}

export interface ResolvedAccountSession {
  session: CustomerAccountSessionRow;
  account: CustomerAccountRow;
}

/**
 * Resolve a presented session token to a live session + active account.
 * Returns null for missing/invalid/revoked/expired sessions or inactive accounts.
 * Does not slide the expiry window (caller decides renewal) but can touch lastUsedAt.
 */
export async function getCustomerAccountSessionByToken(
  token: string,
): Promise<ResolvedAccountSession | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const tokenHash = hashValue(t);
  const [row] = await db
    .select({
      s: customerAccountSessions,
      a: customerAccounts,
    })
    .from(customerAccountSessions)
    .innerJoin(customerAccounts, eq(customerAccounts.id, customerAccountSessions.accountId))
    .where(eq(customerAccountSessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return { session: row.s, account: row.a };
}

export async function touchCustomerAccountSession(sessionId: number): Promise<void> {
  await db
    .update(customerAccountSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(customerAccountSessions.id, sessionId));
}

export async function renewCustomerAccountSession(sessionId: number): Promise<Date> {
  const expiresAt = newAccountSessionExpiry();
  await db
    .update(customerAccountSessions)
    .set({ expiresAt, lastUsedAt: new Date() })
    .where(eq(customerAccountSessions.id, sessionId));
  return expiresAt;
}

export async function revokeCustomerAccountSession(sessionId: number): Promise<boolean> {
  const [row] = await db
    .update(customerAccountSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(customerAccountSessions.id, sessionId), isNull(customerAccountSessions.revokedAt)))
    .returning({ id: customerAccountSessions.id });
  return !!row;
}

export async function revokeAllCustomerAccountSessions(accountId: number): Promise<number> {
  const rows = await db
    .update(customerAccountSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(customerAccountSessions.accountId, accountId), isNull(customerAccountSessions.revokedAt)))
    .returning({ id: customerAccountSessions.id });
  return rows.length;
}

/* ------------------------------- addresses --------------------------------- */

export async function listCustomerAddresses(accountId: number): Promise<CustomerAddressRow[]> {
  return db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.accountId, accountId))
    .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.updatedAt), desc(customerAddresses.id));
}

export async function createCustomerAddress(
  accountId: number,
  input: { label: unknown; text: unknown; isDefault?: boolean },
): Promise<CustomerAddressRow | null> {
  const text = normalizeAddressText(input.text);
  if (!text) return null;
  const label = normalizeAddressLabel(input.label);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(customerAddresses)
      .where(eq(customerAddresses.accountId, accountId));
    if (Number(count) >= 20) return null; // guardrail; caller may also check
    const makeDefault = Boolean(input.isDefault) || Number(count) === 0;
    if (makeDefault) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(customerAddresses.accountId, accountId));
    }
    const [row] = await tx
      .insert(customerAddresses)
      .values({ accountId, label, text, isDefault: makeDefault, createdAt: now, updatedAt: now })
      .returning();
    return row ?? null;
  });
}

export async function updateCustomerAddress(
  accountId: number,
  addressId: number,
  patch: { label?: unknown; text?: unknown; isDefault?: boolean },
): Promise<CustomerAddressRow | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.accountId, accountId)))
      .limit(1);
    if (!existing) return null;
    const set: { label?: string; text?: string; isDefault?: boolean; updatedAt: Date } = { updatedAt: now };
    if (patch.label !== undefined) set.label = normalizeAddressLabel(patch.label);
    if (patch.text !== undefined) {
      const text = normalizeAddressText(patch.text);
      if (!text) return null;
      set.text = text;
    }
    if (patch.isDefault === true) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(customerAddresses.accountId, accountId));
      set.isDefault = true;
    } else if (patch.isDefault === false) {
      set.isDefault = false;
    }
    const [row] = await tx
      .update(customerAddresses)
      .set(set)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.accountId, accountId)))
      .returning();
    return row ?? null;
  });
}

export async function deleteCustomerAddress(accountId: number, addressId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.accountId, accountId)))
      .returning({ id: customerAddresses.id, wasDefault: customerAddresses.isDefault });
    if (!deleted) return false;
    if (deleted.wasDefault) {
      // Promote most recently updated remaining address, if any.
      const [next] = await tx
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(eq(customerAddresses.accountId, accountId))
        .orderBy(desc(customerAddresses.updatedAt), desc(customerAddresses.id))
        .limit(1);
      if (next) {
        await tx
          .update(customerAddresses)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(customerAddresses.id, next.id));
      }
    }
    return true;
  });
}

/* -------------------------------- favorites -------------------------------- */

export async function listCustomerFavorites(accountId: number): Promise<CustomerFavoriteRow[]> {
  return db
    .select()
    .from(customerFavorites)
    .where(eq(customerFavorites.accountId, accountId))
    .orderBy(desc(customerFavorites.createdAt), desc(customerFavorites.id));
}

export async function addCustomerFavorite(
  accountId: number,
  restaurantId: number,
): Promise<CustomerFavoriteRow | null> {
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) return null;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customerFavorites)
    .where(eq(customerFavorites.accountId, accountId));
  if (Number(count) >= 100) return null;
  const [row] = await db
    .insert(customerFavorites)
    .values({ accountId, restaurantId, createdAt: new Date() })
    .onConflictDoNothing({ target: [customerFavorites.accountId, customerFavorites.restaurantId] })
    .returning();
  if (row) return row;
  // Existing favorite: return it for idempotent success.
  const [existing] = await db
    .select()
    .from(customerFavorites)
    .where(and(eq(customerFavorites.accountId, accountId), eq(customerFavorites.restaurantId, restaurantId)))
    .limit(1);
  return existing ?? null;
}

export async function removeCustomerFavorite(accountId: number, restaurantId: number): Promise<boolean> {
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) return false;
  const [row] = await db
    .delete(customerFavorites)
    .where(and(eq(customerFavorites.accountId, accountId), eq(customerFavorites.restaurantId, restaurantId)))
    .returning({ id: customerFavorites.id });
  return !!row;
}

/* ------------------------------ order linking ------------------------------ */

/**
 * Link specific orders to an account by order codes.
 *
 * This is a mechanical helper: callers MUST ensure the codes are explicitly and
 * provably owned in the current request context (e.g. verified signed order
 * tokens, or bound to the caller's anonymous customer session). This function
 * will only link orders whose `customerAccountId` is currently null to avoid
 * stealing/overwriting an existing explicit link.
 */
export async function linkUnlinkedOrdersToAccountByCodes(
  accountId: number,
  codes: string[],
): Promise<number> {
  const clean = Array.from(
    new Set(codes.map((c) => normalizeOrderCode(c)).filter((c): c is string => Boolean(c))),
  );
  if (!clean.length) return 0;
  const rows = await db
    .update(orders)
    .set({ customerAccountId: accountId })
    .where(and(inArray(orders.code, clean), isNull(orders.customerAccountId)))
    .returning({ id: orders.id });
  return rows.length;
}

/**
 * Read orders linked to an account for cross-device history (most recent first).
 * Callers should apply the same public shaping/visibility rules as other order
 * history surfaces.
 */
export async function listOrdersByCustomerAccountId(
  accountId: number,
  limit = 30,
): Promise<OrderRow[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.customerAccountId, accountId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(Math.max(1, Math.min(100, limit)));
}

/**
 * Resolve specific order codes that are linked to an account (for verified access
 * paths where the account is the proven owner).
 */
export async function getLinkedOrdersByCodesForAccount(
  accountId: number,
  codes: string[],
): Promise<OrderRow[]> {
  const clean = Array.from(
    new Set(codes.map((c) => normalizeOrderCode(c)).filter((c): c is string => Boolean(c))),
  );
  if (!clean.length) return [];
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.customerAccountId, accountId), inArray(orders.code, clean)));
}

export async function isOrderLinkedToAccount(accountId: number, code: string): Promise<boolean> {
  const normalized = normalizeOrderCode(code);
  if (!normalized) return false;
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.code, normalized), eq(orders.customerAccountId, accountId)))
    .limit(1);
  return !!row;
}

/* --------------------------------- cleanup --------------------------------- */

const DEFAULT_CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000; // 1 day
const DEFAULT_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Prune expired or long-consumed OTP challenges. Safe to run periodically:
 * verification consumes challenges atomically and only live (unconsumed, unexpired,
 * within attempts) challenges are accepted.
 */
export async function cleanupExpiredCustomerAuthChallenges(opts?: {
  now?: Date;
  retentionMs?: number;
}): Promise<number> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts?.retentionMs ?? DEFAULT_CHALLENGE_RETENTION_MS));
  const rows = await db
    .delete(customerAuthChallenges)
    .where(
      or(
        lt(customerAuthChallenges.expiresAt, cutoff),
        and(isNotNull(customerAuthChallenges.consumedAt), lt(customerAuthChallenges.consumedAt, cutoff)),
      ),
    )
    .returning({ id: customerAuthChallenges.id });
  return rows.length;
}

/**
 * Prune account sessions that are no longer live (expired or revoked) and past a
 * short retention grace period. Live sessions are never removed by this sweep.
 */
export async function cleanupStaleCustomerAccountSessions(opts?: {
  now?: Date;
  retentionMs?: number;
}): Promise<number> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts?.retentionMs ?? DEFAULT_SESSION_RETENTION_MS));
  const rows = await db
    .delete(customerAccountSessions)
    .where(
      or(
        lt(customerAccountSessions.expiresAt, cutoff),
        and(isNotNull(customerAccountSessions.revokedAt), lt(customerAccountSessions.revokedAt, cutoff)),
      ),
    )
    .returning({ id: customerAccountSessions.id });
  return rows.length;
}

export async function cleanupCustomerAuthArtifacts(opts?: {
  now?: Date;
  challengeRetentionMs?: number;
  sessionRetentionMs?: number;
}): Promise<{ challengesDeleted: number; sessionsDeleted: number }> {
  const now = opts?.now ?? new Date();
  const [challengesDeleted, sessionsDeleted] = await Promise.all([
    cleanupExpiredCustomerAuthChallenges({ now, retentionMs: opts?.challengeRetentionMs }),
    cleanupStaleCustomerAccountSessions({ now, retentionMs: opts?.sessionRetentionMs }),
  ]);
  return { challengesDeleted, sessionsDeleted };
}
