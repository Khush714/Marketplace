/**
 * Pure validation for uploaded images. The browser sends a bounded base64 JSON
 * body; bytes are checked against magic numbers before a tenant-scoped media row
 * is written. Nothing here fetches a URL or touches storage.
 */

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
export const MEDIA_KINDS = ["menu", "review"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const ALLOWED_TYPES: Record<string, readonly string[]> = {
  menu: ["image/jpeg", "image/png", "image/webp"],
  review: ["image/jpeg", "image/png", "image/webp"],
};

export type ParsedMedia =
  | { ok: true; kind: MediaKind; contentType: string; bytes: Uint8Array }
  | { ok: false; error: string };

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function magicMatches(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    );
  }
  if (contentType === "image/webp") {
    return (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    );
  }
  return false;
}

export function parseMediaUpload(body: unknown): ParsedMedia {
  const rec = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const kind = rec.kind;
  if (typeof kind !== "string" || !(MEDIA_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Unsupported upload type." };
  }
  const contentType = typeof rec.contentType === "string" ? rec.contentType.toLowerCase() : "";
  if (!(ALLOWED_TYPES[kind] as readonly string[]).includes(contentType)) {
    return { ok: false, error: "Upload a JPEG, PNG or WebP image." };
  }
  const encoded = rec.dataBase64;
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length % 4 !== 0) {
    return { ok: false, error: "Invalid image data." };
  }
  // base64 expands by 4/3; bound before allocating the decoded buffer.
  if (Math.floor((encoded.length * 3) / 4) > MAX_MEDIA_BYTES) {
    return { ok: false, error: `Images must be under ${MAX_MEDIA_BYTES / 1024 / 1024} MB.` };
  }
  const bytes = decodeBase64(encoded);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
    return { ok: false, error: "Invalid image data." };
  }
  if (!magicMatches(bytes, contentType)) {
    return { ok: false, error: "The file does not match its image type." };
  }
  return { ok: true, kind: kind as MediaKind, contentType, bytes };
}

export const MAX_REVIEW_PHOTOS = 3;

/** Review photo handles are bounded positive ids; ownership is checked in the DB. */
export function parsePhotoIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const entry of raw.slice(0, MAX_REVIEW_PHOTOS)) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0 || entry > 2_147_483_647) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/** Local media URLs are same-origin IDs, never an attacker-chosen fetch target. */
export function isLocalMediaUrl(raw: unknown): boolean {
  return typeof raw === "string" && /^\/api\/media\/[1-9]\d{0,15}$/.test(raw);
}
