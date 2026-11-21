/**
 * Shared harness for the Phase 13 end-to-end security tests (tests/security/).
 *
 * The security decisions being asserted live in app route handlers, most of
 * which import `server-only` and therefore throw when imported under
 * `node --test`. So the code under test is exercised the way a client sees it:
 * a scratch PostgreSQL database built from the real migrations, seeded with
 * deterministic fixtures, and a real Next.js production server (`next start`)
 * listening on a random localhost port.
 *
 * Why one module and not a fixture-per-suite:
 *   - `node --test` runs each test FILE in its own process and the suites here
 *     all contend on one server and one database, so everything Phase 13 asserts
 *     lives in a single file that imports this one harness.
 *   - The scratch database is dropped and recreated once; fixtures are
 *     re-seeded (TRUNCATE) before each suite so suites cannot interfere.
 *
 * The harness is deliberately *not* named *.test.ts, so the test runner treats
 * it as a library rather than a test file.
 *
 * ## Local prerequisites
 *
 *   - PostgreSQL 13+ reachable at 127.0.0.1:5432 with superuser
 *     `postgres`/`postgres` (the same dev database the rest of the repo uses).
 *
 * If that connection cannot be made the harness reports `ok: false`. What the
 * test file then does depends on `securityTestsRequired()`:
 *
 *   - locally (plain `npm test`): every case skips with `t.skip(...)`, so the
 *     suite stays green on machines without the local server;
 *   - in CI (`CI` set, or `REQUIRE_SECURITY_TESTS=1`): the run FAILS instead.
 *     A skipped security suite must never read as a pass, so a missing or dead
 *     PostgreSQL service turns the job red rather than green.
 *
 * ## Environment applied to the server process
 *
 *   - `DATABASE_URL`            -> the scratch database
 *   - `NODE_ENV=production`     -> exactly what a deployed `next start` runs as
 *   - `ORDER_TOKEN_SECRET`, `POS_DELIVERY_OPS_TOKEN`, `RAZORPAY_WEBHOOK_SECRET`,
 *     `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` -> deterministic dummy values
 *   - `NEXT_PUBLIC_APP_URL` deliberately NOT set: the edge-policy host
 *     allowlist resolves `appOrigin()` to `http://localhost:3000`, so only a
 *     `localhost` Host header passes in production mode. Every request here is
 *     therefore made against `http://localhost:<port>` — never 127.0.0.1.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

export const TEST_DB_NAME = "crave_security_test";
export const TEST_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:5432/${TEST_DB_NAME}`;

/* Deterministic dummy secrets for the scratch server. */
export const OPS_TOKEN = "ops-delivery-token-2026-security-tests";
export const WEBHOOK_SECRET = "whsec_test_security_2026";
export const ORDER_TOKEN_SECRET = "order-token-secret-2026-for-security-tests";
export const RAZORPAY_KEY_ID = "rzp_test_security";
export const RAZORPAY_KEY_SECRET = "rzp_test_security_secret";

/* Session / CSRF cookie names (see src/lib/restaurant-session-core.ts). */
export const SESSION_COOKIE = "crave_restaurant_session";
export const CSRF_COOKIE = "crave_restaurant_csrf";
export const CSRF_HEADER = "x-csrf-token";

/* ------------------------------------------------------------------ crypto */

export function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** The `x-order-token` value the server accepts for a given order code. */
export function orderTokenFor(code: string): string {
  return createHmac("sha256", ORDER_TOKEN_SECRET)
    .update(`order:v1:${code.toUpperCase()}`, "utf8")
    .digest("base64url");
}

/** 16 random bytes, base64url — the same shape as a live tracking token. */
export function makeTrackingToken(): string {
  return randomBytes(16).toString("base64url");
}

/** 32 random bytes, base64url — the same shape as a session / CSRF token. */
export function makeSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

/* ----------------------------------------------------------------- fixtures */

/** Restaurants seeded from fixed constants so a re-seed is deterministic. */
export const ALPHA_OWNER_KEY = "sec-key-alpha-0001";
export const BETA_OWNER_KEY = "sec-key-beta-0002";
export const ALPHA_MARKETPLACE_ID = "mktplash_alpha";
export const BETA_MARKETPLACE_ID = "mktplash_beta";

/** Connection-code fixtures. 4 to probe redemption, 1 bound to alpha for login. */
export const CODES = {
  unused: "AXQBP",
  used: "AXQBR",
  revoked: "AXQBS",
  expired: "AXQBT",
  login: "INTALPHA",
} as const;

/* Tracking tokens are fixed per process so re-seeding reproduces the same rows;
 * the server compares stored hashes, so the exact bytes only need to be stable
 * within one test run. */
const T_ALPHA_OPEN = makeTrackingToken();
const T_ALPHA_CLOSED = makeTrackingToken();
const T_BETA_OPEN = makeTrackingToken();

export interface RestaurantRow {
  id: number;
  slug: string;
  name: string;
  externalId: string | null;
  marketplaceId: string | null;
  isActive: boolean;
}

export interface RestaurantFix extends RestaurantRow {
  ownerKey: string;
}

export interface OrderFix {
  id: number;
  code: string;
  trackingToken: string;
  orderToken: string;
  externalOrderId: string;
  totalCents: number;
  status: string;
  paymentStatus: string;
  phone: string;
}

export interface Fixture {
  alpha: RestaurantFix;
  beta: RestaurantFix;
  codes: typeof CODES;
  alphaOpen: OrderFix;
  alphaClosed: OrderFix;
  betaOpen: OrderFix;
  alphaSession: { token: string; csrf: string };
  betaSession: { token: string; csrf: string };
}

export let fixture: Fixture;

/**
 * Fresh fixture accessor. `export let` is snapshotted by the CJS interop tsx
 * uses under this repo's CommonJS package, so tests must read fixtures through
 * this call instead of a live import binding — re-seeding then re-reads the
 * current values.
 */
export function getFixture(): Fixture {
  return fixture;
}

/* ------------------------------------------------------------------- state */

let pg: Client | null = null;
let server: { child: ChildProcess; port: number; base: string } | null = null;
let prepared: { ok: boolean; reason?: string } | null = null;

function client(): Client {
  if (!pg) throw new Error("harness is not ready: call prepare() (or skip) first");
  return pg;
}

/** Convert epoch-milliseconds to ISOTIMESTAMP text (timestamptz params). */
export function ts(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function serverRef(): { child: ChildProcess; port: number; base: string } {
  if (!server) throw new Error("harness server is not running: call prepare() first");
  return server;
}

/* --------------------------------------------------------- db primitives */

export async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = client();
  const result = await c.query(sql, params);
  return result.rows as T[];
}

export async function queryRow<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}

export async function runSql(sql: string, params: unknown[] = []): Promise<void> {
  await queryRows(sql, params);
}

/* ------------------------------------------------------------- seeding */

export async function seedRestaurant(o: {
  slug: string;
  name: string;
  externalId: string;
  ownerKey: string;
  tagline?: string;
  cuisines?: string[];
  locality?: string;
  marketplaceId?: string | null;
  isActive?: boolean;
}): Promise<RestaurantFix> {
  const rows = await queryRows<RestaurantRow>(
    `insert into restaurants (
       slug, name, tagline, cuisines, rating, ratings_count, price_level,
       delivery_minutes, distance_km, offer, offer_percent, offer_max_cents,
       image_url, hero_url, featured, pure_veg, locality, is_active,
       external_id, marketplace_id, owner_key_hash, integration_passkey_hash,
       created_at
     ) values (
       $1, $2, $3, $4, 4.5, 120, 2, 30, 3.2, null, 0, 0,
       $5, $6, false, $7, $8, $9,
       $10, $11, $12, $13, now()
     )
     returning id, slug, name, external_id as "externalId", marketplace_id as "marketplaceId", is_active as "isActive"`,
    [
      o.slug,
      o.name,
      o.tagline ?? "",
      o.cuisines ?? [],
      `https://img.example/${o.slug}.jpg`,
      `https://img.example/${o.slug}-hero.jpg`,
      o.isActive ?? true,
      o.locality ?? "Old City",
      o.isActive ?? true,
      o.externalId,
      o.marketplaceId ?? null,
      sha256hex(o.ownerKey),
      null,
    ],
  );
  return { ...rows[0], ownerKey: o.ownerKey };
}

export async function seedSession(o: {
  restaurantId: number;
  token?: string;
  csrf?: string;
  expiresAtMs?: number;
  revokedAtMs?: number | null;
  deleteToken?: string;
  deleteConfirmExpiresAtMs?: number;
}): Promise<{ token: string; csrf: string }> {
  const token = o.token ?? makeSecretToken();
  const csrf = o.csrf ?? makeSecretToken();
  await runSql(
    `insert into restaurant_sessions (
       token_hash, restaurant_id, csrf_hash,
       delete_confirm_hash, delete_confirm_expires_at,
       expires_at, revoked_at, last_used_at
     ) values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      sha256hex(token),
      o.restaurantId,
      sha256hex(csrf),
      o.deleteToken ? sha256hex(o.deleteToken) : null,
      o.deleteToken ? ts(o.deleteConfirmExpiresAtMs ?? Date.now() + 10 * 60 * 1000) : null,
      ts(o.expiresAtMs ?? Date.now() + 30 * 24 * 60 * 60 * 1000),
      ts(o.revokedAtMs ?? null),
    ],
  );
  return { token, csrf };
}

export async function seedOrder(o: {
  code: string;
  restaurant: { id: number; slug: string; name: string };
  trackingToken?: string;
  externalOrderId: string;
  status?: string;
  paymentStatus?: string;
  totalCents?: number;
  customerName?: string;
  phone?: string;
  posConnected?: boolean;
  posOrderId?: number | null;
  posDeliveryStatus?: string;
}): Promise<OrderFix> {
  const trackingToken = o.trackingToken ?? makeTrackingToken();
  const totalCents = o.totalCents ?? 4500;
  const subtotal = Math.max(totalCents - 3900 - 600, 0);
  const rows = await queryRows<{ id: number }>(
    `insert into orders (
       code, restaurant_id, restaurant_name, restaurant_slug,
       items, address_label, address_text, customer_name, phone,
       payment_method, payment_status, instructions, rider_name,
       subtotal_cents, delivery_fee_cents, platform_fee_cents, discount_cents, total_cents,
       client_request_id, external_order_id, pos_order_id, pos_connected, pos_delivery_status,
       outlet_id, branch_id, integration_status, status_updated_at,
       tracking_token_hash, created_at
     ) values (
       $1, $2, $3, $4,
       $5::jsonb, $6, $7, $8, $9,
       $10, $11, $12, $13,
       $14, $15, $16, 0, $17,
       null, $18, $19, $20, $21,
       null, null, $22, now(),
       $23, now()
     )
     returning id`,
    [
      o.code,
      o.restaurant.id,
      o.restaurant.name,
      o.restaurant.slug,
      JSON.stringify([
        { menuItemId: "mi-1", name: "Pulao", quantity: 2, unitCents: Math.round(subtotal / 2), lineCents: subtotal },
      ]),
      "Home",
      "221B Baker Street",
      o.customerName ?? "Security Tester",
      o.phone ?? "9999999999",
      "upi",
      o.paymentStatus ?? "PAYMENT_PENDING",
      "Rider instructions",
      "Rider #1",
      subtotal,
      3900,
      600,
      totalCents,
      o.externalOrderId,
      o.posOrderId ?? null,
      o.posConnected ?? false,
      o.posDeliveryStatus ?? "PENDING",
      o.status ?? "PLACED",
      sha256hex(trackingToken),
    ],
  );
  return {
    id: rows[0].id,
    code: o.code,
    trackingToken,
    orderToken: orderTokenFor(o.code),
    externalOrderId: o.externalOrderId,
    totalCents,
    status: o.status ?? "PLACED",
    paymentStatus: o.paymentStatus ?? "PAYMENT_PENDING",
    phone: o.phone ?? "9999999999",
  };
}

export async function seedPayment(o: {
  paymentReference: string;
  marketplaceOrderId: number;
  externalOrderId: string;
  restaurantId: number;
  providerPaymentId?: string | null;
  providerOrderId: string;
  amountCents?: number;
  currency?: string;
}): Promise<void> {
  const amountCents = o.amountCents ?? 18000;
  await runSql(
    `insert into marketplace_payments (
       payment_reference, marketplace_order_id, external_order_id, restaurant_id,
       provider, provider_payment_id, provider_order_id,
       amount_cents, amount, currency, status, signature_verified, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      o.paymentReference,
      o.marketplaceOrderId,
      o.externalOrderId,
      o.restaurantId,
      "razorpay",
      o.providerPaymentId ?? null,
      o.providerOrderId,
      amountCents,
      amountCents / 100,
      o.currency ?? "INR",
      "PAYMENT_PENDING",
      false,
    ],
  );
}

export async function seedConnectionCode(o: {
  code: string;
  status?: "unused" | "used" | "revoked";
  expiresAtMs?: number | null;
  usedAtMs?: number | null;
  revokedAtMs?: number | null;
}): Promise<number> {
  const rows = await queryRows<{ id: number }>(
    `insert into connection_codes (code, status, expires_at, used_at, revoked_at)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      o.code,
      o.status ?? "unused",
      ts(o.expiresAtMs ?? Date.now() + 24 * 60 * 60 * 1000),
      ts(o.usedAtMs ?? null),
      ts(o.revokedAtMs ?? null),
    ],
  );
  return rows[0].id;
}

export async function seedConnection(o: {
  codeId: number;
  restaurantId: number;
  status?: string;
}): Promise<void> {
  await runSql(
    `insert into connections (code_id, restaurant_id, marketplace, status, connected_at)
     values ($1, $2, 'crave', $3, now())
     on conflict (code_id) do nothing`,
    [o.codeId, o.restaurantId, o.status ?? "active"],
  );
}

/** Wipe and rebuild the fixture set, including a fresh pair of partner sessions. */
export async function resetAndSeed(): Promise<void> {
  const c = client();
  await c.query(
    `truncate table
       restaurants, restaurant_sessions, connection_codes, connections,
       integration_sessions, orders, marketplace_payments,
       marketplace_payment_events
     restart identity cascade`,
  );
  const alpha = await seedRestaurant({
    slug: "alpha-kitchen",
    name: "Alpha Kitchen",
    externalId: "POS_ALPHA_001",
    ownerKey: ALPHA_OWNER_KEY,
    tagline: "Test listing A",
    cuisines: ["Biryani", "Fried Chicken"],
    marketplaceId: ALPHA_MARKETPLACE_ID,
  });
  const beta = await seedRestaurant({
    slug: "beta-bistro",
    name: "Beta Bistro",
    externalId: "POS_BETA_001",
    ownerKey: BETA_OWNER_KEY,
    cuisines: ["Pizza"],
    marketplaceId: BETA_MARKETPLACE_ID,
  });

  const alphaOpen = await seedOrder({
    code: "CRV-ALPHA1",
    externalOrderId: "mkt_ord_alpha_1",
    restaurant: { id: alpha.id, slug: alpha.slug, name: alpha.name },
    trackingToken: T_ALPHA_OPEN,
    status: "PLACED",
    paymentStatus: "PAYMENT_PENDING",
    totalCents: 12000,
    phone: "9000000001",
    posConnected: true,
    posOrderId: 1001,
    posDeliveryStatus: "PLACED",
  });
  const alphaClosed = await seedOrder({
    code: "CRV-ALPHA2",
    externalOrderId: "mkt_ord_alpha_2",
    restaurant: { id: alpha.id, slug: alpha.slug, name: alpha.name },
    trackingToken: T_ALPHA_CLOSED,
    status: "CANCELLED",
    paymentStatus: "PAYMENT_PAID",
    totalCents: 8000,
    phone: "9000000002",
    posConnected: false,
  });
  const betaOpen = await seedOrder({
    code: "CRV-BETA1",
    externalOrderId: "mkt_ord_beta_1",
    restaurant: { id: beta.id, slug: beta.slug, name: beta.name },
    trackingToken: T_BETA_OPEN,
    status: "PLACED",
    paymentStatus: "PAYMENT_PENDING",
    totalCents: 15000,
    phone: "9000000003",
    posConnected: true,
    posOrderId: 2001,
    posDeliveryStatus: "PLACED",
  });

  const codeUnused = await seedConnectionCode({ code: CODES.unused });
  await seedConnectionCode({ code: CODES.used, status: "used", usedAtMs: Date.now() - 1000 });
  await seedConnectionCode({ code: CODES.revoked, status: "revoked", revokedAtMs: Date.now() - 1000 });
  await seedConnectionCode({ code: CODES.expired, status: "unused", expiresAtMs: Date.now() - 1000 });
  const codeLoginId = await seedConnectionCode({ code: CODES.login, status: "used", usedAtMs: Date.now() - 1000 });
  await seedConnection({ codeId: codeLoginId, restaurantId: alpha.id });

  fixture = {
    alpha,
    beta,
    codes: CODES,
    alphaOpen,
    alphaClosed,
    betaOpen,
    alphaSession: await seedSession({ restaurantId: alpha.id }),
    betaSession: await seedSession({ restaurantId: beta.id }),
  };
}

/* --------------------------------------------------- integration helpers */

export function jarFrom(o: { token: string; csrf: string }): Record<string, string> {
  return { [SESSION_COOKIE]: o.token, [CSRF_COOKIE]: o.csrf };
}

export function csrfHeaders(jar: Record<string, string>): Record<string, string> {
  return { [CSRF_HEADER]: jar[CSRF_COOKIE] ?? "" };
}

export async function expireIntegrationSession(token: string): Promise<void> {
  await runSql("update integration_sessions set expires_at = now() - interval '5 seconds' where token_hash = $1", [
    sha256hex(token),
  ]);
}

export async function revokeIntegrationSession(token: string): Promise<void> {
  await runSql("update integration_sessions set revoked_at = now() where token_hash = $1", [sha256hex(token)]);
}

/* ------------------------------------------------------------ HTTP client */

export interface CookieJar {
  [name: string]: string;
}

export interface ApiResult {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  res: Response;
}

export interface ApiOptions {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  ip: string;
  headers?: Record<string, string>;
  jar?: CookieJar;
  base?: string;
}

function collectSetCookies(res: Response, jar: CookieJar): void {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  let values: string[];
  if (typeof headers.getSetCookie === "function") {
    values = headers.getSetCookie.call(headers);
  } else {
    const single = headers.get("set-cookie");
    values = single ? single.split("\n") : [];
  }
  for (const value of values) {
    const eq = value.indexOf("=");
    if (eq === -1) continue;
    const name = value.slice(0, eq).trim();
    const cookieValue = value.slice(eq + 1).split(";")[0] ?? "";
    if (name) jar[name] = cookieValue;
  }
}

/**
 * Fire an HTTP request at the scratch server with a spoofed `x-forwarded-for`
 * (rate-limit buckets are keyed off it) and an optional cookie jar that absorbs
 * `Set-Cookie` responses for the caller.
 */
export async function api(o: ApiOptions): Promise<ApiResult> {
  const base = serverRef().base;
  const headers: Record<string, string> = { "x-forwarded-for": o.ip, ...(o.headers ?? {}) };
  let body: string | undefined;
  if (o.body !== undefined) {
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    headers["content-type"] = "application/json";
  }
  if (o.jar) {
    const cookieNames = Object.keys(o.jar).filter((k) => o.jar![k] !== "");
    if (cookieNames.length) {
      headers.cookie = cookieNames.map((k) => `${k}=${o.jar![k]}`).join("; ");
    }
  }
  const res = await fetch((o.base ?? base) + o.path, {
    method: o.method ?? "GET",
    headers,
    body,
    redirect: "manual",
  });
  if (o.jar) collectSetCookies(res, o.jar);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON body — keep json as null */
  }
  return { status: res.status, text, json: json as Record<string, unknown> | null, res };
}

/** POST /api/partner/session with an owner key; returns the session cookies. */
export async function loginPartner(ownerKey: string, ip: string): Promise<{ result: ApiResult; jar: CookieJar }> {
  const jar: CookieJar = {};
  const result = await api({ path: "/api/partner/session", method: "POST", body: { ownerKey }, ip, jar });
  return { result, jar };
}

/* ------------------------------------------------------------- bootstrap */

/**
 * Whether a missing harness must FAIL the run instead of skipping.
 *
 * Fail-closed whenever `CI` is truthy (GitHub Actions sets `CI=true` on every
 * job, so this holds even if the workflow forgets `REQUIRE_SECURITY_TESTS`) or
 * when `REQUIRE_SECURITY_TESTS=1` is set explicitly. Only a local run without
 * either marker keeps the skip-and-stay-green behaviour.
 */
export function securityTestsRequired(): boolean {
  if (process.env.REQUIRE_SECURITY_TESTS === "1") return true;
  const ci = process.env.CI;
  return ci !== undefined && ci !== "" && ci !== "false" && ci !== "0";
}

async function probePostgres(): Promise<boolean> {
  const probe = new Client({ connectionString: TEST_ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.connect();
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

function runNode(args: string[], extraEnv: Record<string, string>): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout?.on("data", (d: Buffer) => {
      log += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      log += d.toString();
    });
    child.on("error", (e) => {
      resolve({ ok: false, log: String(e) });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, log });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("failed to allocate a port"));
      });
    });
  });
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server!.child.exitCode !== null) return false;
    try {
      const res = await fetch(`${server!.base}/privacy`, { headers: { "x-forwarded-for": "127.0.0.1" } });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Tear down the scratch server and database client (idempotent). */
export async function shutdown(): Promise<void> {
  if (server) {
    try {
      server.child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            server!.child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
          resolve();
        }, 4000);
        server!.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      server = null;
    }
  }
  if (pg) {
    try {
      await pg.end();
    } catch {
      /* ignore */
    }
    pg = null;
  }
  prepared = null;
}

/**
 * Whether the produced build is older than the newest source file it could
 * contain. Rebuilding only when stale keeps the guarded `prepare()` honest
 * about which code `next start` will actually serve.
 */
function buildIsStale(buildIdPath: string): boolean {
  const stamp = stateOf(buildIdPath).mtimeMs;
  return newestMtime(path.join(ROOT, "src")) > stamp;
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (/\.(ts|tsx|js|jsx|mjs|json|css)$/.test(entry.name)) newest = Math.max(newest, stateOf(p).mtimeMs);
  }
  return newest;
}

function stateOf(p: string) {
  const { mtimeMs } = statSync(p);
  return { mtimeMs };
}

/**
 * Create the scratch database, apply the real migrations, seed the fixtures and
 * boot `next start`. Returns `{ ok: false, reason }` if the local PostgreSQL
 * prerequisite is missing (or anything else fails), which the test file turns
 * into skips locally and into hard failures when `securityTestsRequired()`.
 */
export async function prepare(): Promise<{ ok: boolean; reason?: string }> {
  if (prepared) return prepared;

  if (!(await probePostgres())) {
    prepared = { ok: false, reason: "local PostgreSQL (127.0.0.1:5432, postgres/postgres) is not reachable" };
    return prepared;
  }

  try {
    const admin = new Client({ connectionString: TEST_ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.query(`create database ${TEST_DB_NAME}`);
    await admin.end();
  } catch (e) {
    prepared = { ok: false, reason: `could not (re)create ${TEST_DB_NAME}: ${String(e)}` };
    return prepared;
  }

  /**
   * The migrations under src/db/migrations are idempotent *patches* layered on
   * top of the base schema that `drizzle-kit push` materialises from
   * src/db/schema.ts — there is no "base" migration file. The CLI's `push`
   * refuses to run without a TTY even with `--force`, so the harness instead
   * asks `drizzle-kit generate` to diff-from-nothing into a scratch folder and
   * applies that full CREATE DDL directly. Then the real migration files run on
   * top (they are additive and re-runnable), so the scratch database is built
   * exactly the way a deployed one is.
   */
  const genDir = mkdtempSync(path.join(tmpdir(), "mp-drizzle-"));
  const drizzleBin = path.join(ROOT, "node_modules", "drizzle-kit", "bin.cjs");
  const generated = await runNode(
    [
      drizzleBin,
      "generate",
      "--dialect",
      "postgresql",
      "--schema",
      "src/db/schema.ts",
      "--out",
      genDir,
      "--name",
      "initial",
    ],
    {},
  );
  let schemaSql = "";
  if (generated.ok) {
    try {
      schemaSql = readFileSync(path.join(genDir, "0000_initial.sql"), "utf8");
    } catch {
      /* fall through to the ok:false below */
    }
  } else {
    rmSync(genDir, { recursive: true, force: true });
    prepared = { ok: false, reason: `drizzle-kit generate failed: ${generated.log}` };
    return prepared;
  }
  rmSync(genDir, { recursive: true, force: true });
  if (!schemaSql.trim()) {
    prepared = { ok: false, reason: "drizzle-kit generate produced no schema SQL" };
    return prepared;
  }

  const ddl = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await ddl.connect();
    await ddl.query(schemaSql);
    await ddl.end();
  } catch (e) {
    await ddl.end().catch(() => {});
    prepared = { ok: false, reason: `schema bootstrap failed: ${String(e)}` };
    return prepared;
  }

  const migrated = await runNode(["scripts/db-migrate.mjs"], {
    MIGRATIONS_DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_URL: TEST_DATABASE_URL,
  });
  if (!migrated.ok) {
    prepared = { ok: false, reason: `db-migrate failed: ${migrated.log}` };
    return prepared;
  }

  pg = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await pg.connect();
  } catch (e) {
    prepared = { ok: false, reason: `could not connect to ${TEST_DB_NAME}: ${String(e)}` };
    await pg.end().catch(() => {});
    pg = null;
    return prepared;
  }

  await resetAndSeed();

  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    prepared = { ok: false, reason: "next CLI not found under node_modules" };
    return prepared;
  }
  const buildIdPath = path.join(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath) || buildIsStale(buildIdPath)) {
    const built = await runNode([nextBin, "build"], {});
    if (!built.ok) {
      prepared = { ok: false, reason: `next build failed: ${built.log}` };
      return prepared;
    }
  }

  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: TEST_DATABASE_URL,
      ORDER_TOKEN_SECRET,
      POS_DELIVERY_OPS_TOKEN: OPS_TOKEN,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET,
      PORT: String(port),
    },
    stdio: "ignore",
  });
  server = { child, port, base: `http://localhost:${port}` };

  const up = await waitForServer(90_000);
  if (!up) {
    await shutdown();
    prepared = { ok: false, reason: "next start did not become ready in time" };
    return prepared;
  }

  prepared = { ok: true };
  return prepared;
}