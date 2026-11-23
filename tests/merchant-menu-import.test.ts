import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MenuImportError,
  menuImportPayloadHash,
  parseMenuImportReplace,
} from "../src/lib/menu-import-core";

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    importId: IMPORT_ID,
    expectedRevision: 7,
    mode: "replace",
    items: [{
      externalId: "ITEM-001",
      name: "Masala Dosa",
      category: "Main",
      description: "Crisp dosa",
      price: 18000,
      dietary: "veg",
      available: true,
      stockQuantity: null,
      imageUrl: "",
      modifierGroupKeys: [" Size "],
    }],
    modifierGroups: [{
      externalId: "SIZE",
      name: "Size",
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
      options: [{
        externalId: "M",
        name: "Medium",
        priceCents: 0,
        isVeg: true,
        available: true,
      }],
    }],
    ...overrides,
  };
}

test("a valid menu import is normalised for stable identity", () => {
  const parsed = parseMenuImportReplace(validPayload(), IMPORT_ID);
  assert.equal(parsed.items[0]!.externalKey, "item-001");
  assert.deepEqual(parsed.items[0]!.modifierGroupKeys, ["size"]);
  assert.equal(parsed.modifierGroups[0]!.externalKey, "size");
  assert.equal(parsed.modifierGroups[0]!.options[0]!.externalKey, "m");
});

test("the idempotency key must match the import id", () => {
  assert.throws(
    () => parseMenuImportReplace(validPayload(), "22222222-2222-4222-8222-222222222222"),
    (error: unknown) => error instanceof MenuImportError
      && error.code === "validation_failed"
      && error.issues.some((issue) => issue.column === "Idempotency-Key"),
  );
});

test("duplicate external ids are rejected before any write", () => {
  const payload = validPayload();
  payload.items.push({ ...payload.items[0] });
  assert.throws(
    () => parseMenuImportReplace(payload, IMPORT_ID),
    (error: unknown) => error instanceof MenuImportError && error.code === "duplicate_key",
  );
});

test("unresolved modifier group references are rejected", () => {
  const payload = validPayload();
  payload.items[0].modifierGroupKeys = ["MISSING"];
  assert.throws(
    () => parseMenuImportReplace(payload, IMPORT_ID),
    (error: unknown) => error instanceof MenuImportError && error.code === "unresolved_reference",
  );
});

test("payload hash is stable for identical normalised input", () => {
  const first = parseMenuImportReplace(validPayload(), IMPORT_ID);
  const second = parseMenuImportReplace(validPayload(), IMPORT_ID);
  assert.equal(menuImportPayloadHash(first), menuImportPayloadHash(second));
  assert.match(menuImportPayloadHash(first), /^[0-9a-f]{64}$/);
});

test("the replace route is bearer-scoped, budgeted and caps a large body", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/integration/merchant/menu/replace/route.ts"), "utf8",
  );
  assert.match(source, /guardBudget\(req, "merchantServiceWrite"\)/);
  assert.match(source, /authenticateMerchantApp\(req\)/);
  assert.match(source, /readRawBodyCapped\(req, REPLACE_MAX_BODY_BYTES\)/);
  assert.match(source, /req\.headers\.get\("idempotency-key"\)/);
  assert.match(source, /Cache-Control.*no-store/);
});

test("the menu read route publishes the revision used by paired preview", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/integration/merchant/menu/items/route.ts"), "utf8",
  );
  assert.match(source, /getMerchantMenuRevision\(/);
  assert.match(source, /revision,/);
  assert.match(source, /externalId/);
  assert.match(source, /archived/);
});

test("the migration adds stable identity columns and the import ledger", () => {
  const migration = readFileSync(
    join(process.cwd(), "src/db/migrations/20261127_merchant_menu_import.sql"), "utf8",
  );
  for (const fragment of [
    "ADD COLUMN IF NOT EXISTS external_id text",
    "ADD COLUMN IF NOT EXISTS dietary text",
    "ADD COLUMN IF NOT EXISTS archived boolean",
    "merchant_menu_imports_restaurant_import_idx",
  ]) {
    assert.ok(migration.includes(fragment), `migration must contain ${fragment}`);
  }
});
