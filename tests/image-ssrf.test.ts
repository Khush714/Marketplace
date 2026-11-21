/**
 * The image SSRF boundary.
 *
 * `next/image` fetches remote images from the SERVER, so the allowlist in
 * `lib/image-policy.ts` is the difference between "the optimizer fetches our
 * CDN" and "the optimizer fetches anything the writer of an image URL chooses,
 * including our own network". This suite pins all three layers:
 *
 *   1. `validateImageUrl` — the write/read gate every stored URL passes.
 *   2. The private/reserved-host rules, which close the classic SSRF targets.
 *   3. `next.config.ts` — the optimizer's own fetch config must mirror the
 *      allowlist exactly, with no `**` wildcard and local IPs refused.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import nextConfig from "../next.config";
import {
  IMAGE_HOST_PATTERNS,
  isPrivateOrReservedHost,
  matchesImageHost,
  validateImageUrl,
} from "../src/lib/image-policy";
import {
  DEFAULT_DISH_IMAGE,
  DEFAULT_RESTAURANT_HERO,
  DEFAULT_RESTAURANT_IMAGE,
  sanitizeImageUrl,
} from "../src/lib/domain";

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/* ------------------------- config mirrors the policy --------------------- */

test("next.config.ts allows exactly the allowlisted image hosts", () => {
  const patterns = nextConfig.images?.remotePatterns ?? [];
  assert.ok(patterns.length > 0, "remotePatterns must not be empty");

  for (const pattern of patterns) {
    assert.equal(pattern.protocol, "https", "the optimizer must only fetch https");
    const hostname = String(pattern.hostname);
    assert.ok(hostname.length > 0, "a pattern with no hostname matches nothing");
    assert.ok(!hostname.includes("**"), `no wildcard-anywhere host: ${hostname}`);
    assert.notEqual(hostname, "*", "a bare `*` matches every host");
  }

  const fromConfig = patterns.map((p) => `${p.protocol}://${p.hostname}`).sort();
  const fromPolicy = IMAGE_HOST_PATTERNS.map((p) => `${p.protocol}://${p.hostname}`).sort();
  assert.deepEqual(fromConfig, fromPolicy, "config and policy allowlists have drifted");
});

test("the optimizer refuses private or reserved addresses", () => {
  assert.equal(nextConfig.images?.dangerouslyAllowLocalIP, false);
});

test("no source file still declares a catch-all image host", () => {
  for (const file of ["next.config.ts", "src/lib/image-policy.ts"]) {
    assert.doesNotMatch(readSource(file), /hostname:\s*"\*\*"/, `${file} re-opened the fetch surface`);
  }
});

/* --------------------------- accepts what we serve ----------------------- */

test("accepts the hosts the marketplace actually serves imagery from", () => {
  assert.equal(
    validateImageUrl("https://images.pexels.com/photos/1/food.jpeg?auto=compress&w=800"),
    "https://images.pexels.com/photos/1/food.jpeg?auto=compress&w=800",
  );
  const signed = "https://abc.supabase.co/storage/v1/object/public/dishes/x.jpg?token=a.b.c";
  assert.equal(validateImageUrl(signed), signed);
  // Surrounding whitespace is stripped, not stored.
  assert.equal(validateImageUrl("  https://abc.supabase.co/x.jpg  "), "https://abc.supabase.co/x.jpg");
});

test("matchesImageHost is rooted — no suffix-lookalike escapes the wildcard", () => {
  assert.equal(matchesImageHost("abc.supabase.co"), true);
  assert.equal(matchesImageHost("a.b.supabase.co"), true);
  assert.equal(matchesImageHost("images.pexels.com"), true);
  assert.equal(matchesImageHost("supabase.co"), false, "the wildcard needs a label");
  assert.equal(matchesImageHost("evil-supabase.co"), false);
  assert.equal(matchesImageHost("abc.supabase.co.evil.example"), false);
  assert.equal(matchesImageHost("notimages.pexels.com"), false);
  assert.equal(matchesImageHost("images.pexels.com.evil.example"), false);
});

/* ------------------------------- refusals -------------------------------- */

test("refuses any host that is not on the allowlist", () => {
  for (const bad of [
    "https://cdn.pos.example/dish.jpg",
    "https://evil.example/dish.jpg",
    "https://notimages.pexels.com/dish.jpg",
    "https://images.pexels.com.evil.example/dish.jpg",
  ]) {
    assert.equal(validateImageUrl(bad), null, `expected ${bad} to be refused`);
  }
});

test("refuses private, reserved and literal hosts", () => {
  const privateHosts = [
    "localhost",
    "db.internal",
    "router.home.arpa",
    "nas.lan",
    "foo.local",
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.0.192",
    "192.0.2.5",
    "198.18.0.1",
    "198.51.100.5",
    "203.0.113.5",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ];
  for (const host of privateHosts) {
    assert.equal(isPrivateOrReservedHost(host), true, `expected ${host} to be private/reserved`);
    assert.equal(validateImageUrl(`https://${host}/x.jpg`), null, `expected https://${host} to be refused`);
  }
});

test("does not flag public hosts, including near-miss IP ranges", () => {
  const publicHosts = [
    "images.pexels.com",
    "abc.supabase.co",
    "example.com",
    "8.8.8.8",
    "1.1.1.1",
    "100.128.0.1", // just past CGNAT
    "172.32.0.1", // just past RFC 1918
    "192.169.0.1", // just past RFC 1918
    "2606:4700:4700::1111", // Cloudflare, inside 2000::/3
  ];
  for (const host of publicHosts) {
    assert.equal(isPrivateOrReservedHost(host), false, `expected ${host} to be public`);
  }
});

test("refuses anything that is not an https URL", () => {
  for (const bad of [
    "http://images.pexels.com/x.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "ftp://images.pexels.com/x.jpg",
    "/relative/x.jpg",
    "images.pexels.com/x.jpg",
    "",
    "   ",
    null,
    undefined,
    42,
  ]) {
    assert.equal(validateImageUrl(bad), null, `expected ${String(bad)} to be refused`);
  }
});

test("refuses userinfo, non-default ports and fragments that disguise a host", () => {
  assert.equal(validateImageUrl("https://images.pexels.com@evil.example/x.jpg"), null);
  assert.equal(validateImageUrl("https://evil.example@images.pexels.com/x.jpg"), null);
  assert.equal(validateImageUrl("https://images.pexels.com:8443/x.jpg"), null);
  assert.equal(validateImageUrl("https://images.pexels.com/x.jpg#tracker"), null);
});

/* ------------------------ sanitizeImageUrl fallback ---------------------- */

test("sanitizeImageUrl substitutes fallback artwork instead of a fetchable bad URL", () => {
  assert.equal(sanitizeImageUrl("https://evil.example/x.jpg", DEFAULT_RESTAURANT_IMAGE), DEFAULT_RESTAURANT_IMAGE);
  assert.equal(sanitizeImageUrl("javascript:alert(1)", DEFAULT_DISH_IMAGE), DEFAULT_DISH_IMAGE);
  assert.equal(sanitizeImageUrl("http://images.pexels.com/x.jpg", DEFAULT_DISH_IMAGE), DEFAULT_DISH_IMAGE);
  assert.equal(sanitizeImageUrl("", DEFAULT_RESTAURANT_HERO), DEFAULT_RESTAURANT_HERO);
  assert.equal(sanitizeImageUrl(undefined, DEFAULT_RESTAURANT_HERO), DEFAULT_RESTAURANT_HERO);
  assert.equal(
    sanitizeImageUrl("https://abc.supabase.co/x.jpg", DEFAULT_DISH_IMAGE),
    "https://abc.supabase.co/x.jpg",
  );
});

/* ----------------------- the wiring cannot drift ------------------------- */

test("the write and read sites funnel image URLs through sanitizeImageUrl", () => {
  // Source pins: these call sites are server-only (no unit test can execute
  // them here), and silently dropping one would let a raw stored URL reach
  // `next/image` again.
  const queries = readSource("src/db/queries.ts");
  assert.match(queries, /imageUrl: sanitizeImageUrl\(r\.imageUrl, DEFAULT_RESTAURANT_IMAGE\)/);
  assert.match(queries, /heroUrl: sanitizeImageUrl\(r\.heroUrl, DEFAULT_RESTAURANT_HERO\)/);
  assert.match(queries, /imageUrl: sanitizeImageUrl\(m\.imageUrl, DEFAULT_DISH_IMAGE\)/);
  assert.match(queries, /imageUrl: sanitizeImageUrl\(input\.imageUrl/);

  const partner = readSource("src/db/partner-menu.ts");
  assert.match(partner, /imageUrl: sanitizeImageUrl\(m\.imageUrl, DEFAULT_DISH_IMAGE\)/);

  const pos = readSource("src/integrations/pos/menu-image.ts");
  assert.match(pos, /validateImageUrl\(value\)/);
});
