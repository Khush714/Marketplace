import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { menuItems, orders, restaurants } from "@/db/schema";
import { discoverableRestaurant } from "@/lib/discoverability";
import {
  DEFAULT_DISH_IMAGE,
  LOCALITIES,
  sanitizeImageUrl,
  type Locality,
} from "@/lib/domain";
import {
  POPULARITY_AGGREGATE_LIMIT,
  POPULARITY_COD_PAYMENT_METHODS,
  POPULARITY_EXCLUDED_ORDER_STATUSES,
  POPULARITY_EXCLUDED_PAYMENT_STATUSES,
  POPULARITY_FULFILLED_STATUSES,
  POPULARITY_PAID_PAYMENT_STATUS,
  POPULARITY_WINDOW_DAYS,
  selectPublicPopularity,
} from "@/lib/public-popularity";
import type { PublicPopularityDto } from "@/lib/types";

type AggregateRow = {
  itemId: string | number;
  name: string | null;
  imageUrl: string | null;
  priceCents: string | number | null;
  isVeg: boolean | string | null;
  restaurantSlug: string | null;
  restaurantName: string | null;
  locality: string | null;
  orderCount: string | number;
  unitsSold: string | number;
};

function sqlList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/**
 * Public, locality-aware dish popularity from first-party orders only.
 *
 * The eligibility policy lives in `lib/public-popularity.ts` and is imported
 * here so the SQL cannot silently drift from the tested rules: paid or COD,
 * fulfilled on either the Merchant App or POS lifecycle, never cancelled,
 * rejected, failed or refunded, inside a rolling 30-day window. Items are the
 * immutable order snapshots, so a renamed menu row still reports what the
 * customer bought; the join to the live menu row is what makes the card
 * orderable and stops hidden/closed kitchens from occupying a public rail.
 */
export async function getPublicPopularity(locality: Locality): Promise<PublicPopularityDto> {
  const cityLocalities = LOCALITIES.filter((l) => l.city === locality.city).map((l) => l.name);
  const empty = () =>
    selectPublicPopularity([], {
      locality: locality.name,
      city: locality.city,
      cityLocalities,
    });
  if (!cityLocalities.length) return empty();

  const fulfilled = sqlList(POPULARITY_FULFILLED_STATUSES);
  const excludedStatuses = sqlList(POPULARITY_EXCLUDED_ORDER_STATUSES);
  const excludedPayments = sqlList(POPULARITY_EXCLUDED_PAYMENT_STATUSES);
  const codMethods = sqlList(POPULARITY_COD_PAYMENT_METHODS);

  const eligibleOrder = sql`
    o.created_at >= now() - (${POPULARITY_WINDOW_DAYS}::text || ' days')::interval
    AND (
      (o.merchant_managed = true AND upper(o.merchant_status) in (${fulfilled}))
      OR (o.pos_connected = true AND upper(o.integration_status) in (${fulfilled}))
    )
    AND upper(o.merchant_status) not in (${excludedStatuses})
    AND upper(o.integration_status) not in (${excludedStatuses})
    AND upper(coalesce(o.pos_delivery_status, 'PENDING')) <> 'FAILED'
    AND (
      upper(o.payment_status) = ${POPULARITY_PAID_PAYMENT_STATUS}
      OR lower(coalesce(o.payment_method, '')) in (${codMethods})
    )
    AND upper(o.payment_status) not in (${excludedPayments})
  `;

  const result = await db.execute(sql`
    with recent_order_items as (
      select
        o.id as order_id,
        o.restaurant_id as restaurant_id,
        case when item.value->>'menuItemId' ~ '^[0-9]+$'
          then (item.value->>'menuItemId')::int end as item_id,
        case when item.value->>'quantity' ~ '^[0-9]+$'
          then least((item.value->>'quantity')::int, 100) else 0 end as quantity
      from orders o
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
      ) as item(value)
      where ${eligibleOrder}
    )
    select
      menu_items.id as "itemId",
      menu_items.name as "name",
      menu_items.image_url as "imageUrl",
      menu_items.price_cents as "priceCents",
      menu_items.is_veg as "isVeg",
      restaurants.slug as "restaurantSlug",
      restaurants.name as "restaurantName",
      restaurants.locality as "locality",
      count(distinct recent_order_items.order_id)::int as "orderCount",
      sum(recent_order_items.quantity)::int as "unitsSold"
    from recent_order_items
    inner join menu_items on menu_items.id = recent_order_items.item_id
    inner join restaurants on restaurants.id = recent_order_items.restaurant_id
    where ${and(
      discoverableRestaurant,
      eq(menuItems.available, true),
      inArray(restaurants.locality, cityLocalities),
      sql`recent_order_items.quantity > 0`,
    )}
    group by 1, 2, 3, 4, 5, 6, 7, 8
    order by "orderCount" desc, "unitsSold" desc, lower(menu_items.name) asc
    limit ${POPULARITY_AGGREGATE_LIMIT}
  `);

  const rows = (result.rows ?? []) as unknown as AggregateRow[];
  return selectPublicPopularity(
    rows.map((row) => ({
      id: Number(row.itemId),
      name: String(row.name ?? ""),
      imageUrl: sanitizeImageUrl(String(row.imageUrl ?? ""), DEFAULT_DISH_IMAGE),
      priceCents: Number(row.priceCents ?? 0),
      isVeg: row.isVeg === true || row.isVeg === "t",
      restaurantSlug: String(row.restaurantSlug ?? ""),
      restaurantName: String(row.restaurantName ?? ""),
      locality: String(row.locality ?? ""),
      orderCount: Number(row.orderCount ?? 0),
      unitsSold: Number(row.unitsSold ?? 0),
    })),
    { locality: locality.name, city: locality.city, cityLocalities },
  );
}
