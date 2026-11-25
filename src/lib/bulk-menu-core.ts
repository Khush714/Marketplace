/** Pure, bounded parser for the partner's paste/CSV menu editor. */

export const BULK_MENU_MAX_BYTES = 64 * 1024;
export const BULK_MENU_MAX_ROWS = 200;

const FIELD_LIMITS = {
  name: 80,
  category: 60,
  description: 240,
  imageUrl: 2048,
  priceCentsMax: 1_000_000,
  stockMax: 100_000,
  sortMax: 10_000,
} as const;

type FieldKey = Exclude<keyof BulkMenuRow, "line"> | "price";

const HEADERS: Record<string, FieldKey> = {
  id: "id",
  dishid: "id",
  menuitemid: "id",
  itemid: "id",
  category: "category",
  section: "category",
  name: "name",
  dish: "name",
  dishname: "name",
  item: "name",
  itemname: "name",
  description: "description",
  desc: "description",
  price: "price",
  pricers: "price",
  priceinr: "price",
  pricepaise: "price",
  rate: "price",
  amount: "price",
  image: "imageUrl",
  imageurl: "imageUrl",
  photo: "imageUrl",
  isveg: "isVeg",
  veg: "isVeg",
  vegetarian: "isVeg",
  available: "available",
  availability: "available",
  active: "available",
  enabled: "available",
  stock: "stockQuantity",
  stockqty: "stockQuantity",
  stockquantity: "stockQuantity",
  sort: "sort",
  sortorder: "sort",
  order: "sort",
  possynced: "posSynced",
  possync: "posSynced",
};

export interface BulkMenuIssue {
  line: number;
  field?: string;
  message: string;
}

export interface BulkMenuRow {
  line: number;
  id: number | null;
  category?: string;
  name?: string;
  description?: string;
  priceCents?: number;
  imageUrl?: string;
  isVeg?: boolean;
  available?: boolean;
  stockQuantity?: number | null;
  sort?: number;
  posSynced?: boolean;
}

export interface BulkMenuParseResult {
  ok: boolean;
  rows: BulkMenuRow[];
  issues: BulkMenuIssue[];
  error?: string;
}

function normaliseHeader(raw: string): string {
  return raw
    .replace(/₹/g, "rs")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      continue;
    }
    if (char === delimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function detectDelimiter(header: string): string {
  let best = ",";
  let bestCount = 0;
  for (const delimiter of [",", "\t", ";"]) {
    let count = 0;
    for (const char of header) if (char === delimiter) count += 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function readId(raw: string, issues: BulkMenuIssue[], line: number): number | null {
  const value = raw.trim();
  if (!value) {
    issues.push({ line, field: "id", message: "id is required." });
    return null;
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    issues.push({ line, field: "id", message: "id must be a positive whole number." });
    return null;
  }
  return id;
}

function readText(
  raw: string,
  label: string,
  max: number,
  issues: BulkMenuIssue[],
  line: number,
): string | undefined {
  if (!raw) return undefined;
  if (raw === "-") return "";
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length > max) {
    issues.push({ line, field: label, message: `${label} must be ${max} characters or fewer.` });
    return undefined;
  }
  return value;
}

function readPrice(raw: string, isPaise: boolean, issues: BulkMenuIssue[], line: number): number | undefined {
  if (!raw) return undefined;
  if (isPaise) {
    const paise = Number(raw);
    if (!Number.isInteger(paise) || paise < 0 || paise > FIELD_LIMITS.priceCentsMax) {
      issues.push({ line, field: "price", message: `price must be 0–${FIELD_LIMITS.priceCentsMax} paise.` });
      return undefined;
    }
    return paise;
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    issues.push({ line, field: "price", message: "price must be a rupee amount, e.g. 249 or 249.50." });
    return undefined;
  }
  const paise = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > FIELD_LIMITS.priceCentsMax) {
    issues.push({ line, field: "price", message: `price cannot exceed ₹${FIELD_LIMITS.priceCentsMax / 100}.` });
    return undefined;
  }
  return paise;
}

function readFlag(raw: string, label: string, issues: BulkMenuIssue[], line: number): boolean | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (["1", "y", "yes", "true", "veg", "on"].includes(value)) return true;
  if (["0", "n", "no", "false", "nonveg", "off"].includes(value)) return false;
  issues.push({ line, field: label, message: `${label} must be yes or no.` });
  return undefined;
}

function readInteger(
  raw: string,
  label: string,
  max: number,
  issues: BulkMenuIssue[],
  line: number,
): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    issues.push({ line, field: label, message: `${label} must be a whole number from 0 to ${max}.` });
    return undefined;
  }
  return value;
}

/** Blank means unchanged; "-" explicitly clears a field or stops stock tracking. */
export function parseBulkMenuPaste(raw: string): BulkMenuParseResult {
  const issues: BulkMenuIssue[] = [];
  const rows: BulkMenuRow[] = [];
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > BULK_MENU_MAX_BYTES) {
    return { ok: false, rows, issues, error: `Paste must be ${BULK_MENU_MAX_BYTES / 1024} KB or less.` };
  }

  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 2) {
    return { ok: false, rows, issues, error: "Paste a header row and at least one dish." };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitDelimitedLine(lines[0], delimiter).map(normaliseHeader);
  const columns: Array<{ field: FieldKey; header: string; index: number }> = [];
  const seen = new Set<FieldKey>();
  for (let index = 0; index < headerCells.length; index += 1) {
    const header = headerCells[index];
    if (!header) continue;
    const field = HEADERS[header] ?? null;
    if (!field) {
      issues.push({ line: 1, field: header, message: `Unknown column "${header}" was ignored.` });
    } else if (seen.has(field)) {
      issues.push({ line: 1, field: header, message: `Duplicate column "${header}" was ignored.` });
    } else {
      seen.add(field);
      columns.push({ field, header, index });
    }
  }
  if (!seen.has("id")) {
    issues.push({ line: 1, field: "id", message: 'Add an "id" column so each row targets one dish.' });
  }
  if (![...seen].some((f) => f !== "id" && f !== "posSynced")) {
    issues.push({ line: 1, message: "Add at least one column to change." });
  }
  if (issues.length) return { ok: false, rows, issues };

  const dataLines = lines.slice(1).filter((line) => line.trim());
  if (dataLines.length === 0) {
    return { ok: false, rows, issues, error: "Paste at least one dish row." };
  }
  if (dataLines.length > BULK_MENU_MAX_ROWS) {
    issues.push({
      line: BULK_MENU_MAX_ROWS + 2,
      message: `Only the first ${BULK_MENU_MAX_ROWS} rows can be applied.`,
    });
  }

  const ids = new Set<number>();
  dataLines.slice(0, BULK_MENU_MAX_ROWS).forEach((line, index) => {
    const lineNumber = index + 2;
    const cells = splitDelimitedLine(line, delimiter);
    if (cells.length > headerCells.length + 1) {
      issues.push({ line: lineNumber, message: "Too many columns on this row." });
    }
    const row: BulkMenuRow = { line: lineNumber, id: null };
    for (let i = 0; i < columns.length; i += 1) {
      const { field, header, index } = columns[i];
      const value = cells[index] ?? "";
      if (field === "id") {
        row.id = readId(value, issues, lineNumber);
      } else if (field === "price") {
        row.priceCents = readPrice(value, header === "pricepaise", issues, lineNumber);
      } else if (field === "name" || field === "category") {
        const parsed = readText(value, field, FIELD_LIMITS[field], issues, lineNumber);
        if (parsed !== undefined) row[field] = parsed;
      } else if (field === "description" || field === "imageUrl") {
        const parsed = readText(value, field, FIELD_LIMITS[field], issues, lineNumber);
        if (parsed !== undefined) row[field] = parsed;
      } else if (field === "isVeg" || field === "available" || field === "posSynced") {
        const parsed = readFlag(value, field, issues, lineNumber);
        if (parsed !== undefined) row[field] = parsed;
      } else if (field === "stockQuantity") {
        if (value === "-") row.stockQuantity = null;
        else {
          const parsed = readInteger(value, "stock", FIELD_LIMITS.stockMax, issues, lineNumber);
          if (parsed !== undefined) row.stockQuantity = parsed;
        }
      } else {
        const parsed = readInteger(value, "sort", FIELD_LIMITS.sortMax, issues, lineNumber);
        if (parsed !== undefined) row.sort = parsed;
      }
    }
    if (row.id !== null) {
      if (ids.has(row.id)) {
        issues.push({ line: lineNumber, field: "id", message: `Duplicate id ${row.id}.` });
      }
      ids.add(row.id);
    }
    if (row.posSynced === true) {
      issues.push({ line: lineNumber, field: "posSynced", message: "POS-owned dishes cannot be bulk edited." });
    }
    rows.push(row);
  });

  return { ok: issues.length === 0 && rows.length > 0, rows, issues };
}
