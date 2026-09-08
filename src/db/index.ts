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
  // Serverless (Vercel) workers each own their own pool, so per-worker
  // connections must stay small and idle connections must be released, or a
  // few warm instances exceed the managed pooler cap. Supabase/Neon session
  // mode reports e.g.:
  //   (EMAXCONNSESSION) max clients reached ... limited to pool_size: 15
  // A local `next dev` keeps a single long-lived process, so the 30s idle
  // teardown churn does not apply there — hence the split.
  const serverless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const pool = new Pool({
    connectionString: databaseUrl,
    max: serverless ? 4 : 10,
    // Release idle connections in serverless so a warm instance never hoards
    // clients against the pooler cap. Locally, keep one warm connection to
    // avoid a fresh TCP+auth round trip on every action after idle.
    idleTimeoutMillis: serverless ? 30_000 : 0,
    keepAlive: true,
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
