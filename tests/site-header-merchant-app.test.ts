/**
 * The Merchant App is a partner tool, not a primary customer navigation item.
 * It stays reachable from "Partner with us", but must not be promoted in the
 * site header next to Orders and Profile.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("site header does not expose the Merchant App", () => {
  const header = source("src/components/site-header.tsx");

  assert.doesNotMatch(header, /\/partner\/merchant-app/);
  assert.doesNotMatch(header, /Merchant App/i);
  assert.doesNotMatch(header, /\bStore\b/);
});

test("Partner with us remains reachable from the footer", () => {
  const shell = source("src/components/app-shell.tsx");

  assert.match(shell, /href="\/partner"/);
  assert.match(shell, /Partner with us/);
});

test("Merchant App remains reachable from the Partner page", () => {
  const partner = source("src/app/partner/page.tsx");

  assert.match(partner, /href="\/partner\/merchant-app"/);
  assert.match(partner, /Merchant App/);
});
