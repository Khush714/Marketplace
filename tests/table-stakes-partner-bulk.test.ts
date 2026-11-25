import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BULK_MENU_MAX_BYTES,
  BULK_MENU_MAX_ROWS,
  parseBulkMenuPaste,
} from "../src/lib/bulk-menu-core";

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

test("the bulk parser reads aliases, rupees and explicit clears without touching other fields", () => {
  const parsed = parseBulkMenuPaste(
    [
      "Dish ID,Item,Price INR,Stock Qty,Availability,Photo",
      "12,Paneer Tikka,249.50,20,yes,-",
      "13,Dosa,120,-,no,/api/media/7",
    ].join("\n"),
  );

  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, [
    {
      line: 2,
      id: 12,
      name: "Paneer Tikka",
      priceCents: 24_950,
      stockQuantity: 20,
      available: true,
      imageUrl: "",
    },
    {
      line: 3,
      id: 13,
      name: "Dosa",
      priceCents: 12_000,
      stockQuantity: null,
      available: false,
      imageUrl: "/api/media/7",
    },
  ]);
});

test("the bulk parser bounds bytes and rows and rejects bad or POS-owned rows", () => {
  const oversized = parseBulkMenuPaste(`id,name\n1,${"x".repeat(BULK_MENU_MAX_BYTES)}\n`);
  assert.equal(oversized.ok, false);
  assert.match(oversized.error ?? "", /64 KB or less/);

  const tooManyRows = parseBulkMenuPaste(
    ["id,name", ...Array.from({ length: BULK_MENU_MAX_ROWS + 1 }, (_, i) => `${i + 1},Dish ${i + 1}`)].join("\n"),
  );
  assert.equal(tooManyRows.ok, false);
  assert.equal(tooManyRows.rows.length, BULK_MENU_MAX_ROWS);
  assert.match(tooManyRows.issues[0]?.message ?? "", /first 200 rows/);

  const posOwned = parseBulkMenuPaste("id,name,posSynced\n1,Dosa,yes");
  assert.equal(posOwned.ok, false);
  assert.ok(posOwned.issues.some((issue) => /POS-owned/.test(issue.message)));

  const missingId = parseBulkMenuPaste("name,price\nDosa,120");
  assert.equal(missingId.ok, false);
  assert.ok(missingId.issues.some((issue) => issue.field === "id"));

  const badValues = parseBulkMenuPaste("id,name,price\n1,Dosa,10000000\n2,Dosa,abc");
  assert.equal(badValues.ok, false);
  assert.ok(badValues.issues.some((issue) => issue.field === "price"));
});

test("bulk writes are authenticated, bounded, atomic and exclude POS-owned rows", () => {
  const route = readSource("src/app/api/partner/menu/bulk/route.ts");
  const helper = readSource("src/db/partner-menu-bulk.ts");
  const menu = readSource("src/app/partner/menu/page.tsx");

  const budgetAt = route.indexOf('guardBudget(req, "partnerBulkMenu")');
  const authAt = route.indexOf("authoriseMenu(req, true)");
  const bodyAt = route.indexOf("readRawBodyCapped(req, BULK_MENU_MAX_BYTES)");
  assert.ok(budgetAt >= 0 && authAt > budgetAt && bodyAt > authAt, "guard order changed");
  assert.doesNotMatch(route, /req\.json\(/, "the route must not parse an unbounded JSON body");
  assert.match(route, /Cache-Control": "no-store"/);

  assert.match(helper, /db\.transaction/);
  assert.match(helper, /current\.posItemId !== null/);
  assert.match(helper, /row\.posSynced === true/);
  assert.match(helper, /isNull\(menuItems\.posItemId\)/);
  assert.match(helper, /eq\(menuItems\.restaurantId, owner\.id\)/);
  const validationAt = helper.indexOf("if (issues.length > 0)");
  const updateAt = helper.indexOf(".update(menuItems)");
  assert.ok(validationAt >= 0 && updateAt > validationAt, "validation must finish before the first UPDATE");

  assert.match(menu, /uploadMenuImage\(file\)/);
  assert.match(menu, /set\("imageUrl", url\)/);
  assert.match(menu, /MAX_MEDIA_BYTES/);
  assert.match(menu, /\/api\/partner\/menu\/bulk/);
});
