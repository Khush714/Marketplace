import "server-only";
import { getTableColumns, sql } from "drizzle-orm";
import { orders, restaurants } from "@/db/schema";

/**
 * One review aggregate used by every public listing query. Computing it in SQL
 * keeps browsing, search, detail pages and ranking on the same number instead
 * of hydrating a DTO and sorting a stale copy in the browser.
 */
const reviewedOrders = sql`
  from ${orders}
  where ${orders.restaurantId} = ${restaurants.id}
    and ${orders.feedbackAt} is not null
    and ${orders.rating} is not null
`;

export const reviewRatingSql = sql<number | null>`
  (select avg(${orders.rating})::real ${reviewedOrders})
`;

export const reviewCountSql = sql<number>`
  (select count(*)::int ${reviewedOrders})
`;

export const publicRatingSql = sql<number>`
  case when ${reviewCountSql} > 0 then ${reviewRatingSql} else ${restaurants.rating} end
`;

/** Flat row shape: every restaurant column plus the two public review metrics. */
export const publicRestaurantColumns = {
  ...getTableColumns(restaurants),
  publicRating: publicRatingSql,
  publicRatingCount: reviewCountSql,
};
