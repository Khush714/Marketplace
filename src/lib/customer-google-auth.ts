import "server-only";

/**
 * Server wiring for customer Google Sign-In.
 *
 * The free Google OAuth client is the only external dependency: no paid identity
 * product, and the phone OTP path stays exactly as it was. Configuration is read
 * on every call rather than cached at import time so a deployment can set the
 * client credentials after boot without a restart. Every failure is returned as
 * a generic result — codes, tokens and identity claims are never logged.
 */

import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_TOKENINFO_URL,
  normalizeGoogleEmail,
  normalizeGoogleName,
  normalizeGoogleSub,
} from "@/lib/customer-google-core";

const GOOGLE_CALLBACK_PATH = "/api/customer/auth/google/callback";
const TOKEN_TIMEOUT_MS = 8000;

/** Google accepts both forms depending on the endpoint/version. */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** True only when both halves of the OAuth client are actually configured. */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(env("CUSTOMER_GOOGLE_CLIENT_ID") && env("CUSTOMER_GOOGLE_CLIENT_SECRET"));
}

/**
 * Resolve the OAuth client and the exact redirect URI to send to Google.
 *
 * An explicit override wins (it may include a deployment-specific path). Otherwise
 * the callback path is derived from NEXT_PUBLIC_APP_URL or the request's own origin
 * so localhost, preview and production each work without editing config. Both the
 * authorize and token steps call this, which is what keeps the `redirect_uri`
 * values identical — Google rejects the exchange when they differ.
 */
export function getGoogleOAuthConfig(req: Request): GoogleOAuthConfig | null {
  const clientId = env("CUSTOMER_GOOGLE_CLIENT_ID");
  const clientSecret = env("CUSTOMER_GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const configured = env("CUSTOMER_GOOGLE_REDIRECT_URI");
  let redirectUri: string;
  try {
    if (configured) {
      redirectUri = new URL(configured).toString();
    } else {
      const base = env("NEXT_PUBLIC_APP_URL") || new URL(req.url).origin;
      redirectUri = new URL(GOOGLE_CALLBACK_PATH, base).toString();
    }
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

/** Build the consent-screen URL with PKCE and a one-time state parameter. */
export function buildGoogleAuthorizeUrl(
  config: GoogleOAuthConfig,
  opts: { state: string; codeChallenge: string },
): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type GoogleCodeExchange =
  | { ok: true; idToken: string }
  | { ok: false; error: string };

/** Exchange a one-time authorization code for an ID token using the PKCE verifier. */
export async function exchangeGoogleCode(input: {
  code: string;
  verifier: string;
  config: GoogleOAuthConfig;
}): Promise<GoogleCodeExchange> {
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.config.redirectUri,
    code_verifier: input.verifier,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Google sign-in failed" };

    const data: unknown = await res.json();
    const idToken = data && typeof data === "object" ? (data as { id_token?: unknown }).id_token : null;
    if (typeof idToken !== "string" || !idToken) {
      return { ok: false, error: "Google sign-in failed" };
    }
    return { ok: true, idToken };
  } catch {
    return { ok: false, error: "Google sign-in failed" };
  } finally {
    clearTimeout(timer);
  }
}

export type GoogleIdentityResult =
  | { ok: true; sub: string; email: string; name: string }
  | { ok: false; error: string };

/**
 * Introspect the ID token at Google's tokeninfo endpoint and keep only the
 * minimum needed to identify the account.
 *
 * Audience and issuer are checked explicitly: a token for any other OAuth client
 * would otherwise be accepted here. `email_verified` is required because the
 * account is keyed on that email, and expiry is enforced when Google supplies it.
 * No response body, token or claim is ever written to the log.
 */
export async function readGoogleIdentity(
  idToken: string,
  clientId: string,
): Promise<GoogleIdentityResult> {
  const failure: GoogleIdentityResult = { ok: false, error: "Unable to verify Google account" };
  const url = new URL(GOOGLE_TOKENINFO_URL);
  url.searchParams.set("id_token", idToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return failure;

    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return failure;
    const payload = data as Record<string, unknown>;

    if (payload.aud !== clientId) return failure;
    if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.has(payload.iss)) return failure;
    if (payload.email_verified !== true && payload.email_verified !== "true") return failure;

    if (payload.exp !== undefined) {
      const exp = Number(payload.exp);
      if (!Number.isFinite(exp) || exp <= Date.now() / 1000) return failure;
    }

    const sub = normalizeGoogleSub(payload.sub);
    const email = normalizeGoogleEmail(payload.email);
    if (!sub || !email) return failure;

    const name = normalizeGoogleName(payload.name, email.split("@")[0] || "Customer");
    return { ok: true, sub, email, name };
  } catch {
    return failure;
  } finally {
    clearTimeout(timer);
  }
}
