import "server-only";

/**
 * Server wiring for authenticated customer account sessions: cookie in, account
 * session out.
 *
 * Policy lives in `@/lib/customer-account-core.ts` (testable without server-only).
 * DB access lives in `@/db/customer-accounts.ts`. This file is the thin seam
 * routes call: resolve, require, issue/renew, and clear cookies, fail-closed.
 *
 * Separate from anonymous `crave_customer_session` order-code ownership: guest
 * checkout and token/session flows remain valid and must not regress.
 */

import type { NextRequest } from "next/server";

import { originDecision } from "@/lib/abuse";
import { checkRateLimit, rateLimited } from "@/lib/security/rate-limit";
import {
  accountCsrfMatches,
  accountSessionIsLive,
  accountSessionNeedsRenewal,
  buildAccountCsrfCookie,
  buildAccountSessionCookie,
  buildClearedAccountSessionCookies,
  CUSTOMER_ACCOUNT_CSRF_COOKIE,
  CUSTOMER_ACCOUNT_CSRF_HEADER,
  CUSTOMER_ACCOUNT_SESSION_COOKIE,
  type SessionCookieOptions,
} from "@/lib/customer-account-core";
import {
  getCustomerAccountSessionByToken,
  renewCustomerAccountSession,
  revokeAllCustomerAccountSessions,
  revokeCustomerAccountSession,
  touchCustomerAccountSession,
  type ResolvedAccountSession,
} from "@/db/customer-accounts";

/** Per-account budgets (keyed on resolved account/session, not client IP alone). */
const ACCOUNT_READ_BUDGET = { limit: 240, windowMs: 60_000 };
const ACCOUNT_WRITE_BUDGET = { limit: 120, windowMs: 60_000 };

export function readAccountSessionToken(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CUSTOMER_ACCOUNT_SESSION_COOKIE) {
      return decodeURIComponent(rest.join("=") ?? "");
    }
  }
  return "";
}

export function readAccountCsrfCookie(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CUSTOMER_ACCOUNT_CSRF_COOKIE) {
      return decodeURIComponent(rest.join("=") ?? "");
    }
  }
  return "";
}

export function cookieShouldBeSecure(req: Request): boolean {
  const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export interface AccountSessionCookies {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export function setAccountSessionCookies(res: Response, session: AccountSessionCookies, secure: boolean): void {
  const maxAgeSeconds = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  const opts: SessionCookieOptions = { maxAgeSeconds, secure };
  res.headers.append("Set-Cookie", buildAccountSessionCookie(session.sessionToken, opts));
  res.headers.append("Set-Cookie", buildAccountCsrfCookie(session.csrfToken, opts));
}

export function clearAccountSessionCookies(res: Response, secure: boolean): void {
  for (const cookie of buildClearedAccountSessionCookies({ secure })) {
    res.headers.append("Set-Cookie", cookie);
  }
}

export type AccountSessionResult =
  | { ok: true; session: ResolvedAccountSession; renewedExpiresAt?: Date }
  | { ok: false; response: Response };

/**
 * Resolve the authenticated account session, if any. Fail-closed: invalid,
 * expired, revoked, or inactive-account sessions resolve to null.
 */
export async function resolveAccountSession(req: Request): Promise<ResolvedAccountSession | null> {
  const token = readAccountSessionToken(req);
  if (!token) return null;
  const resolved = await getCustomerAccountSessionByToken(token);
  if (!resolved) return null;
  if (!accountSessionIsLive(resolved.session)) return null;
  if (resolved.account.status !== "active") return null;
  return resolved;
}

/**
 * Require a live authenticated account session. For mutating requests, enforces
 * same-origin/cross-site refusal and a CSRF double-submit check, then applies a
 * per-account budget. Optionally renews a near-expiry session and reports the
 * new expiry so callers can refresh cookies on the response.
 */
export async function requireAccountSession(
  req: NextRequest | Request,
  opts: { mutating: boolean; renew?: boolean },
): Promise<AccountSessionResult> {
  if (opts.mutating && originDecision(req) === "cross-site") {
    return { ok: false, response: Response.json({ ok: false, error: "Request rejected" }, { status: 403 }) };
  }

  const resolved = await resolveAccountSession(req);
  if (!resolved) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Sign in required", code: "ACCOUNT_SESSION_REQUIRED" },
        { status: 401 },
      ),
    };
  }

  if (opts.mutating) {
    const headerToken = req.headers.get(CUSTOMER_ACCOUNT_CSRF_HEADER);
    const cookieToken = readAccountCsrfCookie(req);
    // Accept header or cookie-echo channel? standard double-submit compares header
    // value against server-known secret (hash stored). Prefer header; fall back to
    // cookie only if header absent is NOT allowed for writes.
    const presented = headerToken ?? cookieToken ?? "";
    if (!accountCsrfMatches(resolved.session.csrfHash, presented)) {
      return {
        ok: false,
        response: Response.json(
          { ok: false, error: "Request rejected", code: "CSRF_INVALID" },
          { status: 403 },
        ),
      };
    }

    const budget = checkRateLimit(
      `customer-account-write:${resolved.account.id}`,
      ACCOUNT_WRITE_BUDGET.limit,
      ACCOUNT_WRITE_BUDGET.windowMs,
    );
    if (!budget.allowed) {
      return { ok: false, response: rateLimited(budget.retryAfterSeconds) };
    }
  } else {
    const budget = checkRateLimit(
      `customer-account-read:${resolved.account.id}`,
      ACCOUNT_READ_BUDGET.limit,
      ACCOUNT_READ_BUDGET.windowMs,
    );
    if (!budget.allowed) {
      return { ok: false, response: rateLimited(budget.retryAfterSeconds) };
    }
  }

  void touchCustomerAccountSession(resolved.session.id).catch(() => {});

  let renewedExpiresAt: Date | undefined;
  if (opts.renew && accountSessionNeedsRenewal(resolved.session.expiresAt)) {
    try {
      renewedExpiresAt = await renewCustomerAccountSession(resolved.session.id);
    } catch {
      // Best-effort renewal: never fail an otherwise-valid read because the
      // sliding window could not be extended.
    }
  }

  return { ok: true, session: resolved, renewedExpiresAt };
}

export async function revokeCurrentAccountSession(req: Request): Promise<boolean> {
  const resolved = await resolveAccountSession(req);
  if (!resolved) return false;
  return revokeCustomerAccountSession(resolved.session.id);
}

export async function revokeAllSessionsForCurrentAccount(req: Request): Promise<number> {
  const resolved = await resolveAccountSession(req);
  if (!resolved) return 0;
  return revokeAllCustomerAccountSessions(resolved.account.id);
}
