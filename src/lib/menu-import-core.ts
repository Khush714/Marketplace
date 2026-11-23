/**
 * Pure request contract for paired Merchant App full-menu replacement.
 *
 * This file intentionally has no database imports: it validates the JSON the
 * Merchant App sends and produces a stable, normalised payload that the
 * transactional apply service can persist and hash for idempotency.
 */
import { createHash } from "node:crypto";

export type MenuImportIssue = {
  row: number | null;
  column: string;
  code: string;
  message: string;
};

export type MenuImportMode = "replace";

export type NormalisedMenuItem = {
  externalId: string;
  externalKey: string;
  name: string;
  category: string;
  description: string;
  price: number;
  dietary: "veg" | "nonveg" | "unspecified";
  available: boolean;
  stockQuantity: number | null;
  imageUrl: string;
  modifierGroupKeys: string[];
};

export type NormalisedModifierOption = {
  externalId: string;
  externalKey: string;
  name: string;
  priceCents: number;
  isVeg: boolean;
  available: boolean;
};

export type NormalisedModifierGroup = {
  externalId: string;
  externalKey: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: NormalisedModifierOption[];
};

export type NormalisedMenuReplacePayload = {
  importId: string;
  expectedRevision: number;
  mode: MenuImportMode;
  items: NormalisedMenuItem[];
  modifierGroups: NormalisedModifierGroup[];
};

export type MenuImportErrorCode =
  | "validation_failed"
  | "revision_conflict"
  | "idempotency_conflict"
  | "duplicate_key"
  | "unresolved_reference"
  | "payload_too_large"
  | "replace_failed";

/** Every failure the route can map without leaking internals or payload bytes. */
export class MenuImportError extends Error {
  readonly status: number;
  readonly code: MenuImportErrorCode;
  readonly issues: MenuImportIssue[];
  readonly currentRevision?: number;

  private constructor(
    status: number,
    code: MenuImportErrorCode,
    message: string,
    issues: MenuImportIssue[] = [],
    currentRevision?: number,
  ) {
    super(message);
    this.name = "MenuImportError";
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.currentRevision = currentRevision;
  }

  static validation(issues: MenuImportIssue[]): MenuImportError {
    return new MenuImportError(400, "validation_failed", "Menu payload is invalid.", issues);
  }

  static duplicateKey(issues: MenuImportIssue[]): MenuImportError {
    return new MenuImportError(409, "duplicate_key", "Menu external ids must be unique.", issues);
  }

  static unresolvedReference(issues: MenuImportIssue[]): MenuImportError {
    return new MenuImportError(
      422,
      "unresolved_reference",
      "Menu payload references a modifier group that is not present.",
      issues,
    );
  }

  static revisionConflict(currentRevision: number): MenuImportError {
    return new MenuImportError(
      409,
      "revision_conflict",
      "The menu changed after this import was previewed. Preview the CSV again.",
      [],
      currentRevision,
    );
  }

  static idempotencyConflict(): MenuImportError {
    return new MenuImportError(
      409,
      "idempotency_conflict",
      "This import id was already used for a different menu payload.",
    );
  }

  static payloadTooLarge(): MenuImportError {
    return new MenuImportError(413, "payload_too_large", "Menu payload is too large.");
  }

  static replaceFailed(): MenuImportError {
    return new MenuImportError(500, "replace_failed", "Menu replacement failed. It is safe to retry.");
  }
}

export const MENU_IMPORT_LIMITS = {
  maxItems: 5000,
  maxModifierGroups: 500,
  maxOptionsPerGroup: 30,
  maxTotalOptions: 15000,
  maxGroupKeysPerItem: 50,
} as const;

const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(row: number | null, column: string, code: string, message: string): MenuImportIssue {
  return { row, column, code, message };
}

function readString(
  raw: unknown,
  row: number | null,
  column: string,
  issues: MenuImportIssue[],
  min: number,
  max: number,
): string | null {
  if (typeof raw !== "string") {
    issues.push(issue(row, column, "invalid_type", `${column} must be a string.`));
    return null;
  }
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < min || value.length > max) {
    issues.push(issue(row, column, "invalid_length", `${column} must be ${min}-${max} characters.`));
    return null;
  }
  return value;
}

function readOptionalDescription(
  raw: unknown,
  row: number,
  issues: MenuImportIssue[],
): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") {
    issues.push(issue(row, "description", "invalid_type", "description must be a string."));
    return "";
  }
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length > 500) {
    issues.push(issue(row, "description", "invalid_length", "description must be at most 500 characters."));
    return "";
  }
  return value;
}

function readInteger(
  raw: unknown,
  row: number | null,
  column: string,
  issues: MenuImportIssue[],
  min: number,
  max: number,
): number | null {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < min || raw > max) {
    issues.push(issue(row, column, "invalid_number", `${column} must be an integer from ${min} to ${max}.`));
    return null;
  }
  return raw;
}

function readBoolean(
  raw: unknown,
  row: number | null,
  column: string,
  issues: MenuImportIssue[],
): boolean | null {
  if (typeof raw !== "boolean") {
    issues.push(issue(row, column, "invalid_type", `${column} must be a boolean.`));
    return null;
  }
  return raw;
}

function readExternalId(
  raw: unknown,
  row: number,
  column: string,
  issues: MenuImportIssue[],
): { externalId: string; externalKey: string } | null {
  if (typeof raw !== "string") {
    issues.push(issue(row, column, "invalid_type", `${column} must be a string.`));
    return null;
  }
  const externalId = raw.trim();
  if (!EXTERNAL_ID.test(externalId)) {
    issues.push(issue(row, column, "invalid_external_id", `${column} must be 1-64 letters, digits, ., _, : or -.`));
    return null;
  }
  return { externalId, externalKey: externalId.toLowerCase() };
}

function readImageUrl(raw: unknown, row: number, issues: MenuImportIssue[]): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string" || raw.length > 1000) {
    issues.push(issue(row, "imageUrl", "invalid_image_url", "imageUrl must be an HTTPS URL of at most 1000 characters."));
    return "";
  }
  const value = raw.trim();
  if (!value) return "";
  try {
    if (new URL(value).protocol !== "https:") throw new Error();
  } catch {
    issues.push(issue(row, "imageUrl", "invalid_image_url", "imageUrl must be a valid HTTPS URL."));
    return "";
  }
  return value;
}

function readStockQuantity(raw: unknown, row: number, issues: MenuImportIssue[]): number | null {
  if (raw === undefined || raw === null) return null;
  return readInteger(raw, row, "stockQuantity", issues, 0, 100_000);
}

function readModifierGroupKeys(raw: unknown, row: number, issues: MenuImportIssue[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MENU_IMPORT_LIMITS.maxGroupKeysPerItem) {
    issues.push(issue(row, "modifierGroupKeys", "invalid_length", `modifierGroupKeys must be an array of at most ${MENU_IMPORT_LIMITS.maxGroupKeysPerItem} keys.`));
    return [];
  }
  const keys = new Set<string>();
  raw.forEach((value, index) => {
    if (typeof value !== "string" || !EXTERNAL_ID.test(value.trim())) {
      issues.push(issue(row, `modifierGroupKeys[${index}]`, "invalid_external_id", "Modifier group key is invalid."));
      return;
    }
    keys.add(value.trim().toLowerCase());
  });
  return [...keys];
}

function parseItem(value: unknown, index: number, issues: MenuImportIssue[]): NormalisedMenuItem | null {
  const row = index + 1;
  if (!isObject(value)) {
    issues.push(issue(row, "items", "invalid_type", "Each item must be an object."));
    return null;
  }
  const id = readExternalId(value.externalId, row, "externalId", issues);
  const name = readString(value.name, row, "name", issues, 1, 120);
  const category = readString(value.category, row, "category", issues, 1, 80);
  const description = readOptionalDescription(value.description, row, issues);
  const price = readInteger(value.price, row, "price", issues, 100, 10_000_000);
  const available = readBoolean(value.available, row, "available", issues);
  const stockQuantity = readStockQuantity(value.stockQuantity, row, issues);
  const imageUrl = readImageUrl(value.imageUrl, row, issues);
  const modifierGroupKeys = readModifierGroupKeys(value.modifierGroupKeys, row, issues);

  let dietary: "veg" | "nonveg" | "unspecified" | null = null;
  if (value.dietary !== "veg" && value.dietary !== "nonveg" && value.dietary !== "unspecified") {
    issues.push(issue(row, "dietary", "invalid_enum", "dietary must be veg, nonveg or unspecified."));
  } else {
    dietary = value.dietary;
  }

  if (
    !id || name === null || category === null || price === null || available === null ||
    stockQuantity === undefined || dietary === null
  ) return null;

  return {
    externalId: id.externalId,
    externalKey: id.externalKey,
    name,
    category,
    description,
    price,
    dietary,
    available,
    stockQuantity,
    imageUrl,
    modifierGroupKeys,
  };
}

function parseOption(
  value: unknown,
  row: number,
  index: number,
  issues: MenuImportIssue[],
): NormalisedModifierOption | null {
  const columnBase = `options[${index}]`;
  if (!isObject(value)) {
    issues.push(issue(row, columnBase, "invalid_type", "Each option must be an object."));
    return null;
  }
  const id = readExternalId(value.externalId, row, `${columnBase}.externalId`, issues);
  const name = readString(value.name, row, `${columnBase}.name`, issues, 1, 60);
  const priceCents = readInteger(value.priceCents, row, `${columnBase}.priceCents`, issues, 0, 1_000_000);
  const isVeg = readBoolean(value.isVeg, row, `${columnBase}.isVeg`, issues);
  const available = readBoolean(value.available, row, `${columnBase}.available`, issues);
  if (!id || name === null || priceCents === null || isVeg === null || available === null) return null;
  return {
    externalId: id.externalId,
    externalKey: id.externalKey,
    name,
    priceCents,
    isVeg,
    available,
  };
}

function parseGroup(value: unknown, index: number, issues: MenuImportIssue[]): NormalisedModifierGroup | null {
  const row = index + 1;
  if (!isObject(value)) {
    issues.push(issue(row, "modifierGroups", "invalid_type", "Each modifier group must be an object."));
    return null;
  }
  const id = readExternalId(value.externalId, row, "externalId", issues);
  const name = readString(value.name, row, "name", issues, 1, 60);
  const minSelect = readInteger(value.minSelect, row, "minSelect", issues, 0, 20);
  const maxSelect = readInteger(value.maxSelect, row, "maxSelect", issues, 1, 20);
  const isActive = readBoolean(value.isActive, row, "isActive", issues);
  if (maxSelect !== null && minSelect !== null && maxSelect < minSelect) {
    issues.push(issue(row, "maxSelect", "invalid_range", "maxSelect must be at least minSelect."));
  }
  if (!Array.isArray(value.options) || value.options.length < 1 || value.options.length > MENU_IMPORT_LIMITS.maxOptionsPerGroup) {
    issues.push(issue(row, "options", "invalid_length", `options must contain 1-${MENU_IMPORT_LIMITS.maxOptionsPerGroup} entries.`));
  }
  const options = Array.isArray(value.options)
    ? value.options.map((option, optionIndex) => parseOption(option, row, optionIndex, issues)).filter((o): o is NormalisedModifierOption => o !== null)
    : [];
  if (!id || name === null || minSelect === null || maxSelect === null || isActive === null || options.length === 0) return null;
  return {
    externalId: id.externalId,
    externalKey: id.externalKey,
    name,
    minSelect,
    maxSelect,
    isActive,
    options,
  };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Validate and normalise a Marketplace bulk menu replacement request.
 * Throws MenuImportError with the exact contract error codes on failure.
 */
export function parseMenuImportReplace(
  body: unknown,
  idempotencyKey?: string | null,
): NormalisedMenuReplacePayload {
  const issues: MenuImportIssue[] = [];
  if (!isObject(body)) throw MenuImportError.validation([issue(null, "body", "invalid_type", "Request body must be an object.")]);

  const importId = typeof body.importId === "string" ? body.importId.trim() : "";
  if (!UUID.test(importId)) {
    issues.push(issue(null, "importId", "invalid_uuid", "importId must be a UUID."));
  }
  if (idempotencyKey !== undefined && idempotencyKey !== null) {
    if (idempotencyKey.trim() !== importId) {
      issues.push(issue(null, "Idempotency-Key", "mismatch", "Idempotency-Key must equal importId."));
    }
  } else {
    issues.push(issue(null, "Idempotency-Key", "missing", "Idempotency-Key is required."));
  }

  const expectedRevision = readInteger(body.expectedRevision, null, "expectedRevision", issues, 0, 2_147_483_647);
  if (body.mode !== "replace") {
    issues.push(issue(null, "mode", "invalid_enum", "mode must be replace."));
  }
  if (!Array.isArray(body.items) || body.items.length > MENU_IMPORT_LIMITS.maxItems) {
    issues.push(issue(null, "items", "invalid_length", `items must be an array of at most ${MENU_IMPORT_LIMITS.maxItems} entries.`));
  }
  if (!Array.isArray(body.modifierGroups) || body.modifierGroups.length > MENU_IMPORT_LIMITS.maxModifierGroups) {
    issues.push(issue(null, "modifierGroups", "invalid_length", `modifierGroups must be an array of at most ${MENU_IMPORT_LIMITS.maxModifierGroups} entries.`));
  }

  const items = Array.isArray(body.items)
    ? body.items.slice(0, MENU_IMPORT_LIMITS.maxItems).map((value, index) => parseItem(value, index, issues)).filter((i): i is NormalisedMenuItem => i !== null)
    : [];
  const modifierGroups = Array.isArray(body.modifierGroups)
    ? body.modifierGroups.slice(0, MENU_IMPORT_LIMITS.maxModifierGroups).map((value, index) => parseGroup(value, index, issues)).filter((g): g is NormalisedModifierGroup => g !== null)
    : [];

  const totalOptions = modifierGroups.reduce((sum, group) => sum + group.options.length, 0);
  if (totalOptions > MENU_IMPORT_LIMITS.maxTotalOptions) {
    issues.push(issue(null, "options", "invalid_length", `The menu may contain at most ${MENU_IMPORT_LIMITS.maxTotalOptions} modifier options.`));
  }

  const duplicateIssues: MenuImportIssue[] = [];
  for (const key of findDuplicates(items.map((item) => item.externalKey))) {
    duplicateIssues.push(issue(null, "items.externalId", "duplicate_key", `Duplicate item externalId: ${key}.`));
  }
  for (const key of findDuplicates(modifierGroups.map((group) => group.externalKey))) {
    duplicateIssues.push(issue(null, "modifierGroups.externalId", "duplicate_key", `Duplicate modifier group externalId: ${key}.`));
  }
  for (const group of modifierGroups) {
    for (const key of findDuplicates(group.options.map((option) => option.externalKey))) {
      duplicateIssues.push(issue(null, `${group.externalKey}.options.externalId`, "duplicate_key", `Duplicate modifier option externalId: ${key}.`));
    }
  }

  const referenceIssues: MenuImportIssue[] = [];
  const groupKeys = new Set(modifierGroups.map((group) => group.externalKey));
  for (const item of items) {
    for (const key of item.modifierGroupKeys) {
      if (!groupKeys.has(key)) {
        referenceIssues.push(issue(null, "modifierGroupKeys", "unresolved_reference", `Item ${item.externalKey} references missing modifier group ${key}.`));
      }
    }
  }

  if (issues.length > 0) throw MenuImportError.validation(issues);
  if (duplicateIssues.length > 0) throw MenuImportError.duplicateKey(duplicateIssues);
  if (referenceIssues.length > 0) throw MenuImportError.unresolvedReference(referenceIssues);
  if (expectedRevision === null) throw MenuImportError.validation(issues);

  return {
    importId,
    expectedRevision,
    mode: "replace",
    items,
    modifierGroups,
  };
}

/** Stable hash used for idempotent replay without storing or logging raw bytes. */
export function menuImportPayloadHash(payload: NormalisedMenuReplacePayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
