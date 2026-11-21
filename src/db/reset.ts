import "dotenv/config";
import { db } from "./index";
import {
  connectionCodes,
  connections,
  integrationAudit,
  integrationRecords,
  integrationSessions,
  menuItems,
  orders,
  restaurants,
} from "./schema";

const CONFIRM_TOKEN = "--confirm";

function refuse(): never {
  console.error(
    "Refusing to run: this script DESTROYS ALL DATA.\n" +
      "Pass '--confirm' to acknowledge, and never run against a production database.",
  );
  process.exit(1);
}

if (!process.argv.includes(CONFIRM_TOKEN)) refuse();
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production.");
  process.exit(1);
}

/** Empties all tables (FK-safe order) so drizzle-kit push never needs a truncate prompt. */
async function reset() {
  await db.delete(integrationSessions);
  await db.delete(integrationAudit);
  await db.delete(integrationRecords);
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