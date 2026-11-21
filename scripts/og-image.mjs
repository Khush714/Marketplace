/* Renders the static social-preview card to public/og.png.
 *
 * This is a build-time asset, not a runtime one: a plain 1200x630 PNG in
 * `public/` is served straight from the edge, so a social crawler never runs
 * the app and never waits on a database. That matters here because the
 * restaurant routes are dynamic — an `opengraph-image.tsx` would have to query
 * Postgres to render, and a crawler that times out gets no card at all.
 *
 * The trade-off is that this card is site-wide and cannot carry per-restaurant
 * copy. The restaurant pages still override `openGraph.images` with their own
 * hero photo, and fall back to this file for Twitter, which takes the first
 * image in the OG block when `twitter.images` is absent.
 *
 * Re-run after changing the brand palette or type:
 *   node scripts/og-image.mjs
 */
import path from "node:path";
import { chromium } from "playwright";

const WIDTH = 1200;
const HEIGHT = 630; // the 1.91:1 ratio X and Facebook both crop to
const OUT = path.join("public", "og.png");

/* Colours are read from src/app/globals.css rather than restated, so the card
 * cannot drift from the site it represents. */
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: #07070a;
    color: #faf7f1;
    font-family: Inter, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 72px 80px;
    position: relative;
  }
  /* Two soft warm glows in the brand accents. Kept low-opacity and blurred so
     they read as depth rather than as shapes; a hard-edged gradient here
     compresses badly and looks like a rendering bug on some scrapers. */
  .glow {
    position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(680px 420px at 88% -8%, rgba(255, 154, 67, 0.30), transparent 62%),
      radial-gradient(760px 520px at 4% 108%, rgba(255, 90, 60, 0.26), transparent 64%);
  }
  .layer { position: relative; }
  .mark {
    font-family: "Bricolage Grotesque", Inter, sans-serif;
    font-size: 132px;
    font-weight: 700;
    line-height: 0.92;
    letter-spacing: -0.035em;
  }
  .mark .dot { color: #ff5a3c; }
  .tag {
    margin-top: 26px;
    font-size: 42px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.015em;
    color: #e8e2d8;
  }
  .rule { width: 132px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, #ff5a3c, #ff9e43); }
  .foot {
    display: flex; align-items: center; gap: 18px;
    font-size: 25px; font-weight: 500; color: #b7ae9f;
  }
  .sep { width: 5px; height: 5px; border-radius: 50%; background: #66605a; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="layer">
    <div class="mark">crave<span class="dot">.</span></div>
    <div class="tag">Food, delivered beautifully</div>
  </div>
  <div class="layer">
    <div class="rule" style="margin-bottom:34px"></div>
    <div class="foot">
      <span>Discover restaurants</span><span class="sep"></span>
      <span>Order in seconds</span><span class="sep"></span>
      <span>Track your rider live</span>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
// Screenshotting before the webfonts settle is how you ship a card rendered in
// the fallback face; `fonts.ready` resolves once the real faces are usable.
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT });
await browser.close();
console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);