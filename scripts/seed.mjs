/**
 * PHASE 25 — launch seed.
 * Adds 3 more restaurants (to reach 10), a handful of synthetic customers
 * (to demonstrate the 100-customer milestone), and locates + offers them.
 * Idempotent: skips restaurants that already exist.
 */
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
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

  const {
    rows: [made],
  } = await q(`SELECT count(*)::int AS r FROM restaurants`);
  const {
    rows: [cust],
  } = await q(`SELECT count(*)::int AS c FROM customers`);
  console.log(`Launch seed: ${added} restaurants added → ${made.r} total; ${cust.c} customers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
