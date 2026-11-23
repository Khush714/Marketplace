import { randomBytes } from "node:crypto";

import { guardRead } from "@/lib/abuse";
import {
  buildGoogleAuthorizeUrl,
  getGoogleOAuthConfig,
  isGoogleAuthConfigured,
} from "@/lib/customer-google-auth";
import {
  CUSTOMER_GOOGLE_OAUTH_COOKIE,
  CUSTOMER_GOOGLE_OAUTH_TTL_SECONDS,
  encodeGoogleOAuthState,
  googleCodeChallenge,
  isBase64UrlToken,
  safeGoogleReturnTo,
  type GoogleOAuthMode,
} from "@/lib/customer-google-core";
import { cookieAttributes } from "@/lib/restaurant-session-core";
import { cookieShouldBeSecure } from "@/lib/security/customer-account-session";

export const dynamic = "force-dynamic";

/** A nonce is only ever echoed back to the opener, never used as a credential. */
function cleanNonce(raw: string | null): string {
  if (!raw || !isBase64UrlToken(raw)) return "";
  return raw.length >= 16 && raw.length <= 256 ? raw : "";
}

/**
 * Begin Google Sign-In: GET /api/customer/auth/google/start.
 *
 * A fixed 32-byte state and PKCE verifier are generated here and stored only in
 * an HttpOnly, SameSite=Lax cookie. The verifier never reaches the browser or the
 * authorize URL, so a page script cannot spend the code Google issues. Popup flows
 * must supply a nonce the opener can match against the postMessage on return.
 */
export function GET(req: Request) {
  const blocked = guardRead(req, "customerAuthStart");
  if (blocked) return blocked;

  const config = getGoogleOAuthConfig(req);
  if (!config || !isGoogleAuthConfigured()) {
    return Response.json(
      { ok: false, error: "Google sign-in is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const query = new URL(req.url).searchParams;
  const mode: GoogleOAuthMode = query.get("mode") === "popup" ? "popup" : "redirect";
  const providedNonce = cleanNonce(query.get("nonce"));
  if (mode === "popup" && !providedNonce) {
    return Response.json(
      { ok: false, error: "Invalid sign-in request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  // A redirect flow has no opener to correlate, but the state blob is decoded
  // strictly on return, so it still needs a bounded (server-minted) nonce.
  const nonce = providedNonce || randomBytes(16).toString("base64url");

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const oauthCookie = [
    `${CUSTOMER_GOOGLE_OAUTH_COOKIE}=${encodeGoogleOAuthState({
      state,
      verifier,
      returnTo: safeGoogleReturnTo(query.get("returnTo")),
      nonce,
      mode,
    })}`,
    ...cookieAttributes({
      maxAgeSeconds: CUSTOMER_GOOGLE_OAUTH_TTL_SECONDS,
      secure: cookieShouldBeSecure(req),
      httpOnly: true,
    }),
  ].join("; ");

  // Build the redirect explicitly: Response.redirect() returns immutable headers
  // in this runtime, and the OAuth state cookie has to ride on the same response.
  const res = new Response(null, {
    status: 302,
    headers: {
      Location: buildGoogleAuthorizeUrl(config, {
        state,
        codeChallenge: googleCodeChallenge(verifier),
      }),
    },
  });
  res.headers.append("Set-Cookie", oauthCookie);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
