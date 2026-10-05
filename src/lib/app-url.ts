/**
 * The site's absolute origin, in one place.
 *
 * Three consumers need it and each of them is broken by a relative URL:
 * `metadataBase` (OG image and canonical tags, which social crawlers cannot
 * resolve), the `Sitemap:` line in robots.txt, and every `<loc>` in
 * sitemap.xml. Reading the env var ad hoc in each file is how these drift
 * apart — a sitemap pointing at one host while canonicals point at another is
 * the classic signal that makes Google ignore a sitemap entirely.
 *
 * `NEXT_PUBLIC_APP_URL` is a URL, not a secret; the name is only historical.
 * The localhost fallback keeps a bare `npm run dev` working, and it is the
 * honest default: an unset public URL is a misconfiguration, not something to
 * paper over with a plausible hostname.
 */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = configured && configured.length > 0 ? configured : "http://localhost:3000";
  // Trailing slashes are the quiet way to break every absolute URL this feeds.
  // `new URL("https://host/")` renders as "https://host/" for metadataBase, but
  // the sitemap concatenates strings, so "https://host/" + "/sitemap.xml" is
  // "https://host//sitemap.xml" — a different URL to Google, and one that makes
  // the whole sitemap look malformed.
  return origin.replace(/\/+$/, "");
}