/**
 * Tests for the security header set — Phase 11.
 *
 * Run with: npm test
 *
 * Two layers are pinned here:
 *
 *   1. The CSP itself, as a pure string built in `edge-policy-core.ts` —
 *      what it forbids (frame/object/base/form), what it must keep allowing
 *      for the UI to render at all (inline bootstrap scripts, inline style
 *      attributes, partner images from any HTTPS host), and the Razorpay
 *      origins payments depend on.
 *   2. The wiring — the Proxy applies the header set on both the denied and
 *      the passed path, HSTS stays HTTPS-only, and config does not advertise
 *      the framework.
 *
 * The "keeps working" assertions are the important half: a CSP that locks the
 * app down by locking the app out is a regression, not a hardening.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CSP_HEADER, contentSecurityPolicy } from "../src/lib/edge-policy-core";

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** One directive's value from a policy string, or null when it is absent. */
function directive(csp: string, name: string): string | null {
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (trimmed === name || trimmed.startsWith(`${name} `)) {
      return trimmed.slice(name.length).trim();
    }
  }
  return null;
}

const PRODUCTION = contentSecurityPolicy("production");
const DEVELOPMENT = contentSecurityPolicy("development");

/* ------------------------------ fails closed ------------------------------ */

test("the directives that cannot break a page are already strict", () => {
  assert.equal(directive(PRODUCTION, "default-src"), "'self'");
  assert.equal(directive(PRODUCTION, "object-src"), "'none'");
  assert.equal(directive(PRODUCTION, "base-uri"), "'self'");
  assert.equal(directive(PRODUCTION, "form-action"), "'self'");
  assert.equal(directive(PRODUCTION, "frame-ancestors"), "'none'");
});

test("no directive runs loose with a bare wildcard source", () => {
  // `https://*.razorpay.com` (a pinned wildcard subtree) is fine; `*` and an
  // open `https:` in connect-src would let an injected script exfiltrate.
  for (const part of PRODUCTION.split(";")) {
    if (!part.trim()) continue;
    const [name, ...sources] = part.trim().split(/\s+/);
    assert.ok(name, "every directive must have a name");
    for (const source of sources) {
      assert.notEqual(source, "*", `${name} must not admit every origin`);
    }
  }
  const connect = directive(PRODUCTION, "connect-src") ?? "";
  assert.ok(!/(^|\s)https:($|\s)/.test(connect), "connect-src must not open every https origin");
});

test("production serves no unsafe-eval, development keeps it", () => {
  assert.equal(directive(PRODUCTION, "script-src")?.includes("'unsafe-eval'"), false);
  assert.equal(directive(DEVELOPMENT, "script-src")?.includes("'unsafe-eval'"), true);
});

/* ----------------------------- keeps working ------------------------------ */

test("the policy still allows what the app renders", () => {
  // Next bootstraps with inline script chunks — dropping 'unsafe-inline' here
  // without a nonce is the classic way to ship a blank page.
  const script = directive(PRODUCTION, "script-src") ?? "";
  assert.match(script, /'self'/);
  assert.match(script, /'unsafe-inline'/);

  // React style={...} attributes are inline styles.
  const style = directive(PRODUCTION, "style-src") ?? "";
  assert.match(style, /'unsafe-inline'/);

  // External artwork is https-only (the BROWSER-side half; the hosts the
  // optimizer may fetch server-side are the allowlist in lib/image-policy.ts),
  // and next/font serves its woff2 files same-origin.
  const img = directive(PRODUCTION, "img-src") ?? "";
  assert.match(img, /'self'/);
  assert.match(img, /\bhttps:/, "external artwork must keep loading");
  assert.match(img, /data:/);
  assert.match(directive(PRODUCTION, "font-src") ?? "", /'self'/);
});

test("the payment provider keeps every origin it needs", () => {
  // checkout.js itself...
  assert.match(directive(PRODUCTION, "script-src") ?? "", /https:\/\/checkout\.razorpay\.com/);
  // ...the XHRs it makes from our origin...
  const connect = directive(PRODUCTION, "connect-src") ?? "";
  assert.match(connect, /'self'/);
  assert.match(connect, /https:\/\/\*\.razorpay\.com/);
  // ...and the iframe the checkout dialog lives in.
  const frame = directive(PRODUCTION, "frame-src") ?? "";
  assert.match(frame, /https:\/\/api\.razorpay\.com/);
  assert.match(frame, /https:\/\/checkout\.razorpay\.com/);
});

test("the policy is one header, semicolon-terminated and parseable", () => {
  assert.ok(PRODUCTION.endsWith(";"));
  assert.ok(PRODUCTION.split(";").length >= 10, "every directive must survive the round trip");
  assert.equal(directive(PRODUCTION, "no-such-directive"), null);
});

/* ------------------------------- wiring ----------------------------------- */

test("the header helper sets the full set, CSP first", () => {
  const source = readSource("src/lib/security/security-headers.ts");
  assert.match(source, new RegExp(`${CSP_HEADER}|CSP_HEADER`));
  assert.match(source, /contentSecurityPolicy\(process\.env\.NODE_ENV\)/, "the policy is built per runtime");
  const cspAt = source.indexOf("res.headers.set(CSP_HEADER");
  const nosniffAt = source.indexOf('"X-Content-Type-Options"');
  assert.ok(cspAt >= 0 && nosniffAt > cspAt, "the policy must be the first header set");
  assert.match(source, /res\.headers\.set\("X-Content-Type-Options", "nosniff"\)/);
  assert.match(source, /res\.headers\.set\("Referrer-Policy", "strict-origin-when-cross-origin"\)/);
  assert.match(source, /res\.headers\.set\("X-Frame-Options", "DENY"\)/);
  assert.match(source, /res\.headers\.set\("Permissions-Policy", "[^"]*camera=\(\)/);
  assert.match(source, /res\.headers\.set\("X-Permitted-Cross-Domain-Policies", "none"\)/);
  assert.match(source, /res\.headers\.set\("Cross-Origin-Opener-Policy", "same-origin"\)/);
  assert.match(source, /res\.headers\.set\("Cross-Origin-Resource-Policy", "same-origin"\)/);
  assert.doesNotMatch(source, /Strict-Transport-Security/, "HSTS stays HTTPS-gated in the Proxy");
});

test("the proxy applies the header set on every path it answers", () => {
  const source = readSource("src/proxy.ts");
  const applies = source.match(/withSecurityHeaders\(/g) ?? [];
  assert.ok(applies.length >= 2, "both the denial helper and the passed-through response must set them");
  assert.match(
    source,
    /if \(request\.nextUrl\.protocol === "https:"\)\s*\{\s*res\.headers\.set\(HSTS_HEADER, HSTS_VALUE\);/,
    "HSTS must only be advertised over HTTPS",
  );
});

test("config does not advertise the framework", () => {
  assert.match(readSource("next.config.ts"), /poweredByHeader:\s*false/);
});

test("the app defines no inline <script> of its own to worry about later", () => {
  // If a hand-written <script> appears, the nonce migration has to account for
  // it — everything else is emitted by Next, which can carry a nonce.
  const files = [
    "src/app/layout.tsx",
    "src/app/checkout/page.tsx",
    "src/components/payment-stage.tsx",
    "src/components/order-success-screen.tsx",
  ];
  for (const file of files) {
    assert.doesNotMatch(readSource(file), /<script[\s>]/, `${file} must not hand-roll a script tag`);
  }
});
