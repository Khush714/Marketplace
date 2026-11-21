import "server-only";

import { and, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import {
  merchantItemAnalyticsDto,
  type MerchantItemAnalytics,
} from "@/lib/merchant-item-analytics";
import type { MerchantRevenueRange } from "@/lib/merchant-revenue";

type AggregateRow = {
  itemId: string | null;
  name: string | null;
  unitsSold: string | number;
  grossSales: string | number;
  orders: string | number;
};

/**
 * Marketplace-owned item sales, scoped entirely by the token's restaurant id.
 *
 * Order items are an immutable JSONB snapshot, so deleted or renamed menu items
 * still report under the name the customer actually ordered. Modifier charges
 * follow `orderItemLineTotalCents`: base × qty plus one modifier charge per line.
 */
export async function getMerchantItemAnalytics(
  restaurantId: number,
  range: MerchantRevenueRange,
): Promise<MerchantItemAnalytics> {
  const filters: SQL[] = [
    sql`o.restaurant_id = ${restaurantId}`,
    sql`o.merchant_managed = true`,
    sql`o.merchant_status in ('COMPLETED', 'DELIVERED')`,
    sql`(o.payment_method = 'cod' or o.payment_status = 'PAID')`,
  ];
  if (range.fromDate) filters.push(sql`o.merchant_status_updated_at >= ${range.fromDate}`);
  if (range.toExclusive) filters.push(sql`o.merchant_status_updated_at < ${range.toExclusive}`);

  const quantity = sql`coalesce((item.value->>'quantity')::int, 0)`;
  const price = sql`coalesce((item.value->>'priceCents')::int, 0)`;
  const modifiers = sql`coalesce((
    select sum(coalesce((mod.value->>'priceCents')::int, 0) * coalesce((mod.value->>'quantity')::int, 0))
    from jsonb_array_elements(coalesce(item.value->'modifiers', '[]'::jsonb)) as mod(value)
  ), 0)`;
  const lineTotal = sql`(${price} * ${quantity}) + ${modifiers}`;

  const result = await db.execute(sql`
    select
      item.value->>'menuItemId' as "itemId",
      item.value->>'name' as "name",
      sum(${quantity})::bigint as "unitsSold",
      sum(${lineTotal})::bigint as "grossSales",
      count(distinct o.id)::int as "orders"
    from ${orders} o
    cross join lateral jsonb_array_elements(o.items) as item(value)
    where ${and(...filters)}
    group by 1, 2
    order by "grossSales" desc, "name" asc
    limit 100
  `);

  const rows = (result.rows ?? []) as unknown as AggregateRow[];
  return merchantItemAnalyticsDto(range, rows.map((row) => ({
    itemId: row.itemId,
    name: row.name ?? "",
    unitsSold: Number(row.unitsSold ?? 0),
    grossSales: Number(row.grossSales ?? 0),
    orders: Number(row.orders ?? 0),
  })));
}
