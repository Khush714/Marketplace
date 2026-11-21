/**
 * Tests for the stored consent record.
 *
 * Run with: npm test
 *
 * `localStorage` is writable by anyone with devtools, so `parseConsentRecord` is
 * the trust boundary for this feature: it decides whether a browser counts as
 * having answered the banner. The cases below are the ways that can go wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONSENT_CATEGORIES,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  parseConsentRecord,
} from "../src/lib/consent";

function stored(overrides: Record<string, unknown>): string {
  return JSON.stringify({ version: CONSENT_VERSION, decidedAt: "2026-10-05T00:00:00.000Z", ...overrides });
}

test("a well-formed record round-trips both choices", () => {
  assert.deepEqual(parseConsentRecord(stored({ choice: "all" })), {
    choice: "all",
    version: CONSENT_VERSION,
    decidedAt: "2026-10-05T00:00:00.000Z",
  });
  assert.equal(parseConsentRecord(stored({ choice: "essential" }))?.choice, "essential");
});

test("no stored value means no decision", () => {
  assert.equal(parseConsentRecord(null), null);
  assert.equal(parseConsentRecord(""), null);
});

test("a hand-edited choice cannot manufacture consent", () => {
  // The failure that matters: a value that is not one of ours must not be
  // coerced into looking like an acceptance.
  for (const choice of ["ALL", "true", "yes", "", 1, null, undefined, {}, ["all"]]) {
    assert.equal(
      parseConsentRecord(stored({ choice })),
      null,
      `choice ${JSON.stringify(choice)} should not parse`,
    );
  }
});

test("unparseable JSON is a miss, not a crash", () => {
  assert.equal(parseConsentRecord("{not json"), null);
  assert.equal(parseConsentRecord("undefined"), null);
  // JSON.parse happily returns these, so they need the object guard.
  assert.equal(parseConsentRecord('"all"'), null);
  assert.equal(parseConsentRecord("null"), null);
  assert.equal(parseConsentRecord("42"), null);
});

test("a stale version is re-asked rather than assumed", () => {
  // Bumping CONSENT_VERSION must not inherit consent over a wider category list.
  const old = JSON.stringify({ choice: "all", version: CONSENT_VERSION - 1, decidedAt: "2026-10-05T00:00:00.000Z" });
  assert.equal(parseConsentRecord(old), null);
});

test("a missing or bogus decidedAt does not invalidate the choice", () => {
  // The timestamp is evidence, not permission — losing it must not cost the
  // visitor their answer and show them the banner again.
  assert.equal(parseConsentRecord(stored({ choice: "all", decidedAt: undefined }))?.choice, "all");
  assert.equal(parseConsentRecord(stored({ choice: "all", decidedAt: 12345 }))?.choice, "all");
});

test("the storage key is namespaced and versioned", () => {
  assert.equal(CONSENT_STORAGE_KEY, `crave.consent.v${CONSENT_VERSION}`);
});

test("exactly one category can be declined, and essential is not it", () => {
  const optional = CONSENT_CATEGORIES.filter((c) => !c.required);
  assert.equal(optional.length, 1);
  assert.equal(optional[0].id, "personalisation");
  // The provider gates optional writes on this id, so it must exist.
  assert.equal(CONSENT_CATEGORIES.find((c) => c.id === "essential")?.required, true);
});

test("no category claims to be required while listing nothing", () => {
  // A required category with an empty list would render as a bare badge and
  // teach the visitor that "always on" can be empty.
  for (const category of CONSENT_CATEGORIES) {
    assert.ok(category.held.length > 0, `${category.id} lists nothing`);
    for (const item of category.held) {
      assert.equal(typeof item, "string");
      assert.ok(item.trim().length > 0, `${category.id} has a blank entry`);
    }
  }
});

test("category ids are unique, so a key collision cannot hide a category", () => {
  const ids = CONSENT_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
