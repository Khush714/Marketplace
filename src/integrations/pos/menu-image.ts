/**
 * Pure rules for reading a dish image out of a POS menu payload.
 *
 * No "server-only" here on purpose, matching `order-payload-shape.ts`: this
 * module has no env, no DB and no network, so `db/menu-sync.ts` and the test
 * harness can both import it. Image handling is a CONTRACT with the POS, and a
 * contract that cannot be imported outside Next.js cannot be regression-tested.
 *
 * Two things make this its own module rather than a line in `menu-sync.ts`:
 *
 *  1. `menu_items.image_url` is NOT NULL and is rendered by `next/image`
 *     everywhere (`dish-card`, `dish-sheet`, cart, checkout, orders, search).
 *     The old sync wrote the raw POS value with nothing but a "is it a non-empty
 *     string" check, so a POS could write `javascript:` / `data:` straight into a
 *     column that feeds the image optimizer, and an item with no image at all was
 *     inserted with `imageUrl: ""`, which makes `next/image` throw.
 *  2. Whether a payload carried an image at all is a THIRD state, distinct from
 *     "carried a good image" and "carried a broken one". Collapsing them is what
 *     let a full `menu.sync` re-sync silently keep a stale picture: an update
 *     frame that simply omits the image field must leave the existing one alone,
 *     not blank it.
 */

import { validateImageUrl } from "@/lib/image-policy";

/**
 * Keys the POS has used for a dish image. The first two are the ones the sync
 * has always read; the rest are accepted because the field name is chosen by the
 * POS's own menu editor and varies with its version, and an unrecognised key is
 * indistinguishable from "no image" once it silently stops syncing.
 *
 * `img` is included but is NOT a photo field. On the POS, `menu_items` carries
 * two separate columns: `image_url` is the real dish photo (written only when a
 * manager uploads to the `dish-images` bucket) and `img` is an
 * icon/category-label/emoji slot (`Backend/routes/menu.js:290` defaults it to
 * `🍽️`; `Backend/routes/onboardingSeed.js:57` seeds it to `"Starter"`,
 * `"Curry"`, `"Bread"`…). The POS deliberately sends `image_url: null` alongside
 * `img: "Starter"` — see its own `imageUrlOf()` at
 * `Backend/integrations/marketplace/menu.js:153`, which only accepts `img` when
 * it is already an absolute http(s) URL.
 *
 * That is why the live XYZ menu had `image_url` set to `Starter` and `🍽️`: the
 * old `str(it.image_url ?? it.img)` substituted the icon for the missing photo.
 * Keeping `img` here is safe ONLY because every candidate below is validated —
 * `"Starter"` classifies as `relative` and is rejected, never stored.
 */
export const POS_IMAGE_KEYS: readonly string[] = [
  "image_url",
  "img",
  "imageUrl",
  "image",
  "photo",
  "photo_url",
  "photoUrl",
  "thumbnail",
  "thumbnail_url",
];

/**
 * Longest image URL we will store. `image_url` is unbounded `text`, and the only
 * values that get anywhere near this are legitimate CDN links; a data URI is
 * orders of magnitude larger and is rejected by the length check before the
 * scheme check has to reason about megabytes of base64.
 */
export const MAX_POS_IMAGE_URL_LENGTH = 2048;

export type PosImageRejection =
  /** Present, but not a usable https URL (e.g. `javascript:`, plain `http:`, `ftp:`). */
  | "unsupported-scheme"
  /** A `data:` image URI — inline bytes, not a link. See `readPosImage`. */
  | "data-uri"
  /** A path or protocol-relative reference with no origin. */
  | "relative"
  /**
   * Absolute https, but a host this marketplace will not fetch: not on the
   * image allowlist, or a private/reserved address that would make the
   * optimizer request our own network. See `lib/image-policy.ts`.
   */
  | "host-not-allowed"
  /** Longer than `MAX_POS_IMAGE_URL_LENGTH`. */
  | "too-long"
  /** Present but not a string (a nested object, an array, a number). */
  | "not-a-string"
  /** Present, non-empty, but all whitespace. */
  | "blank";

export type PosImageOutcome =
  /** A canonical, allowlisted https URL — safe to write to `image_url`. */
  | { kind: "url"; url: string; key: string }
  /**
   * The payload carried no image field, or every known key was absent. The
   * caller must LEAVE the stored image as-is: a `menu.sync` or `item.updated`
   * that only changed a price must not wipe the dish photo.
   */
  | { kind: "unchanged" }
  /** A field was present but unusable; the caller must keep what it has. */
  | { kind: "invalid"; reason: PosImageRejection; key: string };

function classify(value: string): PosImageRejection | null {
  if (value.length > MAX_POS_IMAGE_URL_LENGTH) return "too-long";

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (scheme) {
    const protocol = `${scheme[1]!.toLowerCase()}:`;
    if (protocol === "data:") return "data-uri";
    if (protocol === "https:") return null;
    return "unsupported-scheme";
  }
  return "relative";
}

/**
 * Read the dish image from one POS menu payload (a `menu.sync` item, or the body
 * of an `item.created` / `item.updated` frame).
 *
 * Only absolute https URLs from the image allowlist are accepted. A `data:` URI
 * is rejected rather than stored: `menu_items.image_url` feeds `next/image` with
 * the default optimizer, which cannot serve inline base64, and a multi-megabyte
 * string in a `text` column would be copied into every menu query, cart payload
 * and order snapshot that touches the dish. Persisting POS bytes needs a media
 * store, which this codebase does not have; until then the caller falls back to
 * the default dish artwork and the dish stays visible.
 *
 * A POS that serves plain `http` photos from a LAN address is ALSO rejected
 * here: the optimizer only fetches https (remotePatterns are https-only) and
 * would refuse the private address anyway, and mixed content would be blocked
 * on the page regardless. Keeping the contract at https means the stored value
 * is always one the renderer can actually fetch.
 */
export function readPosImage(body: Record<string, unknown> | null | undefined): PosImageOutcome {
  if (!body || typeof body !== "object") return { kind: "unchanged" };

  for (const key of POS_IMAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;

    const raw = body[key];
    // A known key that is null/empty/blank means "the POS has no image here",
    // which is not the same as "this payload says nothing about the image".
    // Both still leave the stored value alone: clearing a photo needs an
    // explicit contract, and guessing one here would delete images on every
    // unrelated re-sync.
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string") return { kind: "invalid", reason: "not-a-string", key };

    const value = raw.trim();
    if (!value) continue;

    const rejection = classify(value);
    if (rejection) return { kind: "invalid", reason: rejection, key };

    // `validateImageUrl` is the same policy the partner editor and the DTO
    // readers apply, so a POS dish and a hand-authored one cannot disagree
    // about which host is renderable — or about which host the optimizer is
    // allowed to fetch server-side.
    const url = validateImageUrl(value);
    if (!url) return { kind: "invalid", reason: "host-not-allowed", key };
    return { kind: "url", url, key };
  }

  return { kind: "unchanged" };
}

/**
 * The image to store for a dish the sync has just INSERTED. Inserts have no
 * previous value to preserve, so an absent or unusable image falls back to the
 * shared default artwork — `""` is not an option, because `next/image` throws on
 * an empty `src` and would take the whole menu page down with it.
 */
export function posImageForInsert(
  outcome: PosImageOutcome,
  fallback: string,
): string {
  return outcome.kind === "url" ? outcome.url : fallback;
}

/**
 * The image to store for a dish the sync is UPDATING, or `null` to leave the
 * stored column untouched.
 *
 * Only `unchanged` preserves what is already stored. `invalid` deliberately
 * OVERWRITES with the fallback, and that distinction is the whole point:
 *
 * - `unchanged` means the payload said nothing about the image, so preserving is
 *   the only correct answer — a price-only re-sync must not blank a dish.
 * - `invalid` means the payload DID address the image field and put something
 *   unusable there. Preserving the previous value would mean a row written
 *   before this validator existed keeps its bad value forever: the live XYZ
 *   menu has `image_url` set to `Starter`, `Curry` and `🍽️` because the old
 *   check was only "is this a non-empty string", and every re-sync since would
 *   have skipped the column and left them exactly as they are.
 *
 * A known-bad stored value is worse than generic artwork, so healing it is the
 * point of the fallback.
 */
export function posImageForUpdate(
  outcome: PosImageOutcome,
  fallback: string,
): string | null {
  if (outcome.kind === "unchanged") return null;
  return outcome.kind === "url" ? outcome.url : fallback;
}