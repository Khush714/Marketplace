import {
  exchangeGoogleCode,
  getGoogleOAuthConfig,
  readGoogleIdentity,
} from "@/lib/customer-google-auth";
import {
  CUSTOMER_GOOGLE_OAUTH_COOKIE,
  decodeGoogleOAuthState,
  type GoogleOAuthState,
} from "@/lib/customer-google-core";
import { buildClearedCustomerSessionCookie } from "@/lib/customer-session-core";
import { cookieAttributes } from "@/lib/restaurant-session-core";
import {
  cookieShouldBeSecure,
  setAccountSessionCookies,
} from "@/lib/security/customer-account-session";
import { emitSecurityEvent } from "@/lib/security/security-events";
import {
  createCustomerAccountSession,
  getAccountByGoogleSub,
  getOrCreateGoogleAccount,
} from "@/db/customer-accounts";

export const dynamic = "force-dynamic";

const GENERIC_ERROR_HTML = [
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in error</title></head><body>",
  "<p>Unable to sign in with Google. Please try again.</p>",
  "</body></html>",
].join("\n");

/** Read the short-lived OAuth cookie directly; no Next cookie-store dependency. */
function readGoogleOAuthCookie(req: Request): string {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== CUSTOMER_GOOGLE_OAUTH_COOKIE) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return "";
}

/** Expire the one-time OAuth cookie with the same attributes it was set with. */
function clearedGoogleOAuthCookie(secure: boolean): string {
  return [
    `${CUSTOMER_GOOGLE_OAUTH_COOKIE}=`,
    ...cookieAttributes({ maxAgeSeconds: 0, secure, httpOnly: true }),
  ].join("; ");
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Embed a validated value in an inline script string literal. `<`, `>` and `&`
 * are escaped so no input can close the `<script>` element or open an entity, and
 * the JS line separators are escaped so the literal cannot break out of its line.
 */
function jsLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Popup success: nonce and the already-validated internal return path are the
 * only interpolated values, both as escaped string literals. A popup blocker or
 * a top-level navigation leaves no opener, so the current tab follows returnTo
 * instead of closing into a dead end.
 */
function popupSuccessHtml(nonce: string, returnTo: string): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title></head><body>",
    "<p>Signed in with Google. You can close this window.</p>",
    "<script>",
    "(function () {",
    "  var destination = " + jsLiteral(returnTo) + ";",
    "  if (window.opener) {",
    "    try {",
    "      window.opener.postMessage({ type: \"customer-google-auth\", ok: true, nonce: " +
      JSON.stringify(nonce) +
      " }, window.location.origin);",
    "    } catch (_) {}",
    "    window.close();",
    "  } else {",
    "    window.location.href = destination;",
    "  }",
    "})();",
    "</script></body></html>",
  ].join("\n");
}

/** Popup failure: generic error text, with the same no-opener fallback. */
function popupErrorHtml(nonce: string | undefined, returnTo: string): string {
  const noncePart = nonce ? ", nonce: " + JSON.stringify(nonce) : "";
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in error</title></head><body>",
    "<p>Unable to sign in with Google. Please try again.</p>",
    "<script>",
    "(function () {",
    "  var destination = " + jsLiteral(returnTo) + ";",
    "  if (window.opener) {",
    "    try {",
    "      window.opener.postMessage({ type: \"customer-google-auth\", ok: false" +
      noncePart +
      ", error: \"Unable to sign in with Google\" }, window.location.origin);",
    "    } catch (_) {}",
    "    window.close();",
    "  } else {",
    "    window.location.href = destination;",
    "  }",
    "})();",
    "</script></body></html>",
  ].join("\n");
}

/**
 * Every failure leaves the same shape: a generic page, plus a postMessage only
 * when the decoded state tells us the opener is a popup. Provider errors, DB
 * errors and bad state are indistinguishable to the caller — no token, email or
 * database detail is ever echoed or logged.
 */
function errorResponse(oauth: GoogleOAuthState | null, secure: boolean, status: number): Response {
  const res = htmlResponse(
    oauth?.mode === "popup"
      ? popupErrorHtml(oauth.nonce || undefined, oauth.returnTo)
      : GENERIC_ERROR_HTML,
    status,
  );
  res.headers.append("Set-Cookie", clearedGoogleOAuthCookie(secure));
  return res;
}

/**
 * Complete Google Sign-In: GET /api/customer/auth/google/callback.
 *
 * Deliberately has no origin guard: Google navigates here cross-site, so an
 * `Origin` check would reject every legitimate return. The one-time state and
 * PKCE verifier from the HttpOnly cookie are what authenticate this callback.
 */
export async function GET(req: Request) {
  const secure = cookieShouldBeSecure(req);
  const query = new URL(req.url).searchParams;
  const oauth = decodeGoogleOAuthState(readGoogleOAuthCookie(req));

  if (!oauth) return errorResponse(null, secure, 400);
  // Google reports a denied or failed consent as a query error instead of a code.
  if (query.has("error")) return errorResponse(oauth, secure, 400);

  const code = query.get("code");
  const state = query.get("state");
  if (!code || code.length > 512 || !state || state !== oauth.state) {
    return errorResponse(oauth, secure, 400);
  }

  const config = getGoogleOAuthConfig(req);
  if (!config) return errorResponse(oauth, secure, 503);

  const exchanged = await exchangeGoogleCode({ code, verifier: oauth.verifier, config });
  if (!exchanged.ok) return errorResponse(oauth, secure, 502);

  const identity = await readGoogleIdentity(exchanged.idToken, config.clientId);
  if (!identity.ok) return errorResponse(oauth, secure, 502);

  // A verified Google sub identifies the account. An email already owned by a
  // different sub is a collision, not a merge: getOrCreateGoogleAccount throws
  // on that unique violation and we fail closed rather than linking accounts.
  let account: Awaited<ReturnType<typeof getOrCreateGoogleAccount>> | null = null;
  try {
    account = await getAccountByGoogleSub(identity.sub).catch(() => null);
    if (!account) {
      account = await getOrCreateGoogleAccount({
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
      });
    }
  } catch {
    return errorResponse(oauth, secure, 409);
  }
  if (!account) return errorResponse(oauth, secure, 409);

  try {
    const session = await createCustomerAccountSession(account.id);

    emitSecurityEvent("customer_auth_verified", {
      outcome: "success",
      accountId: account.id,
      sessionId: session.sessionId,
    });

    let res: Response;
    if (oauth.mode === "popup") {
      res = htmlResponse(popupSuccessHtml(oauth.nonce, oauth.returnTo));
    } else {
      // `returnTo` was filtered to an internal path on both ends; resolve it
      // against this origin so the Location header is always absolute.
      const destination = new URL(oauth.returnTo, new URL(req.url).origin).toString();
      // Explicit 302 with mutable headers: the account cookies must ride along,
      // and Response.redirect() produces an immutable-header response here.
      res = new Response(null, { status: 302, headers: { Location: destination } });
    }

    setAccountSessionCookies(
      res,
      {
        sessionToken: session.sessionToken,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      },
      secure,
    );
    // Shared-browser privacy: drop any anonymous session so guest order history
    // cannot bleed across the account boundary (same as the OTP verify route).
    res.headers.append("Set-Cookie", buildClearedCustomerSessionCookie({ secure }));
    res.headers.append("Set-Cookie", clearedGoogleOAuthCookie(secure));
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch {
    return errorResponse(oauth, secure, 500);
  }
}
