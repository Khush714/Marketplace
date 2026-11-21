-- Phase 10 (10.1) — restricted application database role.
--
-- Until now the app and the schema tooling share one credential (DATABASE_URL)
-- that owns every table. This migration splits the two:
--
--   * `marketplace_app` — what the Next.js runtime connects as. It can read and
--     write the application tables and nothing else: no DDL, no role
--     management, no TRUNCATE, no REFERENCES/TRIGGER privileges, and no access
--     to the `schema_migrations` ledger. A leaked DATABASE_URL stops being a
--     full-instance compromise.
--   * The owner credential — kept in MIGRATIONS_DATABASE_URL, used only by
--     `npm run db:migrate` and `npm run db:push` (both fall back to
--     DATABASE_URL when it is unset, so a single-role dev setup still works).
--
-- Passwords are deliberately OUT OF BAND: this file is committed, so it creates
-- the role without one and every statement below is re-runnable. Before
-- switching DATABASE_URL to the new role, run as the owner:
--
--   ALTER ROLE marketplace_app PASSWORD '<random>';
--
-- (On Supabase: run that in the SQL editor.) Then point DATABASE_URL at the
-- app-role connection string and MIGRATIONS_DATABASE_URL at the owner one —
-- see .env.example.
--
-- Run this migration AS THE OWNER: CREATE ROLE requires CREATEROLE, which the
-- application role deliberately does not have.

-- 1. The role. The NO* flags are all Postgres defaults today, spelled out so
-- the intent survives a future default change; LOGIN is the only thing that is
-- actually "on".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app') THEN
    CREATE ROLE marketplace_app LOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- search_path pinned: with CREATE stripped from `public` (Postgres 15+ default)
-- this is belt and braces, but it also stops a mid-session SET search_path from
-- re-pointing unqualified names somewhere unexpected.
ALTER ROLE marketplace_app SET search_path = public;

-- 2. Schema + table privileges. The loop (rather than a static list) keeps the
-- grant correct for tables that exist at apply time; ALTER DEFAULT PRIVILEGES
-- below covers tables created afterwards by `db:push`, so nobody has to
-- remember to re-grant. `schema_migrations` is excluded on purpose: the ledger
-- belongs to the migration runner, and the app has no business reading or
-- rewriting it. The REVOKE before each GRANT makes the end state deterministic
-- even if the role previously held broader grants.
DO $$
DECLARE
  tbl text;
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO marketplace_app', current_database());
  GRANT USAGE ON SCHEMA public TO marketplace_app;

  FOR tbl IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM marketplace_app', tbl);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO marketplace_app', tbl
    );
  END LOOP;
END $$;

-- 3. Sequences: every serial PK needs USAGE (nextval) for the app to insert a
-- row. Excluded from the loop above because pg_tables does not list sequences.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM marketplace_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO marketplace_app;

-- 4. Objects the owner creates later (a `db:push`ed table, a new sequence)
-- inherit the same shape without another migration touching this file.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO marketplace_app;
