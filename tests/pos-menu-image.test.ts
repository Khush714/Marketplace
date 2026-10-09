/**
 * Regression tests for the POS dish-image boundary.
 *
 * Run with: npm test
 *
 * These cover the three ways a synced photo used to fail:
 *  1. The bulk `menu.sync` UPDATE branch never wrote `image_url`, so a corrected
 *     photo on the POS did not reach the Marketplace menu.
 *  2. The POS value reached `menu_items.image_url` with no validation at all, so
 *     `javascript:` / `data:` could be written into a column that feeds
 *     `next/image` on every menu, cart and checkout screen.
 *  3. An item synced with no image was inserted with `imageUrl: ""`, and
 *     `next/image` throws on an empty `src` — taking the menu page with it.
 *
 * The central contract is the THREE-state outcome. "This payload says nothing
 * about the image" must be distinguishable from "this payload carries a broken
 * image", because only the first may leave the stored photo alone.
 *
 * The payload is also untrusted input to a SERVER-SIDE fetcher: the value is
 * stored in a column `next/image` optimizes, and the optimizer fetches it. So
 * a syntactically valid https URL is not enough — it must name an allowlisted
 * host and not a private/reserved address. See `lib/image-policy.ts` and
 * `tests/image-ssrf.test.ts` for that half of the boundary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_POS_IMAGE_URL_LENGTH,
  posImageForInsert,
  posImageForUpdate,
  readPosImage,
  type PosImageOutcome,
} from "../src/integrations/pos/menu-image";

// A dish photo on an allowlisted host — Supabase Storage is where the POS
// uploads its `dish-images` bucket, so this is the real production shape.
const DISH = "https://abc.supabase.co/storage/v1/object/public/dishes/paneer-tikka.jpg";
const FALLBACK = "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg";

function expectUrl(outcome: PosImageOutcome, url: string): void {
  assert.deepEqual(outcome, { kind: "url", url, key: "image_url" });
}

test("reads the dish image the POS sends under image_url", () => {
  expectUrl(readPosImage({ image_url: DISH }), DISH);
});

test("still reads the legacy img key", () => {
  const outcome = readPosImage({ img: DISH });
  assert.equal(outcome.kind, "url");
  assert.equal(outcome.kind === "url" ? outcome.url : null, DISH);
});

test("accepts the alternate image field names a POS version may use", () => {
  for (const key of ["imageUrl", "image", "photo", "photo_url", "photoUrl", "thumbnail", "thumbnail_url"]) {
    const outcome = readPosImage({ [key]: DISH });
    assert.equal(outcome.kind, "url", `expected ${key} to be read`);
  }
});

test("earlier keys win, so a populated image_url is not shadowed by an empty img", () => {
  expectUrl(readPosImage({ image_url: DISH, img: "" }), DISH);
});

test("falls through to a later key when the first is empty", () => {
  const outcome = readPosImage({ image_url: "", photo: DISH });
  assert.equal(outcome.kind, "url");
  assert.equal(outcome.kind === "url" ? outcome.url : null, DISH);
});

test("surrounding whitespace is trimmed", () => {
  expectUrl(readPosImage({ image_url: `  ${DISH}  ` }), DISH);
});

test("a payload with no image key is unchanged, not cleared", () => {
  // The case that kept stale photos alive: a price-only re-sync must not blank
  // the dish, and an `item.updated` that omits the image must not wipe it.
  assert.deepEqual(readPosImage({ pos_item_id: 12, name: "Paneer Tikka", price: 249 }), {
    kind: "unchanged",
  });
  assert.deepEqual(readPosImage({ image_url: null }), { kind: "unchanged" });
  assert.deepEqual(readPosImage({ image_url: "   " }), { kind: "unchanged" });
  assert.deepEqual(readPosImage({}), { kind: "unchanged" });
  assert.deepEqual(readPosImage(null), { kind: "unchanged" });
  assert.deepEqual(readPosImage(undefined), { kind: "unchanged" });
});

test("rejects an inline data: image URI rather than storing megabytes of base64", () => {
  const outcome = readPosImage({
    image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  });
  assert.equal(outcome.kind, "invalid");
  assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "data-uri");
});

test("rejects schemes that must never reach an image src", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://pos.example/dish.jpg",
  ]) {
    const outcome = readPosImage({ image_url: bad });
    assert.equal(outcome.kind, "invalid", `expected ${bad} to be rejected`);
    assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "unsupported-scheme");
  }
});

test("rejects a bare path — there is no origin to fetch it from", () => {
  const outcome = readPosImage({ image_url: "/uploads/paneer.jpg" });
  assert.equal(outcome.kind, "invalid");
  assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "relative");
});

test("rejects an image value that is not a string", () => {
  const outcome = readPosImage({ image_url: { href: DISH } });
  assert.equal(outcome.kind, "invalid");
  assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "not-a-string");
});

test("a non-URL string is rejected as relative — the XYZ failure mode", () => {
  // These are the literal values found in `menu_items.image_url` for restaurant
  // XYZ: the POS put a category name or an emoji in the image field. None is a
  // fetchable origin, so they must never reach `next/image`.
  for (const bad of ["Starter", "Curry", "Dessert", "🍽️", "Pizza"]) {
    const outcome = readPosImage({ image_url: bad });
    assert.equal(outcome.kind, "invalid", `expected ${bad} to be rejected`);
    assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "relative");
  }
});

test("rejects an implausibly long image value before storing it", () => {
  const outcome = readPosImage({ image_url: `https://cdn.example/${"a".repeat(MAX_POS_IMAGE_URL_LENGTH)}` });
  assert.equal(outcome.kind, "invalid");
  assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "too-long");
});

test("rejects plain http — the optimizer only fetches https and the page would block it", () => {
  const outcome = readPosImage({ image_url: "http://192.168.1.40:5000/dish.jpg" });
  assert.equal(outcome.kind, "invalid");
  assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "unsupported-scheme");
});

test("rejects an https image whose host is not on the allowlist", () => {
  // Well-formed https, but `next/image` would fetch this server-side. An
  // arbitrary host makes the marketplace an open proxy, so it is refused even
  // though the scheme is fine.
  for (const bad of [
    "https://cdn.pos.example/dishes/paneer-tikka.jpg",
    "https://images.pexels.com.evil.example/x.jpg",
    "https://notimages.pexels.com/x.jpg",
  ]) {
    const outcome = readPosImage({ image_url: bad });
    assert.equal(outcome.kind, "invalid", `expected ${bad} to be rejected`);
    assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "host-not-allowed");
  }
});

test("rejects private and reserved hosts even over https", () => {
  // The classic SSRF targets: loopback, RFC 1918, and the cloud metadata
  // service. The optimizer refuses these at fetch time too; the contract
  // refuses them so they are never even stored.
  for (const bad of [
    "https://127.0.0.1/dish.jpg",
    "https://10.0.0.8/dish.jpg",
    "https://192.168.1.40:8443/dish.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/dish.jpg",
    "https://localhost/dish.jpg",
  ]) {
    const outcome = readPosImage({ image_url: bad });
    assert.equal(outcome.kind, "invalid", `expected ${bad} to be rejected`);
    assert.equal(outcome.kind === "invalid" ? outcome.reason : null, "host-not-allowed");
  }
});

test("an update keeps the stored photo only when the payload said nothing", () => {
  // The price-only re-sync: nothing in the payload addresses the image, so the
  // stored column is omitted and the dish keeps its photo.
  assert.equal(posImageForUpdate(readPosImage({ price: 249 }), FALLBACK), null);
  assert.equal(posImageForUpdate(readPosImage({ image_url: "" }), FALLBACK), null);
});

test("an update keeps a good photo when the POS sent one", () => {
  assert.equal(posImageForUpdate(readPosImage({ image_url: DISH }), FALLBACK), DISH);
});

test("an update HEALS a stored value the POS cannot render", () => {
  // The live XYZ menu has image_url = 'Starter' / 'Curry' / '🍽️' — the old
  // validator only asked "is this a non-empty string", so a category name or an
  // emoji was stored as an image URL. Preserving those on re-sync would leave
  // them broken forever, so a known-bad value is overwritten with the fallback.
  assert.equal(posImageForUpdate(readPosImage({ image_url: "Starter" }), FALLBACK), FALLBACK);
  assert.equal(posImageForUpdate(readPosImage({ image_url: "🍽️" }), FALLBACK), FALLBACK);
  assert.equal(posImageForUpdate(readPosImage({ img: "Dessert" }), FALLBACK), FALLBACK);
  assert.equal(posImageForUpdate(readPosImage({ image_url: "javascript:alert(1)" }), FALLBACK), FALLBACK);
  assert.equal(posImageForUpdate(readPosImage({ image_url: "/uploads/p.jpg" }), FALLBACK), FALLBACK);
  // A syntactically valid URL on a host the optimizer will not fetch is just
  // as broken as a category name, so it heals the same way.
  assert.equal(
    posImageForUpdate(readPosImage({ image_url: "https://cdn.pos.example/x.jpg" }), FALLBACK),
    FALLBACK,
  );
});

test("an insert falls back to default artwork and never writes an empty src", () => {
  assert.equal(posImageForInsert(readPosImage({ image_url: DISH }), FALLBACK), DISH);
  assert.equal(posImageForInsert(readPosImage({ price: 249 }), FALLBACK), FALLBACK);
  assert.equal(posImageForInsert(readPosImage({ image_url: "javascript:alert(1)" }), FALLBACK), FALLBACK);
  assert.equal(posImageForInsert(readPosImage({ image_url: "" }), FALLBACK), FALLBACK);
});

test("Supabase Storage URLs survive the sync byte-for-byte", () => {
  // Dish images are served out of the same Supabase project as the database.
  // `sanitizeImageUrl` normalises through `new URL(...).toString()`, so the one
  // thing worth pinning is that normalisation is a no-op for these shapes — a
  // mangled `token` or a re-encoded path would break every dish photo without
  // any error, since a 400 from the image host looks identical to a typo.
  const shapes = [
    "https://abc.supabase.co/storage/v1/object/public/dishes/paneer.jpg",
    "https://abc.supabase.co/storage/v1/object/public/dishes/paneer.jpg?token=eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmMifQ.sig-value_here",
    "https://abc.supabase.co/storage/v1/object/sign/dishes/paneer.jpg?token=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3MDAwMDAwMDB9.sig",
    "https://abc.supabase.co/storage/v1/object/public/dishes/tikka%20masala.jpg?width=800",
    "https://abc.supabase.co/storage/v1/render/image/public/dishes/paneer.jpg?width=800&height=800",
  ];

  for (const url of shapes) {
    const outcome = readPosImage({ image_url: url });
    assert.equal(outcome.kind, "url", `expected ${url} to be accepted`);
    assert.equal(outcome.kind === "url" ? outcome.url : null, url, `expected ${url} unchanged`);
  }
});