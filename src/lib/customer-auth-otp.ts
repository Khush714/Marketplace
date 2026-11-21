import "server-only";

import { generateOtpCode, otpVerifier } from "@/lib/customer-account-core";

/**
 * OTP secret resolution and delivery for customer auth.
 *
 * Fail-closed by default: production requires both a configured OTP secret and a
 * configured SMS delivery provider; without them start/verify must refuse rather
 * than mint or accept an unverifiable challenge. In non-production, a dev-only
 * secret fallback and a dev-stub "delivery" path keep local flows working
 * without external SMS.
 *
 * Codes/OTPs are never logged and never included in responses except the explicit
 * non-production devCode convenience value when no real provider delivery occurs.
 */

const DEV_ONLY_FALLBACK_SECRET = "dev-insecure-customer-otp-secret";

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

/**
 * Explicit opt-in to expose OTP codes on-screen (API response) instead of sending
 * SMS. Intended as a temporary/testing mode — enable only when you understand the
 * risk and do not have an SMS provider wired yet.
 */
function onScreenOtpAllowed(): boolean {
  const v = env("CUSTOMER_AUTH_EXPOSE_OTP_ON_SCREEN").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getCustomerOtpSecret(): string | null {
  const configured = env("CUSTOMER_AUTH_OTP_SECRET");
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return DEV_ONLY_FALLBACK_SECRET;
  // Production: allow a dev-only fallback only when on-screen OTP mode is
  // explicitly enabled without a real provider (temporary/testing). Still
  // fail-closed by default.
  if (onScreenOtpAllowed() && !isCustomerSmsConfigured()) return DEV_ONLY_FALLBACK_SECRET;
  return null;
}

/** True when an external SMS provider is configured for OTP delivery. */
export function isCustomerSmsConfigured(): boolean {
  // Generic webhook provider (vendor-agnostic): POST JSON to deliver the OTP.
  // Additional providers can be added here without changing callers.
  return env("CUSTOMER_AUTH_SMS_WEBHOOK_URL").length > 0;
}

/** True when customer auth start/verify can operate in this environment. */
export function isCustomerAuthAvailable(): boolean {
  const secret = getCustomerOtpSecret();
  if (!secret) return false;
  if (process.env.NODE_ENV === "production") {
    return isCustomerSmsConfigured() || onScreenOtpAllowed();
  }
  return true; // non-production: dev-stub delivery is allowed
}

/**
 * Expose the OTP code to the caller only when no real external delivery was
 * performed (dev stub / explicit on-screen mode). Never logged.
 */
export function canExposeDevOtp(delivered: boolean): boolean {
  return !delivered && (process.env.NODE_ENV !== "production" || onScreenOtpAllowed());
}

export interface PreparedOtp {
  code: string;
  codeHash: string;
}

export function prepareOtp(phoneE164: string, purpose: string, secret: string): PreparedOtp {
  const code = generateOtpCode();
  const codeHash = otpVerifier(code, phoneE164, purpose, secret);
  return { code, codeHash };
}

export type DeliverOtpResult = { ok: true; delivered: boolean } | { ok: false; delivered: false };

function deliveryMessage(code: string): string {
  // Generic, no brand secrets/links required; operators can override via gateway.
  return `Your verification code is ${code}. It expires soon.`;
}

/**
 * Deliver an OTP via the configured provider. Never logs the code.
 * - Configured webhook: POSTs JSON { to, code, purpose, message } with optional
 *   bearer auth (CUSTOMER_AUTH_SMS_WEBHOOK_AUTH / ..._BEARER_TOKEN). Operator-
 *   controlled URL (env), not user input.
 * - No provider configured: succeeds only for dev-stub/on-screen flows
 *   (non-production, or production with explicit on-screen OTP opt-in).
 * Fail-closed on misconfiguration or delivery failure.
 */
export async function deliverCustomerOtp(input: {
  phoneE164: string;
  code: string;
  purpose: string;
}): Promise<DeliverOtpResult> {
  const url = env("CUSTOMER_AUTH_SMS_WEBHOOK_URL");
  if (!url) {
    // No external provider: dev-stub delivery (code exposed via devCode path)
    // is allowed only outside production, or when explicitly opted-in on-screen.
    const ok = process.env.NODE_ENV !== "production" || onScreenOtpAllowed();
    return { ok, delivered: false };
  }

  const auth = env("CUSTOMER_AUTH_SMS_WEBHOOK_AUTH") || env("CUSTOMER_AUTH_SMS_WEBHOOK_BEARER_TOKEN");
  const timeoutMs = Math.max(1000, Math.min(15000, Number(env("CUSTOMER_AUTH_SMS_TIMEOUT_MS")) || 8000));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth.startsWith("Bearer ") ? auth : `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify({
        to: input.phoneE164,
        code: input.code,
        purpose: input.purpose,
        message: deliveryMessage(input.code),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, delivered: false };
    return { ok: true, delivered: true };
  } catch {
    return { ok: false, delivered: false };
  } finally {
    clearTimeout(timer);
  }
}

// Backwards-compatible helper for any callers/tests expecting issueOtp (dev path).
export interface IssuedOtp {
  code: string;
  codeHash: string;
  /** Present only in non-production dev-stub mode; never log this value. */
  devCode?: string;
}

export function issueOtp(phoneE164: string, purpose: string, secret: string): IssuedOtp {
  const issued = prepareOtp(phoneE164, purpose, secret);
  const out: IssuedOtp = { code: issued.code, codeHash: issued.codeHash };
  if (canExposeDevOtp(false)) out.devCode = issued.code;
  return out;
}
