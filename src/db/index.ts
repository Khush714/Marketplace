import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/**
 * Connection budget.
 *
 * This pool had no `max`, so every process took pg's default of 10 connections.
 * Against a Supabase **session-mode** pooler the whole project shares a hard
 * quota (15 per pooler user), so the Marketplace, the POS, and any extra local
 * instance of this app could together request 30 and blow the cap. The
 * resulting `EMAXCONNSESSION` stalls every DB-backed request for 10+ seconds,
 * which the POS experiences as the Marketplace being unreachable.
 *
 * The Marketplace is the CLIENT here — the POS is the server it depends on — so
 * it must yield connections and keep its own footprint small. Prefer the
 * transaction-mode pooler (port 6543), which has no per-client cap, and use
 * these knobs to stay inside the session-mode quota when you cannot.
 */
const poolMax = Number(process.env.PGPOOL_MAX) || 5;

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    // Never let a query hold a slot past the POS's patience: a slow query here
    // reads as the whole integration being down.
    connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECT_TIMEOUT_MS) || 10_000,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
