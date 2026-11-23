/**
 * M5 finding: the global route template keeps a transform applied, so any
 * descendant `position: fixed` surface is bound to that wrapper instead of the
 * viewport. Every full-viewport overlay rendered inside a route must escape it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("checkout, cart, filters and dish sheet portal their fixed overlays to the body", () => {
  const checkout = source("src/app/checkout/page.tsx");
  const cart = source("src/app/cart/page.tsx");
  const filters = source("src/components/browse-filters.tsx");
  const dishSheet = source("src/components/dish-sheet.tsx");

  for (const [name, text] of [
    ["checkout", checkout],
    ["cart", cart],
    ["filters", filters],
    ["dish sheet", dishSheet],
  ] as const) {
    assert.match(text, /createPortal\(/, `${name} must portal its fixed UI`);
    assert.match(text, /document\.body/, `${name} must target the body`);
  }

  assert.match(checkout, /data-checkout-cta=""/);
  assert.match(cart, /backdrop-blur-xl lg:hidden/);
  assert.match(filters, /role="dialog" aria-modal="true" aria-label="Filters" className="fixed inset-0/);
  assert.match(dishSheet, /aria-label=\{`Customize \$\{item\.name\}`\}/);
});

test("the route template still owns the transform that makes the portals necessary", () => {
  const template = source("src/app/template.tsx");
  const css = source("src/app/globals.css");
  assert.match(template, /animate-page-cinema/);
  assert.match(css, /@keyframes page-cinema[\s\S]*transform:\s*translate3d/);
});
