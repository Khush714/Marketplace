import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    // Schema changes are DDL, so prefer the owner credential — the restricted
    // `marketplace_app` role the app runs as (Phase 10, 10.1) cannot create or
    // alter tables. Falls back to DATABASE_URL for single-role dev setups.
    url: process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});