import { NextRequest } from "next/server";

import { guardWrite, readJsonBody } from "@/lib/abuse";
import {
  challengeState,
  normalizeAccountName,
  normalizePhoneE164,
  otpMatches,
} from "@/lib/customer-account-core";
import { getCustomerOtpSecret, isCustomerAuthAvailable } from "@/lib/customer-auth-otp";
import {
  consumeChallenge,
  createCustomerAccountSession,
  getAccountByPhone,
  getLatestCustomerAuthChallenge,
  getOrCreateVerifiedAccount,
  incrementChallengeAttempts,
  updateAccountProfile,
} from "@/db/customer-accounts";
import { buildClearedCustomerSessionCookie } from "@/lib/customer-session-core";
import {
  cookieShouldBeSecure,
  setAccountSessionCookies,
} from "@/lib/security/customer-account-session";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

/**
 * Verify phone OTP and create an authenticated account session (login/signup).
 * POST /api/customer/auth/verify
 *
 * Generic/fail-closed responses: do not distinguish invalid vs expired vs
 * non-existent in a way that oracles account state; do not leak OTP details.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAuthVerify");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { phone?: unknown; code?: unknown; name?: unknown; intent?: unknown };

  const phoneE164 = normalizePhoneE164(body.phone);
  const code = String(body.code ?? "").trim();
  const name = normalizeAccountName(body.name);
  const intent = body.intent === "signin" || body.intent === "signup" ? body.intent : undefined;

  if (!phoneE164 || !/^\d{4,8}$/.test(code)) {
    return Response.json({ ok: false, error: "Unable to verify code" }, { status: 400 });
  }

  if (intent === "signup" && !name) {
    return Response.json({ ok: false, error: "Name is required to create an account" }, { status: 400 });
  }

  const secret = getCustomerOtpSecret();
  if (!secret || !isCustomerAuthAvailable()) {
    // Fail closed when auth is unavailable (e.g. production without secret+provider).
    return Response.json({ ok: false, error: "Sign-in is temporarily unavailable" }, { status: 503 });
  }

  const purpose = "login";
  const challenge = await getLatestCustomerAuthChallenge(phoneE164, purpose);
  const state = challengeState(challenge);
  if (state) {
    // Do not reveal the specific reason. Best-effort attempt bump only when a
    // live row exists and a code was presented, to avoid creating side effects
    // for fully missing challenges; but keep response generic.
    return Response.json({ ok: false, error: "Unable to verify code" }, { status: 400 });
  }
  if (!challenge) {
    return Response.json({ ok: false, error: "Unable to verify code" }, { status: 400 });
  }

  const matches = otpMatches(challenge.codeHash, code, challenge.phoneE164, challenge.purpose, secret);
  if (!matches) {
    await incrementChallengeAttempts(challenge.id).catch(() => {});
    return Response.json({ ok: false, error: "Unable to verify code" }, { status: 400 });
  }

  const consumed = await consumeChallenge(challenge.id).catch(() => false);
  if (!consumed) {
    // Lost a race or already consumed; fail closed generically.
    return Response.json({ ok: false, error: "Unable to verify code" }, { status: 400 });
  }

  try {
    let account = await getAccountByPhone(phoneE164);
    const registered = Boolean(account && account.status === "active");

    if (intent === "signup") {
      if (registered) {
        return Response.json(
          { ok: false, code: "ALREADY_REGISTERED", error: "This phone number is already registered. Please sign in." },
          { status: 409 },
        );
      }
      account = await getOrCreateVerifiedAccount(phoneE164);
    } else if (intent === "signin") {
      if (!registered || !account) {
        return Response.json(
          { ok: false, code: "ACCOUNT_NOT_FOUND", error: "No account found for this number. Please create an account." },
          { status: 404 },
        );
      }
    } else {
      account = await getOrCreateVerifiedAccount(phoneE164);
    }

    if (name && !account.name) {
      const updated = await updateAccountProfile(account.id, { name });
      if (updated) account = updated;
    }

    const session = await createCustomerAccountSession(account.id);

    // PII-safe audit: identifiers only (no phone, OTP, tokens, or addresses).
    emitSecurityEvent("customer_auth_verified", {
      outcome: "success",
      accountId: account.id,
      sessionId: session.sessionId,
    });

    const res = Response.json({
      ok: true,
      account: {
        id: account.id,
        phoneE164: account.phoneE164 ?? "",
        name: account.name ?? "",
        avatar: account.avatar ?? "",
      },
      expiresAt: session.expiresAt.toISOString(),
    });
    setAccountSessionCookies(
      res,
      {
        sessionToken: session.sessionToken,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      },
      cookieShouldBeSecure(req),
    );
    // Shared-browser privacy: drop any anonymous session so guest/device order
    // history cannot bleed across account boundaries.
    res.headers.append(
      "Set-Cookie",
      buildClearedCustomerSessionCookie({ secure: cookieShouldBeSecure(req) }),
    );
    return res;
  } catch {
    return Response.json({ ok: false, error: "Unable to sign in" }, { status: 500 });
  }
}
