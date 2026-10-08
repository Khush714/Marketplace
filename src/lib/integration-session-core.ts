/**
 * The integration session's policy, as pure functions.
 *
 * Split from `_auth.ts` / the query layer for the same reason
 * `restaurant-session-core.ts` exists: the decisions worth asserting — how long
 * a session lives, what makes one unusable — should not live inside a `db`
 * call. `src/db/queries.ts` carries `server-only`, so it cannot be imported
 * into tests.
 *
 * A session has TWO clocks, and conflating them is the failure this file is
 * built to prevent:
 *
 *   - Absolute expiry (`expires_at`). The hard ceiling: no session may outlive
 *     it, no matter how busy it is. A POS terminal that never stops polling is
 *     forced back through the passkey handshake once a day.
 *   - Idle expiry (`idle_expires_at`). A sliding window: every authenticated
 *     request pushes it back out to `now + IDLE_TTL`. A session that goes
 *     silent dies long before its absolute ceiling — which is the one that is
 *     actually useful against a stolen token, because a thief's beacon cannot
 *     keep calling a heartbeat without being observed.
 *
 * The token half of a session (minting, hashing) lives in `owner-key.ts` and
 * is unchanged: the POS already hand-rolls nothing other than
 * `makeAccessToken` + sha256, and re-deriving it here would give two secret
 * schemes instead of one.
 */

/** Hard ceiling on a session's life, measured from when it was minted. */
export const INTEGRATION_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Sliding inactivity window, strictly shorter than the absolute ceiling so it
 * actually bites. 30 minutes is comfortably longer than any POS heartbeat we
 * know of and short enough that a pickpocketed token dies on its own.
 */
export const INTEGRATION_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

/** The byte size of a minted token (24, matching `makeAccessToken`). */
export const INTEGRATION_SESSION_TOKEN_BYTES = 24;

/** The subset of a stored session row these decisions read. */
export interface IntegrationSessionRowLike {
  /** The absolute ceiling. Shared with the whole session store. */
  expiresAt: Date;
  /** The sliding inactivity cutoff. Null rows are treated as unusable. */
  idleExpiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Whether a session row may still authenticate a request.
 *
 * Checks are ordered revocation → absolute → idle:
 *
 *   - A revoked session is refused first so a clock change cannot revive a
 *     session somebody actually ended.
 *   - The absolute ceiling is checked before the idle window even when the
 *     idle row is missing, so a row minted before this column existed still
 *     cannot outlive its hard cap.
 *   - A present-but-stale idle window refuses. A MISSING idle window fails
 *     closed too: the column is backfilled by the migration and recreated on
 *     every mint, so a row without one has no business authenticating
 *     anything. (Treating it as "no idle limit" would silently waive the very
 *     control this file exists to define.)
 */
export function integrationSessionIsLive(
  row: IntegrationSessionRowLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() <= now) return false;
  if (row.idleExpiresAt != null && row.idleExpiresAt.getTime() <= now) return false;
  // Absent idle window against a perfectly good absolute window: refuse.
  return row.idleExpiresAt != null;
}

/**
 * The next idle cutoff for a session that just proved it is alive.
 *
 * Called on every authenticated request, mirroring the `lastUsedAt` touch: the
 * window slides with activity instead of being pinned at minting time.
 */
export function nextIdleExpiry(
  now: number = Date.now(),
  idleTtlMs: number = INTEGRATION_SESSION_IDLE_TTL_MS,
): Date {
  return new Date(now + idleTtlMs);
}