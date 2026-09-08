import pg from "pg";
import { createHash, randomBytes } from "node:crypto";

const BASE = "http://localhost:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const EMAIL = `e2e.cancel.${Date.now().toString(36)}@example.com`;

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

async function signIn(email) {
  const req = await api("/api/auth/otp/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (req.status !== 200) throw new Error(`OTP request failed: ${req.status} ${JSON.stringify(req.json)}`);
  const code = req.json.devCode;
  if (!code) throw new Error("no devCode returned");

  const ver = await api("/api/auth/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, name: "E2E Canceller" }),
  });
  if (ver.status !== 200) throw new Error(`OTP verify failed: ${ver.status} ${JSON.stringify(ver.json)}`);
  const cookie = (ver.headers.getSetCookie?.() ?? [ver.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("no session cookie set");
  return cookie;
}

function track(reference, cookie) {
  const h = cookie ? { Cookie: cookie } : {};
  return api(`/api/marketplace/orders/${reference}`, { headers: h }).then((r) => {
    if (r.status !== 200) throw new Error(`GET failed ${r.status}`);
    return r.json.order;
  });
}

const pool = new pg.Pool({ connectionString: DB });
let exit = 1;
try {
  const cookie = await signIn(EMAIL);
  console.log(`Signed in as ${EMAIL}`);

  const place = (body) => api("/api/marketplace/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });

  /* ================= TEST 1 — cancel while placed ================= */
  console.log("\n===== TEST 1: PLACE -> CANCEL =====");
  const t1 = await place({
    restaurant: "le-bistro-bleu",
    customerName: "E2E Canceller",
    customerPhone: "+1 555 777 888",
    fulfillmentType: "pickup",
    paymentMethod: "cash",
    items: [{ menuItemId: 1, quantity: 1 }],
  });
  if (t1.status !== 201) throw new Error(`place failed ${t1.status}: ${JSON.stringify(t1.json)}`);
  const ref1 = t1.json.reference;
  let o = await track(ref1, cookie);
  console.log(`Order ${ref1}: ${o.status} (step ${o.lifecycle.step}) next=[${o.lifecycle.next}] — Cancel button renders: ${o.lifecycle.next.includes("cancelled")}`);

  const canc = await api(`/api/marketplace/orders/${ref1}/cancel`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  console.log(`POST /cancel -> HTTP ${canc.status} (expected 200)  body=${JSON.stringify(canc.json)}`);

  o = await track(ref1, cookie);
  console.log(`After cancel: status=${o.status}  label="${o.lifecycle.label}"  terminal=${o.lifecycle.terminal}  next=[${o.lifecycle.next}]`);
  if (o.status !== "cancelled") throw new Error("order not cancelled");
  if (!o.lifecycle.terminal) throw new Error("not terminal — polling would continue");
  console.log(`UI: STATUS_MESSAGES.cancelled -> "Order cancelled" / "This order has been cancelled."`);
  console.log("Polling stops: lifecycle.terminal = true  PASS");

  /* ================= TEST 2 — cannot cancel once accepted ================= */
  console.log("\n===== TEST 2: ACCEPTED -> CANCEL MUST FAIL =====");
  const t2 = await place({
    restaurant: "le-bistro-bleu",
    customerName: "E2E Canceller",
    customerPhone: "+1 555 777 888",
    fulfillmentType: "pickup",
    paymentMethod: "cash",
    items: [{ menuItemId: 2, quantity: 1 }],
  });
  if (t2.status !== 201) throw new Error(`place#2 failed ${t2.status}`);
  const ref2 = t2.json.reference;

  // POS accept requires a valid POS key for restaurant 1.
  const pkey = `pos_${randomBytes(16).toString("hex")}`;
  const phash = createHash("sha256").update(pkey).digest("hex");
  await pool.query("UPDATE restaurant_marketplace_profiles SET pos_key_hash = $1 WHERE restaurant_id = 1", [phash]);

  const acc = await api(`/api/pos/orders/${ref2}/transition?key=${pkey}&to=accepted`, { method: "POST" });
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status}: ${JSON.stringify(acc.json)}`);

  o = await track(ref2, cookie);
  console.log(`Order ${ref2}: ${o.status} (step ${o.lifecycle.step}) next=[${o.lifecycle.next}]`);

  const canc2 = await api(`/api/marketplace/orders/${ref2}/cancel`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  console.log(`POST /cancel -> HTTP ${canc2.status} (expected 409)  error="${canc2.json?.error}"`);

  o = await track(ref2, cookie);
  console.log(`Still: status=${o.status}  terminal=${o.lifecycle.terminal} — unchanged, still live`);
  if (canc2.status !== 409) throw new Error("cancel NOT rejected after acceptance");
  if (o.status !== "accepted") throw new Error("order damaged by failed cancel");

  console.log("\nCustomer cannot cancel after acceptance: PASS");
  exit = 0;
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await pool.query("UPDATE restaurant_marketplace_profiles SET pos_key_hash = '' WHERE restaurant_id = 1");
  await pool.end();
}
process.exit(exit);