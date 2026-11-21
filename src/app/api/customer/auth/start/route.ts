import { NextRequest } from "next/server";

import { guardWrite, readJsonBody } from "@/lib/abuse";
import { normalizePhoneE164 } from "@/lib/customer-account-core";
import {
  canExposeDevOtp,
  deliverCustomerOtp,
  getCustomerOtpSecret,
  isCustomerAuthAvailable,
  prepareOtp,
} from "@/lib/customer-auth-otp";
import { createCustomerAuthChallenge, getAccountByPhone } from "@/db/customer-accounts";

export const dynamic = "force-dynamic";

/**
 * Start phone OTP auth (login/signup) — POST /api/customer/auth/start.
 *
 * Generic responses: do not reveal whether an account exists for the phone.
 * Fail-closed when auth is unavailable (e.g. production without secret+provider).
 * OTP codes are never logged; devCode is exposed only in non-production when no
 * real external delivery was performed.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAuthStart");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { phone?: unknown; intent?: unknown };

  const phoneE164 = normalizePhoneE164(body.phone);
  if (!phoneE164) {
    return Response.json({ ok: false, error: "A valid phone number is required" }, { status: 400 });
  }

  const intent = body.intent === "signin" || body.intent === "signup" ? body.intent : undefined;

  const secret = getCustomerOtpSecret();
  if (!secret || !isCustomerAuthAvailable()) {
    // Fail closed: do not mint an unverifiable or undeliverable flow.
    return Response.json({ ok: false, error: "Sign-in is temporarily unavailable" }, { status: 503 });
  }

  // Enforce explicit sign-up/sign-in intent when provided.
  // This reveals phone registration status by design per product requirement;
  // endpoint remains rate-limited and fail-closed.
  if (intent) {
    const existing = await getAccountByPhone(phoneE164).catch(() => null);
    const registered = Boolean(existing && existing.status === "active");
    if (intent === "signup" && registered) {
      return Response.json(
        { ok: false, code: "ALREADY_REGISTERED", error: "This phone number is already registered. Please sign in." },
        { status: 409 },
      );
    }
    if (intent === "signin" && !registered) {
      return Response.json(
        { ok: false, code: "ACCOUNT_NOT_FOUND", error: "No account found for this number. Please create an account." },
        { status: 404 },
      );
    }
  }

  const purpose = "login";
  const prepared = prepareOtp(phoneE164, purpose, secret);

  const delivery = await deliverCustomerOtp({
    phoneE164,
    code: prepared.code,
    purpose,
  });
  if (!delivery.ok) {
    // Delivery required/configured but failed; do not create a challenge the
    // user cannot complete.
    return Response.json({ ok: false, error: "Sign-in is temporarily unavailable" }, { status: 503 });
  }

  try {
    const challenge = await createCustomerAuthChallenge({
      phoneE164,
      purpose,
      codeHash: prepared.codeHash,
    });

    const res: { ok: true; expiresAt: string; devCode?: string } = {
      ok: true,
      expiresAt: challenge.expiresAt.toISOString(),
    };
    if (canExposeDevOtp(delivery.delivered)) {
      res.devCode = prepared.code;
    }
    return Response.json(res);
  } catch {
    return Response.json({ ok: false, error: "Unable to start sign-in" }, { status: 500 });
  }
}
