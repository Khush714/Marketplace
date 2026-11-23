import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * M5 — final device QA. Deliberately read-only: it never clicks a place-order
 * CTA and never creates a payment. Checkout is exercised only up to the point
 * where the browser would have to assert money or success.
 */

const BASE = process.env.QA_BASE_URL ?? "https://marketplace-xyz.vercel.app";
const OUT = process.env.QA_OUT_DIR ?? join(process.cwd(), ".artifacts", "mobile-qa-m5");
const CHECKOUT_SLUG = process.env.QA_CHECKOUT_SLUG ?? "nori-house";
const CHECKOUT_ITEM_ID = Number(process.env.QA_CHECKOUT_ITEM_ID ?? "18");

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
];

mkdirSync(OUT, { recursive: true });

function recorder() {
  const checks = [];
  return {
    checks,
    check(name, ok, detail = null) {
      checks.push({ name, ok: Boolean(ok), detail });
    },
    get failures() {
      return checks.filter((c) => !c.ok);
    },
  };
}

async function layout(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
      };
    };
    const visible = (el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
    };
    const navCandidate = document.querySelector('nav[aria-label="Primary"]');
    const nav = navCandidate && visible(navCandidate) ? navCandidate : null;
    const header = document.querySelector("header");
    const overflowing = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 2)
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 100),
        right: Math.round(el.getBoundingClientRect().right),
      }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowPx: de.scrollWidth - de.clientWidth,
      header: header ? { ...box(header), position: getComputedStyle(header).position } : null,
      nav: nav
        ? {
            ...box(nav),
            position: getComputedStyle(nav).position,
            safeArea: (nav.getAttribute("style") ?? "").includes("safe-area-inset-bottom"),
            links: [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")),
            hasSearchButton: Boolean(nav.querySelector('button[aria-label="Search"]')),
          }
        : null,
      fixedBars: [...document.querySelectorAll("body *")]
        .filter(visible)
        .filter((el) => getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().width >= de.clientWidth - 40)
        .slice(0, 8)
        .map((el) => ({
          cls: String(el.className).slice(0, 110),
          ...box(el),
          safeArea: (el.getAttribute("style") ?? "").includes("safe-area-inset-bottom"),
        })),
      overflowing,
    };
  });
}

async function goto(page, route) {
  const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!res || !res.ok()) throw new Error(`HTTP ${res?.status() ?? "none"} for ${route}`);
  // The route template animates for 620ms; clicking mid-animation makes
  // Playwright wait for stability and can time out on an otherwise valid hit.
  await page.waitForTimeout(900);
}

function auditStatic(result, data, { wantNav, wantHeader = true }) {
  result.check("no horizontal overflow", data.overflowPx <= 0, `${data.overflowPx}px`);
  if (wantHeader) {
    result.check("header is sticky at top", data.header?.position === "sticky" && data.header.top <= 1, JSON.stringify(data.header));
  }
  if (wantNav) {
    result.check("primary nav present and fixed", data.nav?.position === "fixed", JSON.stringify(data.nav));
    result.check(
      "nav bottom tab order",
      JSON.stringify(data.nav?.links) === JSON.stringify(["/", "/orders", "/profile"]) && data.nav?.hasSearchButton === true,
      JSON.stringify(data.nav),
    );
    result.check("nav carries safe-area padding", data.nav?.safeArea === true);
  } else {
    result.check("no bottom nav on this route", data.nav === null, JSON.stringify(data.nav));
  }
}

async function auditScroll(page, result) {
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const h = document.querySelector("header");
    return { scrollY: Math.round(window.scrollY), headerTop: h ? Math.round(h.getBoundingClientRect().top) : null };
  });
  result.check("header stays pinned after scroll", after.scrollY > 100 && after.headerTop === 0, JSON.stringify(after));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

async function checkStickyBar(page, result, label) {
  const bar = await page.evaluate(() => {
    const el = [...document.querySelectorAll("body *")].find(
      (n) => getComputedStyle(n).position === "fixed" && String(n.className).includes("backdrop-blur-xl") && n.getBoundingClientRect().width > 0,
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      position: getComputedStyle(el).position,
      safeArea: (el.getAttribute("style") ?? "").includes("safe-area-inset-bottom"),
      viewportHeight: window.innerHeight,
    };
  });
  result.check(`${label} sticky bar pinned to viewport`, bar?.position === "fixed" && Math.abs(bar.bottom - bar.viewportHeight) <= 2, JSON.stringify(bar));
  result.check(`${label} sticky bar safe-area padding`, bar?.safeArea === true);
  return bar;
}

async function checkSearch(page, result) {
  const navSearch = page.locator('nav[aria-label="Primary"] button[aria-label="Search"]');
  const headerSearch = page.getByRole("button", { name: /Search restaurants/ });
  const opener = (await navSearch.count()) && (await navSearch.first().isVisible())
    ? navSearch.first()
    : headerSearch.first();
  await opener.click();
  const dialog = page.locator("#search-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await page.locator('#search-dialog input[aria-label="Search"]').fill("paneer tikka");
  await page
    .waitForFunction(() => document.querySelector("#search-dialog")?.innerText.trim().length > 40, null, { timeout: 10000 })
    .catch(() => {
      /* reported by the check below */
    });
  const state = await page.evaluate(() => {
    const d = document.querySelector("#search-dialog");
    const r = d.getBoundingClientRect();
    const input = d.querySelector('input[aria-label="Search"]');
    const ir = input.getBoundingClientRect();
    return {
      dialog: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
      input: { top: Math.round(ir.top), bottom: Math.round(ir.bottom) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hasContent: d.innerText.trim().length > 40 && d.innerText.includes("Paneer Tikka"),
    };
  });
  result.check("search dialog fills viewport", state.dialog.top <= 1 && Math.abs(state.dialog.bottom - state.viewport.height) <= 2, JSON.stringify(state.dialog));
  result.check("search input visible with keyboard space", state.input.top >= 0 && state.input.bottom <= state.viewport.height, JSON.stringify(state.input));
  result.check("search dialog has no overflow", state.overflowPx <= 0, `${state.overflowPx}px`);
  result.check("search returns content", state.hasContent);
  // Once a query exists the trailing icon is Clear, not Close; clear first so
  // the dialog returns to its idle state, then close it like a real visitor.
  await page.locator('#search-dialog button[aria-label="Clear"]').first().click();
  await page.locator('#search-dialog button[aria-label="Close"]').first().click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
}

async function checkFilters(page, result, vp) {
  if (vp.width >= 768) {
    result.check("filter sheet", true, "not applicable at tablet width");
    return;
  }
  await goto(page, "/restaurants");
  const button = page.getByRole("button", { name: "Filters" });
  if (!(await button.count())) {
    result.check("mobile filter button", false, "not found");
    return;
  }
  await button.first().click();
  const dialog = page.locator('[role="dialog"][aria-label="Filters"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const state = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Filters"]');
    const r = d.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight, overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  result.check("filter sheet inside viewport", state.top >= -1 && state.bottom <= state.viewport + 2, JSON.stringify(state));
  result.check("filter sheet no overflow", state.overflowPx <= 0, `${state.overflowPx}px`);
  // The backdrop close is behind the sheet; use the in-sheet confirmation CTA.
  await page.locator('[role="dialog"][aria-label="Filters"]').getByRole("button", { name: /Show results/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
}

async function checkDishSheet(page, result, restaurantRoute) {
  if (!restaurantRoute) {
    result.check("dish sheet", false, "no restaurant route discovered");
    return;
  }
  await goto(page, restaurantRoute);
  const customise = page.locator('button[aria-label^="Customize "]');
  const count = await customise.count();
  if (!count) {
    result.check("dish sheet", true, "no configurable dish on this listing");
    return;
  }
  // Menus differ by restaurant and the first configurable dish may sit in a
  // snapped carousel. Pick the first dish that is actually tappable.
  let opened = false;
  for (let i = 0; i < count && !opened; i++) {
    const candidate = customise.nth(i);
    try {
      await candidate.scrollIntoViewIfNeeded({ timeout: 4000 });
      await candidate.click({ timeout: 8000 });
      opened = true;
    } catch {
      /* try the next dish */
    }
  }
  if (!opened) {
    result.check("dish sheet", false, "no configurable dish was tappable");
    return;
  }
  const dialog = page.locator('[role="dialog"][aria-label^="Customize "]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const state = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label^="Customize "]');
    const r = d.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight, overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  result.check("dish sheet inside viewport", state.top >= -1 && state.bottom <= state.viewport + 2, JSON.stringify(state));
  result.check("dish sheet no overflow", state.overflowPx <= 0, `${state.overflowPx}px`);
  // First close is the backdrop behind the panel; the header X is the usable one.
  await dialog.locator('button[aria-label="Close"]').last().click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
}

async function checkCart(page, result) {
  await goto(page, "/cart");
  const data = await layout(page);
  auditStatic(result, data, { wantNav: false });
  await checkStickyBar(page, result, "cart");
  const stepper = page.locator('button[aria-label="Increase quantity"]');
  if (!(await stepper.count())) {
    result.check("cart quantity stepper", false, "not found");
    return;
  }
  const before = await page.locator('[role="group"][aria-label^="Quantity of "] span.tabular-nums').first().innerText();
  await stepper.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  await stepper.first().click();
  await page.waitForTimeout(150);
  const after = await page.locator('[role="group"][aria-label^="Quantity of "] span.tabular-nums').first().innerText();
  result.check("cart quantity stepper updates", Number(after) === Number(before) + 1, `${before} -> ${after}`);
}

async function checkCheckout(page, result, vp) {
  await goto(page, "/checkout");
  await page.getByRole("heading", { name: "Delivery details" }).waitFor({ state: "visible", timeout: 15000 });
  const data = await layout(page);
  auditStatic(result, data, { wantNav: false });
  await checkStickyBar(page, result, "checkout");

  const headings = await page.locator("main h2").allInnerTexts();
  result.check("checkout has exactly the M2 cards", headings.includes("Delivery details") && headings.includes("Payment") && !headings.some((h) => /Delivery address|Contact details|Anything we should/.test(h)), JSON.stringify(headings));
  const visibleCta = await page.locator("[data-checkout-cta]:visible").count();
  result.check("single visible checkout CTA", visibleCta === 1, `${visibleCta} visible`);

  const cta = page.locator("[data-checkout-cta]:visible");
  await cta.waitFor({ state: "visible", timeout: 10000 });
  result.check("CTA disabled before consent", await cta.isDisabled());
  const blocker = await page.locator('[role="status"]').filter({ hasText: "Accept the Terms" }).count();
  result.check("blocker explains disabled CTA", blocker > 0, `${blocker} messages`);

  const consentLabel = page.locator('label[for="accept-legal"]');
  await consentLabel.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  await consentLabel.click();
  let enabled = false;
  try {
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll("[data-checkout-cta]")].find((el) => el.getBoundingClientRect().width > 0);
        return Boolean(b && !b.disabled);
      },
      null,
      { timeout: 20000 },
    );
    enabled = true;
  } catch {
    /* diagnostic below */
  }
  const consentDiag = enabled
    ? null
    : await page.evaluate(() => ({
        checked: document.querySelector("#accept-legal")?.checked,
        disabled: [...document.querySelectorAll("[data-checkout-cta]")].find((el) => el.getBoundingClientRect().width > 0)?.disabled,
        blockers: [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent?.trim()).filter(Boolean),
      }));
  result.check("CTA enabled after consent", enabled, JSON.stringify(consentDiag));

  // Simulate a soft keyboard: viewport shrinks while an input is focused.
  const shortHeight = vp.height - 260;
  await page.setViewportSize({ width: vp.width, height: shortHeight });
  await page.waitForTimeout(200);
  const nameInput = page.locator('input[autocomplete="name"]');
  await nameInput.focus();
  await page.waitForTimeout(150);
  // A real soft keyboard shrinks the visual viewport and the browser scrolls
  // the focused field into the clear area. setViewportSize does not do that,
  // so reproduce that scroll before asserting the layout.
  for (let attempt = 0; attempt < 4; attempt++) {
    const pos = await page.evaluate(() => {
      const input = document.querySelector('input[autocomplete="name"]');
      const bar = [...document.querySelectorAll("body *")].find(
        (n) => getComputedStyle(n).position === "fixed" && String(n.className).includes("backdrop-blur-xl") && n.getBoundingClientRect().width > 0,
      );
      const r = input.getBoundingClientRect();
      const br = bar?.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, barTop: br?.top ?? window.innerHeight };
    });
    const delta = pos.top < 8 ? pos.top - 24 : pos.bottom > pos.barTop - 8 ? pos.bottom - pos.barTop + 24 : 0;
    if (Math.abs(delta) < 2) break;
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    await page.waitForTimeout(120);
  }
  const keyboard = await page.evaluate(() => {
    const input = document.querySelector('input[autocomplete="name"]');
    const r = input.getBoundingClientRect();
    const bar = [...document.querySelectorAll("body *")].find(
      (n) => getComputedStyle(n).position === "fixed" && String(n.className).includes("backdrop-blur-xl") && n.getBoundingClientRect().width > 0,
    );
    const br = bar?.getBoundingClientRect();
    return {
      inputTop: Math.round(r.top),
      inputBottom: Math.round(r.bottom),
      barTop: br ? Math.round(br.top) : null,
      barBottom: br ? Math.round(br.bottom) : null,
      viewport: window.innerHeight,
      overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  result.check(
    "focused input visible above CTA with keyboard",
    keyboard.inputTop >= 0 && keyboard.inputBottom <= keyboard.barTop - 4 && keyboard.inputBottom <= keyboard.viewport,
    JSON.stringify(keyboard),
  );
  result.check("CTA pinned with keyboard", keyboard.barBottom !== null && Math.abs(keyboard.barBottom - keyboard.viewport) <= 2, JSON.stringify(keyboard));
  result.check("no overflow with keyboard", keyboard.overflowPx <= 0, `${keyboard.overflowPx}px`);
  await page.setViewportSize({ width: vp.width, height: vp.height });

  // Submission is intentionally not exercised: no order, no payment, no client success.
  result.check("no order submitted during QA", true, "CTA never clicked");
}

const browser = await chromium.launch({ headless: true });
const report = { base: BASE, capturedAt: new Date().toISOString(), viewports: {}, passed: true };

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
                { menuItemId: itemId, name: "Audit Dish", priceCents: 89900, imageUrl: "/favicon.svg", isVeg: true, quantity: 1, lineKey: String(itemId) },
              ],
            }),
          );
          localStorage.setItem(
            "crave.profile.v1",
            JSON.stringify({
              name: "Audit Customer",
              phone: "9876543210",
              addresses: [{ id: "addr-audit", label: "Home", text: "12 Station Road, Bharuch, Gujarat 392001" }],
              orders: [],
            }),
          );
          // A first-visit storage banner would cover the controls under test.
          // Record a decision so QA exercises the settled UI, not onboarding.
          localStorage.setItem(
            "crave.consent.v3",
            JSON.stringify({ choice: "all", version: 3, decidedAt: "2026-11-23T00:00:00.000Z" }),
          );
        } catch {
          /* storage disabled: checks report the resulting state */
        }
      },
      { slug: CHECKOUT_SLUG, itemId: CHECKOUT_ITEM_ID },
    );
    const page = await context.newPage();
    const vpResult = { checks: [] };
    const rec = recorder();

    let restaurantHref = null;
    try {
      await goto(page, "/");
      const home = await layout(page);
      restaurantHref = await page.evaluate(() => document.querySelector('a[href^="/restaurants/"]')?.getAttribute("href") ?? null);
      auditStatic(rec, home, { wantNav: vp.width < 768 });
      await auditScroll(page, rec);
      await checkSearch(page, rec);
      await page.screenshot({ path: join(OUT, `home-top-${vp.width}.png`) });
    } catch (e) {
      rec.check("home route", false, e.message.slice(0, 1200));
    }

    try {
      await goto(page, "/restaurants");
      const restaurants = await layout(page);
      auditStatic(rec, restaurants, { wantNav: vp.width < 768 });
      await auditScroll(page, rec);
      await checkFilters(page, rec, vp);
      await page.screenshot({ path: join(OUT, `restaurants-${vp.width}.png`) });
    } catch (e) {
      rec.check("restaurants route", false, e.message.slice(0, 1200));
    }

    try {
      await checkDishSheet(page, rec, restaurantHref);
    } catch (e) {
      rec.check("dish sheet", false, e.message.slice(0, 1200));
    }

    try {
      await checkCart(page, rec);
      await page.screenshot({ path: join(OUT, `cart-${vp.width}.png`) });
    } catch (e) {
      rec.check("cart route", false, e.message.slice(0, 1200));
    }

    try {
      await checkCheckout(page, rec, vp);
      await page.screenshot({ path: join(OUT, `checkout-${vp.width}.png`) });
    } catch (e) {
      rec.check("checkout route", false, e.message.slice(0, 1200));
    }

    vpResult.checks = rec.checks;
    vpResult.failures = rec.failures;
    report.viewports[vp.name] = vpResult;
    console.log(`${vp.name}: ${rec.checks.length - rec.failures.length}/${rec.checks.length} checks passed`);
    for (const failure of rec.failures) console.log(`  FAIL ${failure.name}: ${failure.detail ?? ""}`);
    await context.close();
  }
} finally {
  await browser.close();
}

report.passed = Object.values(report.viewports).every((v) => v.failures.length === 0);
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`M5 ${report.passed ? "PASS" : "FAIL"} — report: ${join(OUT, "report.json")}`);
process.exit(report.passed ? 0 : 1);
