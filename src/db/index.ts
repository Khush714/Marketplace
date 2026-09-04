import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const isTlsRequired =
  process.env.NODE_ENV === "production" ||
  /(?:sslmode|ssl)(?:=|\b)/i.test(databaseUrl);

const globalForDb = globalThis as typeof globalThis & {
  __tablzPool?: Pool;
};

function createPool() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(isTlsRequired ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error", err.message);
  });

  return pool;
}

export const pool = globalForDb.__tablzPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__tablzPool = pool;
}

export const db = drizzle(pool);
