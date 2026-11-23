/**
 * Google Sign-In is additive: the free OAuth client sits beside the existing
 * phone OTP flow and must never replace or weaken it. The route handlers are
 * `server-only`/Next handlers that cannot be imported into a plain node test, so
 * these assertions pin their source the same way the other auth-wiring tests do.
 *
 * What matters here is the part a typecheck cannot see: that the optional config
 * is documented, that PKCE and the tokeninfo audience check are actually wired,
 * that the callback stays guard-free for Google's cross-site redirect, and that
 * no token, email or destination is interpolated into a response or a log line.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const core = source("src/lib/customer-google-core.ts");
const auth = source("src/lib/customer-google-auth.ts");
const status = source("src/app/api/customer/auth/google/status/route.ts");
const start = source("src/app/api/customer/auth/google/start/route.ts");
const callback = source("src/app/api/customer/auth/google/callback/route.ts");
const example = source(".env.example");

test("the optional free Google config is documented next to customer sign-in", () => {
  for (const name of [
    "CUSTOMER_GOOGLE_CLIENT_ID",
    "CUSTOMER_GOOGLE_CLIENT_SECRET",
    "CUSTOMER_GOOGLE_REDIRECT_URI",
  ]) {
    assert.ok(example.includes(name), `.env.example must document ${name}`);
    assert.ok(auth.includes(name), `the auth module must read ${name}`);
  }
  assert.ok(example.includes("Google Sign-In (free)"));
  // Configuration is read per call, never captured once at import time.
  assert.ok(auth.includes('function env(name: string): string'));
  assert.ok(auth.includes("process.env[name]"));
});

test("status reports availability without exposing configuration", () => {
  assert.ok(status.includes('guardRead(req, "customerAuthStart")'));
  assert.ok(status.includes("available: isGoogleAuthConfigured()"));
  assert.ok(status.includes("ok: true"));
  assert.ok(!status.includes("clientId"));
  assert.ok(!status.includes("clientSecret"));
});

test("start guards the read, fails closed, and stores state in an HttpOnly cookie", () => {
  assert.ok(start.includes('guardRead(req, "customerAuthStart")'));
  assert.ok(!start.includes("guardWrite"), "start is a guarded read, not a write");
  assert.ok(start.includes("getGoogleOAuthConfig(req)"));
  assert.ok(start.includes("status: 503"), "unconfigured auth must fail closed");
  assert.ok(start.includes('randomBytes(32).toString("base64url")'));
  assert.ok(start.includes("encodeGoogleOAuthState("));
  assert.ok(start.includes("CUSTOMER_GOOGLE_OAUTH_COOKIE"));
  assert.ok(start.includes("maxAgeSeconds: CUSTOMER_GOOGLE_OAUTH_TTL_SECONDS"));
  assert.ok(start.includes("httpOnly: true"));
  // SameSite/Path come from the shared attribute helper, not a hand-rolled string.
  assert.ok(start.includes('import { cookieAttributes } from "@/lib/restaurant-session-core"'));
  assert.ok(source("src/lib/restaurant-session-core.ts").includes('parts.push("SameSite=Lax"'));
  assert.ok(start.includes("cookieAttributes({"));
  assert.ok(start.includes("cookieShouldBeSecure(req)"));
  assert.ok(start.includes("new Response(null, {"));
  assert.ok(start.includes("status: 302"));
  assert.ok(start.includes("Location: buildGoogleAuthorizeUrl(config, {"));
  assert.ok(start.includes('returnTo: safeGoogleReturnTo(query.get("returnTo"))'));
  assert.ok(start.includes('query.get("mode") === "popup" ? "popup" : "redirect"'));
  assert.ok(start.includes("cleanNonce(query.get(\"nonce\"))"));
  assert.ok(start.includes('if (mode === "popup" && !providedNonce)'));
  assert.ok(start.includes("randomBytes(16).toString(\"base64url\")"), "redirect state needs a bounded nonce");
});

test("PKCE is real: S256 challenge on start and verifier on exchange", () => {
  assert.ok(core.includes('createHash("sha256").update(verifier).digest("base64url")'));
  assert.ok(core.includes('GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"'));
  assert.ok(core.includes('GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"'));
  assert.ok(core.includes('GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"'));
  assert.ok(auth.includes('url.searchParams.set("code_challenge", opts.codeChallenge)'));
  assert.ok(auth.includes('url.searchParams.set("code_challenge_method", "S256")'));
  assert.ok(auth.includes('url.searchParams.set("prompt", "select_account")'));
  assert.ok(auth.includes('url.searchParams.set("scope", "openid email profile")'));
  assert.ok(auth.includes("code_verifier: input.verifier"));
  assert.ok(start.includes("googleCodeChallenge(verifier)"));
  assert.ok(start.includes("codeChallenge: googleCodeChallenge(verifier)"));
  assert.ok(callback.includes("exchangeGoogleCode({ code, verifier: oauth.verifier, config })"));
});

test("tokeninfo is validated for this client, Google issuer, verification and expiry", () => {
  assert.ok(core.includes('CUSTOMER_GOOGLE_OAUTH_COOKIE = "crave_customer_google_oauth"'));
  assert.ok(core.includes("CUSTOMER_GOOGLE_OAUTH_TTL_SECONDS = 600"));
  assert.ok(auth.includes("new URL(GOOGLE_TOKENINFO_URL)"));
  assert.ok(auth.includes('url.searchParams.set("id_token", idToken)'));
  assert.ok(auth.includes("payload.aud !== clientId"));
  assert.ok(auth.includes('GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"])'));
  assert.ok(auth.includes("GOOGLE_ISSUERS.has(payload.iss)"));
  assert.ok(auth.includes('payload.email_verified !== true && payload.email_verified !== "true"'));
  assert.ok(auth.includes("payload.exp !== undefined"));
  assert.ok(auth.includes("exp <= Date.now() / 1000"));
  assert.ok(auth.includes("normalizeGoogleSub(payload.sub)"));
  assert.ok(auth.includes("normalizeGoogleEmail(payload.email)"));
  assert.ok(auth.includes('normalizeGoogleName(payload.name, email.split("@")[0] || "Customer")'));
});

test("state decoding and return paths fail closed", () => {
  assert.ok(core.includes("if (!isBoundedToken(state) || !isBoundedToken(verifier)) return null;"));
  assert.ok(core.includes('if (mode !== "popup" && mode !== "redirect") return null;'));
  assert.ok(core.includes("returnTo: safeGoogleReturnTo(returnTo)"));
  assert.ok(core.includes('if (!value.startsWith("/") || value.startsWith("//")) return fallback;'));
  assert.ok(core.includes('if (value.includes("\\\\")) return fallback;'));
  assert.ok(core.includes("/[\\u0000-\\u001F\\u007F]/"));
  assert.ok(core.includes("if (value.length > 300) return fallback;"));
});

test("callback is guard-free for Google but authenticates the state and mints a session", () => {
  assert.ok(!callback.includes("guardRead"), "Google's cross-site return must not be origin-guarded");
  assert.ok(!callback.includes("guardWrite"));
  assert.ok(callback.includes("decodeGoogleOAuthState(readGoogleOAuthCookie(req))"));
  assert.ok(callback.includes('if (query.has("error"))'));
  assert.ok(callback.includes("state !== oauth.state"));
  assert.ok(callback.includes("readGoogleIdentity(exchanged.idToken, config.clientId)"));
  assert.ok(callback.includes("getAccountByGoogleSub(identity.sub)"));
  assert.ok(callback.includes("getOrCreateGoogleAccount({"));
  assert.ok(callback.includes("createCustomerAccountSession(account.id)"));
  assert.ok(callback.includes("setAccountSessionCookies("));
  assert.ok(callback.includes("buildClearedCustomerSessionCookie({ secure })"));
  assert.ok(callback.includes("clearedGoogleOAuthCookie(secure)"));
  assert.ok(callback.includes('emitSecurityEvent("customer_auth_verified"'));
  assert.ok(callback.includes("accountId: account.id"));
  assert.ok(callback.includes("sessionId: session.sessionId"));
});

test("an email owned by a different Google sub fails generically without linking", () => {
  const collision = callback.slice(
    callback.indexOf("getAccountByGoogleSub(identity.sub)"),
    callback.indexOf("try {\n    const session"),
  );
  assert.ok(collision.includes("getOrCreateGoogleAccount({"));
  assert.ok(collision.includes("} catch {"));
  assert.ok(collision.includes("return errorResponse(oauth, secure, 409);"));
  assert.ok(!/linkAccount|linkGoogle|mergeAccount|mergeByEmail/i.test(callback));
  assert.ok(!callback.includes("error.message"));
  assert.ok(!callback.includes("String(error"));
  assert.ok(!/console\.(log|error|warn)/.test(callback));
});

test("popup HTML posts to the opener origin and falls back to a safe redirect", () => {
  assert.ok(callback.includes("window.opener.postMessage("));
  assert.ok(callback.includes("window.location.origin"));
  assert.ok(callback.includes("JSON.stringify(nonce)"));
  assert.ok(callback.includes("ok: true, nonce: "));
  assert.ok(callback.includes("ok: false"));
  assert.ok(callback.includes("if (window.opener) {"));
  assert.ok(callback.includes("window.close()"));
  assert.ok(callback.includes("window.location.href = destination;"));
  assert.ok(callback.includes('if (oauth.mode === "popup")'), "redirect mode stays a plain redirect");
  assert.ok(
    callback.includes("new Response(null, { status: 302, headers: { Location: destination } })"),
    "redirect must be mutable so session cookies can be attached",
  );
  assert.ok(callback.includes("new URL(oauth.returnTo, new URL(req.url).origin)"));

  const htmlHelpers = callback.slice(
    callback.indexOf("const GENERIC_ERROR_HTML"),
    callback.indexOf("export async function GET"),
  );
  assert.ok(htmlHelpers.includes("function jsLiteral(value: string): string"));
  assert.ok(htmlHelpers.includes("JSON.stringify(value)"));
  assert.ok(htmlHelpers.includes('.replace(/</g, "\\\\u003c")'));
  // Both popup templates interpolate the destination only through the escaper.
  assert.equal((htmlHelpers.match(/jsLiteral\(returnTo\)/g) ?? []).length, 2);
  assert.ok(!htmlHelpers.includes("+ returnTo +"));
  assert.ok(!htmlHelpers.includes("${returnTo}"));
  assert.ok(!htmlHelpers.includes("identity."), "no identity claims in HTML");
});

test("the phone OTP flow is still configured and wired unchanged", () => {
  const otp = source("src/lib/customer-auth-otp.ts");
  const otpStart = source("src/app/api/customer/auth/start/route.ts");
  const otpVerify = source("src/app/api/customer/auth/verify/route.ts");
  for (const name of [
    "CUSTOMER_AUTH_OTP_SECRET",
    "CUSTOMER_AUTH_SMS_WEBHOOK_URL",
    "CUSTOMER_AUTH_SMS_WEBHOOK_AUTH",
    "CUSTOMER_AUTH_SMS_WEBHOOK_BEARER_TOKEN",
    "CUSTOMER_AUTH_SMS_TIMEOUT_MS",
    "CUSTOMER_AUTH_EXPOSE_OTP_ON_SCREEN",
  ]) {
    assert.ok(example.includes(name), `.env.example must still document ${name}`);
    assert.ok(otp.includes(name), `the OTP module must still read ${name}`);
  }
  assert.ok(otpStart.includes('guardWrite(req, "customerAuthStart")'));
  assert.ok(otpStart.includes("prepareOtp("));
  assert.ok(otpStart.includes("deliverCustomerOtp("));
  assert.ok(otpVerify.includes('guardWrite(req, "customerAuthVerify")'));
  assert.ok(otpVerify.includes("consumeChallenge("));
  assert.ok(otpVerify.includes("createCustomerAccountSession(account.id)"));
  assert.ok(otpVerify.includes('emitSecurityEvent("customer_auth_verified"'));
  assert.ok(otpVerify.includes("buildClearedCustomerSessionCookie("));
});
