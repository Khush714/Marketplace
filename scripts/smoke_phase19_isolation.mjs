#!/usr/bin/env node
// scripts/smoke_phase19_isolation.mjs
// PHASE 19 — multi-restaurant isolation regression test.
//
// Verifies:
//   1. A POS key for restaurant B cannot transition restaurant A's orders
//   2. A POS key for restaurant B cannot read restaurant A's order events
//   3. An invalid POS key is rejected with 401
//   4. A webhook signed with restaurant B's secret is rejected for A's order
//   5. A valid key can read its own order events
//
// Requires the marketplace server to be running (http://127.0.0.1:3000) and
// a connected PostgreSQL database.
//
// Usage:
//   node scripts/smoke_phase19_isolation.mjs

import { createHash, createHmac, randomBytes } from "node:crypto";
import { Pool } from "pg";

const BASE = process.env.MARKETPLACE_URL ?? "http://127.0.0.1:3000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

function hmac256(secret, ts, body) {
  return createHmac("sha256", secret).update(`${ts}\n${body}`).digest("hex");
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: DB_URL });
const rand = () => randomBytes(8).toString("hex");

async function query(sql, args = []) {
  const { rows } = await pool.query(sql, args);
  return rows;
}

async function main() {
  const suffix = rand();
  const keyA = `pos_isolation_${suffix}_a`;
  const keyB = `pos_isolation_${suffix}_b`;
  const secretA = randomBytes(24).toString("hex");
  const secretB = randomBytes(24).toString("hex");
  const refA = `MKT-ISO-${suffix.toUpperCase()}`;

  let idA, idB, keyHashA, keyHashB;

  try {
    console.log("[isolation] Creating test restaurants …");

    // Restaurant A
    const [a] = await query(
      `INSERT INTO restaurants (name, slug, marketplace_id, cuisine, address, phone, is_open, tax_rate)
       VALUES ($1, $2, $3, 'Italian', '123 Main', '555-0100', true, 0)
       RETURNING id`,
      [`IsolationA-${suffix}`, `isolation-a-${suffix}`, `rst_iso_a_${suffix}`],
    );
    idA = a.id;

    const hashA = sha256(keyA);
    keyHashA = hashA;

    await query(
      `INSERT INTO restaurant_marketplace_profiles (restaurant_id, is_listed, marketplace_status, accept_online_orders, pos_key_hash)
       VALUES ($1, false, 'draft', true, $2)`,
      [idA, hashA],
    );

    await query(
      `INSERT INTO restaurant_integrations (restaurant_id, provider, status, webhook_secret, endpoint_url)
       VALUES ($1, 'manual', 'connected', $2, 'http://fakepos-a.example.com')`,
      [idA, secretA],
    );

    // Restaurant B
    const [b] = await query(
      `INSERT INTO restaurants (name, slug, marketplace_id, cuisine, address, phone, is_open, tax_rate)
       VALUES ($1, $2, $3, 'Indian', '456 Side', '555-0200', true, 0)
       RETURNING id`,
      [`IsolationB-${suffix}`, `isolation-b-${suffix}`, `rst_iso_b_${suffix}`],
    );
    idB = b.id;

    const hashB = sha256(keyB);
    keyHashB = hashB;

    await query(
      `INSERT INTO restaurant_marketplace_profiles (restaurant_id, is_listed, marketplace_status, accept_online_orders, pos_key_hash)
       VALUES ($1, false, 'draft', true, $2)`,
      [idB, hashB],
    );

    await query(
      `INSERT INTO restaurant_integrations (restaurant_id, provider, status, webhook_secret, endpoint_url)
       VALUES ($1, 'manual', 'connected', $2, 'http://fakepos-b.example.com')`,
      [idB, secretB],
    );

    // Insert a test order for restaurant A
    await query(
      `INSERT INTO orders (reference, restaurant_id, customer_name, customer_phone, customer_address,
                           channel, fulfillment_type, status, payment_method, payment_status,
                           subtotal, tax_amount, total)
       VALUES ($1, $2, 'Test User', '555-0199', '100 Test Ln',
               'marketplace', 'delivery', 'placed', 'cash', 'unpaid',
               '10.00', '0.00', '10.00')`,
      [refA, idA],
    );

    console.log(
      `[isolation] Restaurants: A=${idA}, B=${idB}.  Order=${refA}.\n`,
    );

    // ── Test 1: Cross-restaurant transition (B → A's order) ─────────────
    console.log("[test 1] POS key B transitions A's order → expect 404");
    {
      const url = `${BASE}/api/pos/orders/${encodeURIComponent(refA)}/transition?key=${keyB}&to=accepted`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "cross-tenant attempt" }),
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    }

    // ── Test 2: Cross-restaurant events (B → A's order) ─────────────────
    console.log("[test 2] POS key B reads A's order events → expect 404");
    {
      const url = `${BASE}/api/pos/orders/${encodeURIComponent(refA)}/events?key=${keyB}`;
      const res = await fetch(url);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    }

    // ── Test 3: Invalid key → 401 ──────────────────────────────────────
    console.log("[test 3] Invalid POS key → expect 401");
    {
      const url = `${BASE}/api/pos/orders/${encodeURIComponent(refA)}/events?key=pos_no_such_key`;
      const res = await fetch(url);
      assert(res.status === 401, `Expected 401, got ${res.status}`);
    }

    // ── Test 4: Webhook signed with B's secret for A's order → 401 ─────
    console.log("[test 4] Webhook with B's secret for A's order → expect 401");
    {
      const payload = JSON.stringify({
        event_id: `isolation_${suffix}_${Date.now()}`,
        event: "order.status_changed",
        restaurant_id: `rst_iso_a_${suffix}`,
        order_id: refA,
        status: "accepted",
      });
      const ts = String(Date.now());
      const sig = hmac256(secretB, ts, payload); // wrong secret
      const res = await fetch(`${BASE}/api/integrations/webhooks/restaurantai`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-restaurantai-signature": sig,
          "x-restaurantai-timestamp": ts,
        },
        body: payload,
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
    }

    // ── Test 5: Valid key reads its own order events ────────────────────
    console.log("[test 5] POS key A reads A's order events → expect 200");
    {
      const url = `${BASE}/api/pos/orders/${encodeURIComponent(refA)}/events?key=${keyA}`;
      const res = await fetch(url);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.order?.reference === refA, `Reference matches (${body.order?.reference})`);
    }

    // ── Test 6: Webhook signed with A's secret (correct) ────────────────
    console.log("[test 6] Webhook with A's secret for A's order → expect 200");
    {
      const eventId = `isolation_ok_${suffix}_${Date.now()}`;
      const payload = JSON.stringify({
        event_id: eventId,
        event: "health.ping",
        restaurant_id: `rst_iso_a_${suffix}`,
      });
      const ts = String(Date.now());
      const sig = hmac256(secretA, ts, payload);
      const res = await fetch(`${BASE}/api/integrations/webhooks/restaurantai`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-restaurantai-signature": sig,
          "x-restaurantai-timestamp": ts,
        },
        body: payload,
      });
      const body = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(body.ok === true, `Webhook ok=true (got ${body.ok})`);
    }
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────
    console.log("\n[isolation] Cleaning up test data …");
    try {
      if (idA) await query(`DELETE FROM orders WHERE restaurant_id = $1`, [idA]);
      if (idA) await query(`DELETE FROM restaurant_integrations WHERE restaurant_id = $1`, [idA]);
      if (idA) await query(`DELETE FROM restaurant_marketplace_profiles WHERE restaurant_id = $1`, [idA]);
      if (idA) await query(`DELETE FROM restaurants WHERE id = $1`, [idA]);
      if (idB) await query(`DELETE FROM restaurant_integrations WHERE restaurant_id = $1`, [idB]);
      if (idB) await query(`DELETE FROM restaurant_marketplace_profiles WHERE restaurant_id = $1`, [idB]);
      if (idB) await query(`DELETE FROM restaurants WHERE id = $1`, [idB]);
    } catch (e) {
      console.error("[isolation] Cleanup error:", e.message);
    }
    await pool.end();

    console.log(`\n[isolation] ${passed} passed, ${failed} failed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
}

main().catch((e) => {
  console.error("[isolation] Fatal:", e);
  pool.end().finally(() => process.exit(1));
});
