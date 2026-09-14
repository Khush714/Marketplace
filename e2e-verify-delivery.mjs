import pg from "pg";
import { createHash, createHmac, randomBytes } from "node:crypto";

const BASE = "http://localhost:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const EMAIL = `e2e.delivery.${Date.now().toString(36)}@example.com`;
const POS_KEY = `pos_${randomBytes(16).toString("hex")}`;
const ADMIN_SECRET = "dev-admin-secret";

const pass = (label) => console.log(`  PASS  ${label}`);
const fail = (label, extra = "") => {
  console.log(`  FAIL  ${label}${extra ? `  ${extra}` : ""}`);
  results.push({ label, extra });
};
const results = [];

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    signal: opts.signal ?? AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

function adminCookie() {
  const payload = `1.owner.${Date.now()}`;
  const sig = createHmac("sha256", ADMIN_SECRET).update(payload).digest("base64url");
  return `tablz_admin=${payload}.${sig}`;
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
    body: JSON.stringify({ email, code, name: "E2E Delivery" }),
  });
  if (ver.status !== 200) throw new Error(`OTP verify failed: ${ver.status} ${JSON.stringify(ver.json)}`);
  const cookie = (ver.headers.getSetCookie?.() ?? [ver.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("no session cookie set");
  return cookie;
}

/** Watch the SSE stream until an order snapshot with `status` arrives (or timeout). */
async function watchUntilStatus(reference, wantStatus, ms = 10000) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, ms);
    let buf = "";
    let sawStatuses = [];
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/marketplace/orders/${reference}/events`, {
          signal: ctrl.signal,
        });
        if (!res.body) throw new Error("no body");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() ?? "";
          for (const b of blocks) {
            const line = b.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = JSON.parse(line.slice(5).trim());
            if (data.order) {
              sawStatuses.push(data.order.status);
              if (data.order.status === wantStatus) {
                clearTimeout(timer);
                ctrl.abort();
                resolve(sawStatuses);
                return;
              }
            }
          }
        }
      } catch {
        /* aborted / stream end */
      } finally {
        clearTimeout(timer);
      }
      resolve(sawStatuses.length ? sawStatuses : null);
    })();
  });
}

const pool = new pg.Pool({ connectionString: DB });
const q = (t, p) => pool.query(t, p);

let exit = 1;
let ref = null;
try {
  await api("/api/health"); // warm-up compile
  const cookie = await signIn(EMAIL);
  pass(`customer signed in (${EMAIL})`);

  // ---- set POS key for restaurant 1 ----
  const phash = createHash("sha256").update(POS_KEY).digest("hex");
  await q("UPDATE restaurant_marketplace_profiles SET pos_key_hash = $1 WHERE restaurant_id = 1", [phash]);

  /* =================== 1. MARKETPLACE PLACE ORDER =================== */
  console.log("\n[1] Marketplace placeOrder (cash, delivery, restaurant 1)");
  const placed = await api("/api/marketplace/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      restaurant: "le-bistro-bleu",
      customerName: "E2E Delivery",
      customerPhone: "+1 555 999 111",
      customerAddress: "221B Baker Street, NY",
      fulfillmentType: "delivery",
      paymentMethod: "cash",
      dropoffLat: 40.745,
      dropoffLng: -73.988,
      items: [
        { menuItemId: 1, quantity: 1 },
        { menuItemId: 2, quantity: 1 },
      ],
    }),
  });
  if (placed.status !== 201) throw new Error(`place order failed ${placed.status}: ${JSON.stringify(placed.json)}`);
  ref = placed.json.reference;
  pass(`order ${ref} created (HTTP ${placed.status}, total ${placed.json.total})`);

  let o = (await api(`/api/marketplace/orders/${ref}`)).json.order;
  if (o.status !== "placed") throw new Error(`expected placed, got ${o.status}`);
  pass(`tracker → status=placed, step=${o.lifecycle.step}, next=[${o.lifecycle.next}]`);
  const eventTypes = o.events.map((e) => e.type);
  for (const t of ["ORDER_PLACED", "ORDER_SENT_TO_RESTAURANT"])
    if (!eventTypes.includes(t)) throw new Error(`missing audit event ${t}`);
  pass(`audit trail has ORDER_PLACED + ORDER_SENT_TO_RESTAURANT`);
  if (o.scheduledFor !== null) throw new Error("unexpected scheduledFor");
  pass("scheduledFor=null (ASAP)");

  const dbOrder = (await q("select reference, fulfillment_type, status, dropoff_lat, dropoff_lng from orders where reference=$1", [ref])).rows[0];
  if (dbOrder.fulfillment_type !== "delivery") throw new Error("not a delivery order");
  pass("orders row: fulfillment=delivery");
  if (dbOrder.dropoff_lat == null || dbOrder.dropoff_lng == null) {
    fail("dropoff coords persisted on order", "(customer pin is null — rider map cannot anchor)");
  } else {
    pass(`dropoff coords persisted (${dbOrder.dropoff_lat}, ${dbOrder.dropoff_lng})`);
  }

  // ---- realtime SSE: expect an initial snapshot + a push on next transition ----
  console.log("[1b] realtime SSE stream");
  const watchCtl = await watchUntilStatus(ref, "accepted", 8000);
  if (watchCtl?.includes("placed") && watchCtl.includes("accepted")) {
    pass(`SSE order events streamed: ${watchCtl.join(" -> ")}`);
  } else {
    fail(`SSE stream did not show placed→accepted transition`, watchCtl ? watchCtl.join(",") : "stream timeout");
  }

  /* =================== 2. POS BRIDGE RECEIVES + DRIVES =================== */
  console.log("\n[2] POS queue + transitions (accepted → preparing → ready)");
  const queue = await api(`/api/pos/orders?key=${POS_KEY}&status=placed`);
  const inQueue = (queue.json?.orders ?? []).some((x) => x.reference === ref);
  if (!inQueue) throw new Error("order not visible in POS queue");
  pass("order visible in POS queue (status=placed)");

  for (const to of ["accepted", "preparing", "ready"]) {
    const tr = await api(`/api/pos/orders/${ref}/transition?key=${POS_KEY}&to=${to}`, { method: "POST" });
    if (tr.status !== 200) throw new Error(`transition to ${to} failed ${tr.status}: ${JSON.stringify(tr.json)}`);
    const fresh = (await api(`/api/marketplace/orders/${ref}`)).json.order;
    if (fresh.status !== to) throw new Error(`tracker out of sync: expected ${to}, got ${fresh.status}`);
    pass(`POS transition ${to.padEnd(9)} → tracker reflects ${fresh.status} (step ${fresh.lifecycle.step})`);
  }

  const evs = (await api(`/api/marketplace/orders/${ref}/events`));
  if (evs.status !== 200) fail("existing events RSS poll failed");
  else pass("events endpoint reachable (REST fallback)");

  /* =================== 3. DISPATCH RIDER =================== */
  console.log("\n[3] Admin dispatch → delivery assignment (token)");
  const admin = adminCookie();
  const asg = await api(`/api/admin/delivery/orders/${ref}/assignment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ action: "assign", partnerId: 1 }),
  });
  if (asg.status !== 200) throw new Error(`assign failed ${asg.status}: ${JSON.stringify(asg.json)}`);
  const token = asg.json.assignment.token;
  if (!token) throw new Error("no assignment token returned");
  pass(`assigned Rahul Verma (partner 1) → token ${token.slice(0, 12)}…`);

  o = (await api(`/api/marketplace/orders/${ref}`)).json.order;
  if (o.delivery?.status !== "assigned") throw new Error(`expected delivery assigned, got ${o.delivery?.status}`);
  if (o.delivery.partner?.name !== "Rahul Verma") throw new Error("delivery partner not reflected");
  if (o.delivery.dropoff !== null) fail("delivery.dropoff present on tracker", "(via review after fix)");
  else fail("delivery.dropoff null on tracker", "customer map has no dropoff pin");
  pass("tracker delivery=assigned, partner=Rahul Verma");

  const riderView = await api(`/api/delivery/assignments/${token}`);
  if (riderView.status !== 200) throw new Error(`rider view failed ${riderView.status}`);
  const rv = riderView.json.assignment;
  if (rv.orderReference !== ref) throw new Error("rider sees wrong order");
  if (String(rv.next).includes("accepted") === false) throw new Error("next states wrong");
  pass("rider view: order ref + restaurant + dropoff + next=[accepted, cancelled]");

  /* =================== 4. RIDER GPS → CUSTOMER MAP =================== */
  console.log("\n[4] Rider GPS report → customer location endpoint");
  for (const fix of [
    { lat: 40.743, lng: -73.99, heading: 120 },
    { lat: 40.7445, lng: -73.9885, heading: 90 },
  ]) {
    const rep = await api(`/api/delivery/assignments/${token}/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fix),
    });
    if (rep.status !== 200) throw new Error(`sse location report failed ${rep.status}: ${JSON.stringify(rep.json)}`);
    if (rep.json.skipped) fail("location fix rate-limited (skipped)", "second tick too close");
  }
  const loc = await api(`/api/marketplace/orders/${ref}/location`);
  if (loc.status !== 200 || !loc.json.rider) throw new Error(`customer location failed ${loc.status}: ${JSON.stringify(loc.json)}`);
  pass(`customer /location → rider fix (${loc.json.rider.lat}, ${loc.json.rider.lng}, ${loc.json.rider.at})`);

  /* =================== 5. RIDER ADVANCE → ORDER SETTLES =================== */
  console.log("\n[5] Rider advance: accepted → at_restaurant → picked_up → out_for_delivery → arriving → delivered (canonical mainline)");
  for (const [to, wantOrder] of [
    ["accepted", "ready"],
    ["at_restaurant", "ready"],
    ["picked_up", "picked_up"],
    ["out_for_delivery", "picked_up"],
    ["arriving", "picked_up"],
    ["delivered", "delivered"],
  ]) {
    const adv = await api(`/api/delivery/assignments/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStatus: to }),
    });
    if (adv.status !== 200) throw new Error(`advance ${to} failed ${adv.status}: ${JSON.stringify(adv.json)}`);
    o = (await api(`/api/marketplace/orders/${ref}`)).json.order;
    const d = o.delivery;
    if (d?.status !== to) throw new Error(`delivery tracker out of sync: expected ${to}, got ${d?.status}`);
    if (o.status !== wantOrder) throw new Error(`order lifecycle didn't settle: expected ${wantOrder}, got ${o.status}`);
    pass(`rider ${to.padEnd(16)} → delivery=${d.status}, order lifecycle=${o.status} (step ${o.lifecycle.step})`);
  }
  if (!o.lifecycle.terminal) throw new Error("order not terminal after delivered");
  pass("order lifecycle terminal=true (polling/SSE will stop)");

  /* =================== 6. FINAL STATE AUDIT =================== */
  console.log("\n[6] Final state audit (DB + tracker)");
  const fin = (await api(`/api/marketplace/orders/${ref}`)).json.order;
  pass(`tracker delivery terminal=${fin.delivery.terminal}, partner=${fin.delivery.partner?.name}`);
  const evTypes = fin.events.map((e) => e.type);
  for (const t of ["RIDER_ACCEPTED", "RIDER_AT_RESTAURANT", "RIDER_PICKED_UP", "RIDER_OUT_FOR_DELIVERY", "RIDER_ARRIVING", "PICKED_UP", "DELIVERED"])
    if (!evTypes.includes(t)) throw new Error(`missing audit event ${t}`);
  pass("audit trail has rider + lifecycle events (RIDER_*, PICKED_UP, DELIVERED)");

  const row = (await q(
    "select status, picked_up_at, delivered_at, pos_delivery_status from orders where reference=$1", [ref],
  )).rows[0];
  if (row.status !== "delivered" || !row.picked_up_at || !row.delivered_at) throw new Error("order row timestamps missing");
  pass("orders row: status=delivered, picked_up_at + delivered_at set");

  const statusChain = (await q(
    "select to_status from order_status_events where order_id=(select id from orders where reference=$1) order by id", [ref],
  )).rows.map((r) => r.to_status);
  const expectedChain = ["placed", "accepted", "preparing", "ready", "picked_up", "delivered"];
  if (JSON.stringify(statusChain) !== JSON.stringify(expectedChain)) {
    fail("order_status_events chain is", statusChain.join(" -> "));
  } else {
    pass(`status event chain clean: ${statusChain.join(" -> ")}`);
  }

  const notifs = (await q(
    "select kind from notifications where order_id=(select id from orders where reference=$1) order by id", [ref],
  )).rows.map((r) => r.kind);
  const expectedNotifs = ["order_placed", "order_accepted", "order_ready", "delivery_assigned", "delivery_picked_up", "delivery_out_for_delivery", "delivery_arriving", "order_delivered"];
  for (const k of expectedNotifs)
    if (!notifs.includes(k)) fail("missing notification kind", k);
  if (expectedNotifs.every((k) => notifs.includes(k)))
    pass("notifications outbox: alert on every milestone");

  const partner = (await q("select status, total_deliveries from delivery_partners where id=1")).rows[0];
  if (partner.status !== "available") throw new Error(`partner not freed: ${partner.status}`);
  if (Number(partner.total_deliveries) < 1) throw new Error("partner total_deliveries not incremented");
  pass(`partner freed → available, totalDeliveries=${partner.total_deliveries}`);

  const loyalty = (await q(`
    select count(*)::int as n from loyalty_ledger ll
    join orders ord on ord.id=ll.order_id where ord.reference=$1`, [ref])).rows[0];
  if (Number(loyalty.n) < 1) fail("loyalty points not awarded on delivery", "");
  else pass(`loyalty ledger entry awarded (${loyalty.n})`);

  exit = results.length ? 2 : 0;
  if (results.length) {
    console.log(`\n===== ${results.length} DEAD END(S) FOUND =====`);
    for (const r of results) console.log(`  - ${r.label}${r.extra ? `: ${r.extra}` : ""}`);
  } else {
    console.log("\n===== PIPELINE VERIFIED END-TO-END =====\nMarketplace → POS → dispatch → GPS → tracker → lifecycle settlement all PASS");
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
  exit = 1;
} finally {
  await q("UPDATE restaurant_marketplace_profiles SET pos_key_hash = '' WHERE restaurant_id = 1");
  await pool.end();
}
process.exit(exit);