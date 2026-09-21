import "dotenv/config";
import { db } from "./index";
import { connectionCodes, connections, menuItems, orders, restaurants } from "./schema";

/** Empties all tables (FK-safe order) so drizzle-kit push never needs a truncate prompt. */
async function reset() {
  await db.delete(orders);
  await db.delete(menuItems);
  await db.delete(connections);
  await db.delete(connectionCodes);
  await db.delete(restaurants);
  console.log("Reset complete.");
  process.exit(0);
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});