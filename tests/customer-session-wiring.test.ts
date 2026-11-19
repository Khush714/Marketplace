/**
 * The customer-session migration is only real if the routes and screens actually
 * use it. The policy and the row accessors were already unit-tested; these
 * assertions pin the wiring that used to be missing — `orderAuthorized` was
 * dead code, checkout never bound a code, and history read only web storage.
 *
 * Source inspection is deliberate: the routes are `server-only`/Next handlers
 * that cannot be imported into a plain node test, and a build/typecheck alone
 * cannot catch a route that silently keeps checking `x-order-token` by hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const PER_ORDER_ROUTES = [
  "src/app/api/orders/[code]/route.ts",
  "src/app/api/orders/[code]/cancel/route.ts",
  "src/app/api/orders/[code]/review/route.ts",
  "src/app/api/orders/[code]/support/route.ts",
  "src/app/api/orders/[code]/support/read/route.ts",
  "src/app/api/orders/[code]/pay/start/route.ts",
  "src/app/api/orders/[code]/pay/verify/route.ts",
];

test("every per-order route authorises with the token OR the session", () => {
  for (const path of PER_ORDER_ROUTES) {
    const route = source(path);
    assert.match(route, /orderAuthorized\(req, code\)/, `${path} must call the shared authorizer`);
    assert.doesNotMatch(
      route,
      /verifyOrderToken\(/,
      `${path} must not reintroduce a header-only check beside the shared one`,
    );
  }
  const helper = source("src/lib/order-authorized.ts");
  assert.match(helper, /verifyOrderToken\(normalized, headerToken\)/);
  assert.match(helper, /resolveCustomerSession\(req\)/);
  assert.match(helper, /session\.orderCodes\.includes\(normalized\)/);
});

test("checkout binds the new code to the session in the same response", () => {
  const checkout = source("src/app/api/orders/route.ts");
  assert.match(checkout, /ensureCustomerSession\(req\)/);
  assert.match(checkout, /bindOrderCodesToSession\(ensured\.session\.id, \[result\.order\.code\]\)/);
  assert.match(checkout, /appendCustomerSessionCookie\(req, res, ensured\.token, ensured\.expiresAt\)/);
  // Binding is best-effort because the order token is still a complete
  // credential — a session hiccup must not turn a placed order into a 500.
  assert.match(checkout, /try \{[\s\S]*ensureCustomerSession[\s\S]*\} catch \{/);
  assert.match(checkout, /return res;/);
});

test("the history read is budgeted, cookie-authenticated and bounded", () => {
  const history = source("src/app/api/orders/history/route.ts");
  assert.match(history, /guardRead\(req, "orderHistory"\)/);
  assert.match(history, /resolveCustomerSession\(req\)/);
  assert.match(history, /sessionHistoryCodes\(session\.orderCodes\)/);
  assert.match(history, /listOrders\(/);
  // No session is an empty history, never a 401 that reveals the difference
  // between an unknown, revoked and never-minted cookie.
  assert.match(history, /if \(!session\) return Response\.json\(\{ orders: \[\] \}\)/);
});

test("the history page merges the session read with the legacy token lookup", () => {
  const page = source("src/app/orders/page.tsx");
  assert.match(page, /fetchSessionOrders\(\)/);
  assert.match(page, /\/api\/orders\/lookup/);
  assert.match(page, /new Map<string, PublicOrder>\(\)/);
  // It must not short-circuit on an empty web-storage list: that is exactly the
  // cleared-localStorage case the session read exists to cover.
  assert.doesNotMatch(page, /if \(!stored\.length\) \{[\s\S]*setOrders\(\[\]\)/);
});

test("legacy orders in web storage are flushed through /attach once per tab", () => {
  const profile = source("src/lib/profile.tsx");
  assert.match(profile, /fetch\("\/api\/orders\/attach"/);
  assert.match(profile, /sessionStorage/);
  assert.match(profile, /crave\.session\.attach\.v1/);
  // The tokens are only ever sent to the guarded attach route, never rendered.
  assert.doesNotMatch(profile, /x-order-token/);
});

test("the client omits the header when the session is the credential", () => {
  const access = source("src/lib/order-access.ts");
  assert.match(access, /export function orderAuthHeaders\(token\?: string \| null\)/);
  assert.match(access, /return token \? \{ "x-order-token": token \} : \{\}/);
  assert.match(access, /headers: orderAuthHeaders\(token\)/);
  // A null token is no longer "denied" by the hook: the server's answer is.
  assert.doesNotMatch(access, /if \(!input\.token\) return "denied"/);
  assert.match(access, /export async function fetchSessionOrders\(\)/);
});

test("tracking and support screens use the same credential for actions", () => {
  const tracker = source("src/components/order-tracker.tsx");
  assert.match(tracker, /<TrackingView initialOrder=\{order\} token=\{token \?\? undefined\} supportAccess \/>/);
  assert.doesNotMatch(tracker, /access === "denied" \|\| !order \|\| !token/);

  const view = source("src/components/tracking-view.tsx");
  assert.match(view, /supportAccess = Boolean\(token\)/);
  assert.match(view, /headers: orderAuthHeaders\(token\)/);
  assert.match(view, /supportAccess \? \(/);

  const support = source("src/components/order-support.tsx");
  assert.match(support, /export function OrderSupport\(\{ code, token \}: \{ code: string; token\?: string \}\)/);
  assert.match(support, /headers: orderAuthHeaders\(token\)/);
});
