import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { restaurants } from "@/db/schema";

/**
 * SQL twin of `isWithinMerchantHours` in lib/merchant-hours.ts.
 *
 * Checkout uses the JS helper to refuse an order outside published hours, so the
 * "Open now" browse filter has to make the same decision on the same clock —
 * Asia/Kolkata, HH:MM strings, and an overnight range that wraps midnight.
 * Invalid or equal times are treated as closed, exactly as the helper does.
 * Closures and leave days are already handled by `discoverableRestaurant`.
 */
function withinMerchantHoursSql(): SQL {
  return sql`
    (
      ${restaurants.merchantHoursEnabled} = false
      OR (
        ${restaurants.merchantOpensAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND ${restaurants.merchantClosesAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND ${restaurants.merchantOpensAt} <> ${restaurants.merchantClosesAt}
        AND (
          (
            ${restaurants.merchantOpensAt} < ${restaurants.merchantClosesAt}
            AND to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') >= ${restaurants.merchantOpensAt}
            AND to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') < ${restaurants.merchantClosesAt}
          )
          OR (
            ${restaurants.merchantOpensAt} > ${restaurants.merchantClosesAt}
            AND (
              to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') >= ${restaurants.merchantOpensAt}
              OR to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') < ${restaurants.merchantClosesAt}
            )
          )
        )
      )
    )
  `;
}

/** The same "open" test checkout enforces, usable as a browse WHERE clause. */
export const openNowSql = withinMerchantHoursSql();

/**
 * Delivery is a Merchant App setting layered on top of open hours. It is not a
 * claim about POS readiness — that is checkout's own gate, and browse listings
 * deliberately remain visible for kitchens without a connected POS.
 */
export const deliveryAvailableSql = sql`
  ${restaurants.merchantDeliveryEnabled} = true AND ${withinMerchantHoursSql()}
`;
