/**
 * Order history discoverability.
 *
 * The history page itself has worked for a long time; what made it invisible
 * was that the only entry point lived in the mobile bottom nav. A desktop
 * customer had no way to reach /orders from the header, the profile or the
 * footer, so a real order looked like it had vanished. These assertions keep
 * all four entry points wired.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("the desktop header exposes an Orders link", () => {
  const header = source("src/components/site-header.tsx");
  assert.match(header, /href="\/orders"/);
  // It must sit inside the desktop-only block, not just the mobile row.
  const desktop = header.slice(header.indexOf('className="hidden items-center gap-2.5 md:flex"'));
  assert.match(desktop, /href="\/orders"/);
});

test("the profile's Orders stat is a link to the history page", () => {
  const profile = source("src/app/profile/page.tsx");
  assert.match(profile, /label="Orders"[^>]*href="\/orders"/);
  assert.match(profile, /href \? \(\s*<Link href=\{href\}/);
});

test("the footer offers Your orders on every page", () => {
  const shell = source("src/components/app-shell.tsx");
  assert.match(shell, /href="\/orders"[^>]*>[\s\S]*?Your orders/);
});

test("the mobile bottom nav still has its Orders tab", () => {
  const nav = source("src/components/bottom-nav.tsx");
  assert.match(nav, /href: "\/orders", label: "Orders"/);
});
