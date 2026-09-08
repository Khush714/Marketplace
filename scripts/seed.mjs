/**
 * PHASE 25 — launch seed.
 * Adds 3 more restaurants (to reach 10), a handful of synthetic customers
 * (to demonstrate the 100-customer milestone), and locates + offers them.
 * Idempotent: skips restaurants that already exist.
 */
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

// Mirror src/db/index.ts: production / ssl-marked URLs must use TLS, or the
// pooled connection is rejected by managed Postgres (Neon/Supabase/Vercel).
const isTlsRequired =
  process.env.NODE_ENV === "production" ||
  /(?:sslmode|ssl)(?:=|\b)/i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  max: 6,
  connectionTimeoutMillis: 10_000,
  ...(isTlsRequired ? { ssl: { rejectUnauthorized: false } } : {}),
});
const q = (t, p) => pool.query(t, p);

const NEW = [
  {
    slug: "le-bistro-bleu",
    name: "Le Bistro Bleu",
    cuisine: "French",
    priceRange: "$$$",
    description: "Classic Parisian bistro fare in the heart of town.",
    image: "https://images.pexels.com/photos/14966000/pexels-photo-14966000.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    lat: 40.744, lng: -73.989, radius: 9,
    tag: "Coq au vin, duck confit, crème brûlée",
    items: [
      ["Starter", [["Escargots", "Garlic butter snails", 9.5], ["French Onion Soup", "Gruyère crouton", 8.0]]],
      ["Main", [["Coq au Vin", "Braised chicken, red wine", 18.0], ["Duck Confit", "Crispy leg, lentils", 20.0]]],
      ["Dessert", [["Crème Brûlée", "Vanilla bean", 7.5]]],
    ],
  },
  {
    slug: "green-bowl-express",
    name: "Green Bowl Express",
    cuisine: "Healthy",
    priceRange: "$$",
    description: "Veg-first grain bowls, salads and smoothies.",
    image: "https://images.pexels.com/photos/5182122/pexels-photo-5182122.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    lat: 40.731, lng: -73.995, radius: 6,
    tag: "Bowl it, top it, love it",
    items: [
      ["Bowls", [["Harvest Grain Bowl", "Quinoa, roasted veg, tahini", 11.5], ["Mediterranean Bowl", "Falafel, hummus, greens", 12.0]]],
      ["Smoothies", [["Green Machine", "Kale, apple, ginger", 6.0], ["Berry Blast", "Mixed berries, banana", 6.0]]],
    ],
  },
  {
    slug: "oishi-sushi-bar",
    name: "Ōishi Sushi Bar",
    cuisine: "Japanese",
    priceRange: "$$$",
    description: "Omakase-quality sushi, hand-cut daily.",
    image: "https://images.pexels.com/photos/34721557/pexels-photo-34721557.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    lat: 40.737, lng: -73.983, radius: 8,
    tag: "Fresh cut every morning",
    items: [
      ["Nigiri", [["Otoro", "Fatty tuna belly", 7.0], ["Uni", "Sea urchin", 8.0]]],
      ["Rolls", [["Rainbow Roll", "Assorted fish, avocado", 14.5], ["Spicy Tuna", "Chili mayo, scallion", 12.0]]],
    ],
  },
];

const CUSTOMERS_PER = 120;

/**
 * PHASE 35 — production demo orders. Keeps the exact references the tracking
 * deep-links use (MKT-MAOO8Z62 / MKT-16MS8GWNOWNON) plus one LIVE (placed)
 * order so the polling/LIVE UI has something non-terminal to render on a
 * freshly-seeded environment. Idempotent: any reference already present is
 * skipped.
 */
const DEMO_ORDERS = [
  {
    reference: "MKT-MAOO8Z62",
    customerPhone: "+15550141011",
    customerName: "E2E Tester",
    customerAddress: "41 W 14th St, New York, NY",
    fulfillment: "pickup",
    status: "completed",
    paymentMethod: "cash",
    paymentStatus: "unpaid",
    subtotal: "27.50",
    tax: "2.20",
    discount: "0",
    discountCode: null,
    deliveryFee: "0",
    total: "29.70",
    items: [
      ["Margherita Pizza", 26.5, 2],
      ["Coca-Cola", 1.0, 1],
    ],
    // [toStatus, minutesAgo, actor]
    timeline: [
      ["placed", 40, "system"],
      ["accepted", 32, "pos"],
      ["preparing", 25, "pos"],
      ["ready", 10, "pos"],
      ["completed", 5, "pos"],
    ],
  },
  {
    reference: "MKT-16MS8GWNOWNON",
    customerPhone: "+15550141012",
    customerName: "E2E Customer",
    customerAddress: "88 Bleecker St, New York, NY",
    fulfillment: "delivery",
    status: "completed",
    paymentMethod: "cash",
    paymentStatus: "unpaid",
    subtotal: "20.50",
    tax: "1.64",
    discount: "0",
    discountCode: null,
    deliveryFee: "2.99",
    total: "25.13",
    items: [
      ["Spaghetti Carbonara", 14.0, 1],
      ["Tiramisu", 6.5, 1],
    ],
    timeline: [
      ["placed", 55, "system"],
      ["accepted", 48, "pos"],
      ["preparing", 40, "pos"],
      ["ready", 25, "pos"],
      ["completed", 18, "pos"],
    ],
  },
  {
    reference: "MKT-DEMO-LIVE",
    customerPhone: "+15550141011",
    customerName: "E2E Tester",
    customerAddress: "41 W 14th St, New York, NY",
    fulfillment: "pickup",
    status: "placed",
    paymentMethod: "cash",
    paymentStatus: "unpaid",
    subtotal: "12.50",
    tax: "1.00",
    discount: "0",
    discountCode: null,
    deliveryFee: "0",
    total: "13.50",
    items: [["Margherita Pizza", 12.5, 1]],
    timeline: [["placed", 1, "system"]],
  },
];

async function ensureCustomer(name, phone) {
  const { rows } = await q(
    `SELECT id FROM customers WHERE phone=$1 OR name=$1`,
    [phone],
  );
  if (rows[0]) return rows[0].id;
  const ins = await q(
    `INSERT INTO customers (name, phone) VALUES ($1,$2) RETURNING id`,
    [name, phone],
  );
  return ins.rows[0].id;
}

/** Insert a demo order + its items + its status-event trail (skip if present). */
async function ensureOrder(def, restaurantId) {
  const { rows } = await q(`SELECT id FROM orders WHERE reference=$1`, [
    def.reference,
  ]);
  if (rows[0]) return;

  const now = Date.now();
  const at = (minsAgo) => new Date(now - minsAgo * 60_000);
  const events = def.timeline.map(([toStatus, minsAgo, actor]) => ({
    toStatus,
    at: at(minsAgo),
    actor,
  }));
  const created = events[0].at;
  const last = events[events.length - 1];
  const cap = (s) => (s?.toStatus === "completed" ? last.at : null);
  const accepted = events.find((e) => e.toStatus === "accepted")?.at ?? null;
  const ready = events.find((e) => e.toStatus === "ready")?.at ?? null;
  const cancelled = events.find((e) => e.toStatus === "cancelled")?.at ?? null;

  const ins = await q(
    `INSERT INTO orders
      (reference, restaurant_id, customer_id, customer_name, customer_phone,
       customer_address, channel, fulfillment_type, status, payment_method,
       payment_status, subtotal, tax_amount, discount_code, discount_amount,
       delivery_fee, total, notes, status_updated_at, accepted_at, ready_at,
       completed_at, cancelled_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'marketplace',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'',$17,$18,$19,$20,$21,$22)
     RETURNING id`,
    [
      def.reference,
      restaurantId,
      def.customerId,
      def.customerName,
      def.customerPhone,
      def.customerAddress,
      def.fulfillment,
      def.status,
      def.paymentMethod,
      def.paymentStatus,
      def.subtotal,
      def.tax,
      def.discountCode,
      def.discount,
      def.deliveryFee,
      def.total,
      last.at,
      accepted,
      ready,
      cap({ toStatus: def.status === "completed" ? "completed" : null }),
      cancelled,
      created,
    ],
  );
  const orderId = ins.rows[0].id;

  for (const [name, unitPrice, quantity] of def.items) {
    await q(
      `INSERT INTO order_items (order_id, menu_item_id, name, unit_price, quantity, modifiers)
       VALUES ($1,NULL,$2,$3,$4,'[]')`,
      [orderId, name, unitPrice, quantity],
    );
  }

  let from = null;
  for (const { toStatus, at: when, actor } of events) {
    await q(
      `INSERT INTO order_status_events (order_id, from_status, to_status, actor, note, created_at)
       VALUES ($1,$2,$3,$4,'',$5)`,
      [orderId, from, toStatus, actor, when],
    );
    from = toStatus;
  }
}

async function seedOrders() {
  const {
    rows: [restaurant],
  } = await q(`SELECT id FROM restaurants ORDER BY id LIMIT 1`);
  if (!restaurant) {
    console.log("Demo orders skipped: no restaurants seeded yet.");
    return;
  }
  for (const def of DEMO_ORDERS) {
    def.customerId = await ensureCustomer(def.customerName, def.customerPhone);
    await ensureOrder(def, restaurant.id);
  }
}

/**
 * PHASE 35 — marketplace activation. A restaurant is consumer-visible only when
 * its profile is is_listed=true AND marketplace_status='live'. Pre-existing
 * rows (e.g. a DB seeded before listing existed) are often draft/hidden, which
 * makes the marketplace browse list empty. This idempotent pass guarantees
 * every restaurant has a live, listed profile.
 */
async function activateMarketplace() {
  const { rows } = await q(`SELECT id, slug FROM restaurants`);
  for (const r of rows) {
    const menuUrl = `https://pos.example.com/order/${r.slug}`;
    await q(
      `INSERT INTO restaurant_marketplace_profiles
         (restaurant_id, is_listed, marketplace_status, is_featured, tagline,
          menu_url, pos_key_hash, accept_online_orders, accept_delivery,
          accept_pickup, delivery_fee, min_order, eta_minutes,
          pickup_eta_minutes, commission_rate, listed_at, updated_at)
       VALUES ($1,true,'live',false,'',$2,'',true,true,true,2.99,15,30,15,12.00,now(),now())
       ON CONFLICT (restaurant_id) DO UPDATE SET
         is_listed = true,
         marketplace_status = 'live',
         menu_url = COALESCE(restaurant_marketplace_profiles.menu_url, $2),
         listed_at = COALESCE(restaurant_marketplace_profiles.listed_at, now()),
         updated_at = now()`,
      [r.id, menuUrl],
    );
  }
}

async function main() {
  let added = 0;
  for (const r of NEW) {
    const { rows } = await q(`SELECT id FROM restaurants WHERE slug=$1`, [r.slug]);
    if (rows[0]) continue;

    const ins = await q(
      `INSERT INTO restaurants (name, slug, cuisine, description, address, image_url, price_range, is_open, tax_rate, lat, lng, delivery_radius_km)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,0.08,$8,$9,$10) RETURNING id`,
      [r.name, r.slug, r.cuisine, r.description, `${r.name} address`, r.image, r.priceRange, r.lat, r.lng, r.radius],
    );
    const rid = ins.rows[0].id;

    await q(
      `INSERT INTO restaurant_marketplace_profiles
        (restaurant_id, is_listed, marketplace_status, is_featured, tagline, menu_url, accept_online_orders, accept_delivery, accept_pickup, delivery_fee, min_order, eta_minutes, pickup_eta_minutes, listed_at)
       VALUES ($1,true,'live',true,$2,$3,true,true,true,2.99,15,30,15,now())`,
      [rid, r.tag, `https://pos.example.com/order/${r.slug}`],
    );

    let sort = 0;
    for (const [cat, items] of r.items) {
      const c = await q(
        `INSERT INTO categories (restaurant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id`,
        [rid, cat, sort++],
      );
      for (const [name, desc, price] of items) {
        await q(
          `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, is_available)
           VALUES ($1,$2,$3,$4,$5,true)`,
          [rid, c.rows[0].id, name, desc, price],
        );
      }
    }

    // A public offer for each new restaurant.
    await q(
      `INSERT INTO discounts (restaurant_id, code, kind, value, min_subtotal, is_public, title)
       VALUES ($1,'LAUNCH10','percent',10,0,true,'Launch 10% OFF')`,
      [rid],
    );
    added++;
  }

  // Top up synthetic customers toward the 100 milestone.
  const { rows: countRows } = await q(`SELECT count(*)::int AS c FROM customers`);
  const current = countRows[0].c;
  const target = 100;
  if (current < target) {
    const need = Math.min(target - current, CUSTOMERS_PER);
    for (let i = 0; i < need; i++) {
      const n = current + i + 1;
      await q(
        `INSERT INTO customers (name, phone) VALUES ($1,$2) ON CONFLICT (phone) DO NOTHING`,
        [`Launch Patron ${n}`, `+1 555 010 ${String(n).padStart(3, "0")}`],
      );
    }
  }

  await seedOrders();
await activateMarketplace();

  const {
    rows: [made],
  } = await q(`SELECT count(*)::int AS r FROM restaurants`);
  const {
    rows: [cust],
  } = await q(`SELECT count(*)::int AS c FROM customers`);
  const {
    rows: [ord],
  } = await q(`SELECT count(*)::int AS o FROM orders`);
  console.log(`Launch seed: ${added} restaurants added → ${made.r} total; ${cust.c} customers; ${ord.o} orders.`);
}

main()
  .catch((e) => {
    // A deploy-time build hook should not hard-fail a deploy just because the
    // DB was unreachable — unless seeding was explicitly requested by setting
    // DATABASE_URL, in which case we surface the failure loudly.
    if (process.env.DATABASE_URL) {
      console.error(e);
      process.exitCode = 1;
    } else {
      console.warn(`Seed skipped (unable to connect, no DATABASE_URL set): ${e.message}`);
    }
  })
  .finally(() => pool.end());
