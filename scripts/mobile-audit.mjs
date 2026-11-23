import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.AUDIT_OUT_DIR ?? join(process.cwd(), ".artifacts", "mobile-audit");
const CHECKOUT_SLUG = process.env.AUDIT_CHECKOUT_SLUG ?? "nori-house";
const CHECKOUT_ITEM_ID = Number(process.env.AUDIT_CHECKOUT_ITEM_ID ?? "18");

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
];

mkdirSync(OUT, { recursive: true });

async function measure(page, route, capture) {
  const response = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!response || !response.ok()) {
    throw new Error(`HTTP ${response?.status() ?? "no response"} for ${route}`);
  }
  if (route === "/checkout") {
    await page
      .getByRole("heading", { name: "Delivery details" })
      .waitFor({ state: "visible", timeout: 10000 });
  }
  await page.waitForTimeout(350);

  const atTop = await page.evaluate(() => {
    const de = document.documentElement;
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const header = document.querySelector("header");
    const sticky = [...document.querySelectorAll("body *")].filter(
      (el) => getComputedStyle(el).position === "sticky",
    );
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    const cta = [...document.querySelectorAll("[data-checkout-cta]")].find(
      (el) => el.getBoundingClientRect().width > 0,
    );
    const ctaHost = cta?.closest(".fixed");
    const ctaInfo = cta
      ? {
          ...box(cta),
          position: getComputedStyle(cta).position,
          host: ctaHost
            ? {
                ...box(ctaHost),
                position: getComputedStyle(ctaHost).position,
                pinned:
                  getComputedStyle(ctaHost).position === "fixed" &&
                  Math.abs(ctaHost.getBoundingClientRect().bottom - window.innerHeight) <= 2,
              }
            : null,
        }
      : null;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      headings: [...document.querySelectorAll("main h2")].slice(0, 24).map((h) => h.textContent?.trim() ?? ""),
      nav: nav ? { ...box(nav), position: getComputedStyle(nav).position } : null,
      header: header ? { ...box(header), position: getComputedStyle(header).position } : null,
      cta: ctaInfo,
      stickyCount: sticky.length,
      restaurantHref: document.querySelector('a[href^="/restaurants/"]')?.getAttribute("href") ?? null,
    };
  });

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(150);
  const afterScroll = await page.evaluate(() => {
    const header = document.querySelector("header");
    const filterBar = document.querySelector('[aria-label="Restaurant filters"]');
    return {
      scrollY: Math.round(window.scrollY),
      headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
      filterBarTop: filterBar ? Math.round(filterBar.getBoundingClientRect().top) : null,
      filterBarPosition: filterBar ? getComputedStyle(filterBar).position : null,
    };
  });

  const restaurantCards = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-restaurant-card]")];
    const heights = cards.slice(0, 8).map((card) => Math.round(card.getBoundingClientRect().height));
    return {
      count: cards.length,
      firstHeight: heights[0] ?? null,
      tallestHeight: heights.length ? Math.max(...heights) : null,
    };
  });

  if (capture) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(OUT, `${capture}-${page.viewportSize().width}.png`),
      fullPage: capture === "home",
    });
    if (capture === "home") {
      await page.screenshot({ path: join(OUT, `home-top-${page.viewportSize().width}.png`) });
    }
    if (capture === "checkout") {
      await page.screenshot({ path: join(OUT, `checkout-top-${page.viewportSize().width}.png`) });
    }
  }

  return {
    route,
    overflowPx: atTop.scrollWidth - atTop.clientWidth,
    headings: atTop.headings,
    nav: atTop.nav,
    header: atTop.header,
    cta: atTop.cta,
    stickyCount: atTop.stickyCount,
    restaurantHref: atTop.restaurantHref,
    afterScroll,
    restaurantCards,
  };
}

const browser = await chromium.launch({ headless: true });
const report = { base: BASE, capturedAt: new Date().toISOString(), viewports: {} };

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await context.addInitScript(
      ({ slug, itemId }) => {
        try {
          localStorage.setItem(
            "crave.cart.v2",
            JSON.stringify({
              restaurantSlug: slug,
              restaurantName: "Nori House",
              items: [
                {
                  menuItemId: itemId,
                  name: "Audit Dish",
                  priceCents: 18000,
                  imageUrl: "/favicon.svg",
                  isVeg: true,
                  quantity: 1,
                  lineKey: String(itemId),
                },
              ],
            }),
          );
          localStorage.setItem(
            "crave.profile.v1",
            JSON.stringify({
              name: "Audit Customer",
              phone: "9876543210",
              addresses: [
                { id: "addr-audit", label: "Home", text: "12 Station Road, Bharuch, Gujarat 392001" },
              ],
              orders: [],
            }),
          );
        } catch {
          /* storage disabled: the audit still reports the empty checkout */
        }
      },
      { slug: CHECKOUT_SLUG, itemId: CHECKOUT_ITEM_ID },
    );
    const page = await context.newPage();
    const routes = ["/", "/restaurants", "/checkout"];
    const results = {};

    for (const route of routes) {
      try {
        results[route] = await measure(
          page,
          route,
          route === "/" ? "home" : route === "/restaurants" ? "restaurants" : route === "/checkout" ? "checkout" : null,
        );
      } catch (error) {
        results[route] = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    const homeHref = results["/"]?.restaurantHref;
    if (homeHref && homeHref !== "/restaurants") {
      try {
        results["/restaurants/[slug]"] = await measure(page, homeHref, null);
      } catch (error) {
        results["/restaurants/[slug]"] = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    report.viewports[vp.name] = results;
    console.log(`captured ${vp.name}`);
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

for (const [name, routes] of Object.entries(report.viewports)) {
  const summary = Object.entries(routes)
    .map(([route, r]) => {
      if (r.error) return `${route}:ERROR(${r.error.slice(0, 60)})`;
      const cards = r.restaurantCards?.count
        ? `/cards:${r.restaurantCards.count}@${r.restaurantCards.tallestHeight}px`
        : "";
      return `${route}:${r.overflowPx}px${cards}`;
    })
    .join(" ");
  console.log(`${name} ${summary}`);
}
console.log(`report: ${join(OUT, "report.json")}`);
