# Runbook: Database Backups, Restore and Recovery

Status: Phase 2 (Database & Backup Hardening). Owner: platform on-call. Last
reviewed: 2026-10-09.

This runbook is the operational counterpart to `docs/database-audit.md`. It
defines **what** is backed up, **how often**, **how long it is kept**, **how a
restore is performed and verified**, and the **RPO/RTO** the platform commits to.
The procedure is executable and was proven on 2026-10-09 with
`scripts/db-restore-drill.mjs` (see §7); re-run that drill after any change to the
schema, migration runner, or hosting provider.

---

## 1. What backs up what

PostgreSQL is the **only** state store (see `AGENTS.md`). There is no object store,
no cache, no queue with durable state — losing the database loses the platform.
Therefore:

- The **hosted primary** (currently Supabase; `DATABASE_URL` in `.env` points at
  the `aws-0-ap-southeast-1` pooler) is the system of record.
- The **logical dump** in §3 is the portable, vendor-independent copy. It is the
  restore path that does not depend on a provider's control plane, and it is the
  artifact the drill validates.
- Provider **managed backups / PITR** (if enabled on the plan) are the fast-path
  recovery for the common case (bad migration, accidental delete). They are
  complementary, not a substitute: they are not portable off the provider.

> **Confirm with hosting before relying on it.** Whether Supabase automated
> backups and point-in-time recovery (PITR) are enabled, and their retention
> window, is a **plan-level setting**. This document states the platform's
> required minimum; verify the provider actually meets it and record the result
> here: `Provider backup plan: ______ · Retention: ______ · PITR: ______`.

### 1.1 Credentials

| Variable | Role | Use |
|---|---|---|
| `MIGRATIONS_DATABASE_URL` | owner/admin | schema tools, `pg_dump` |
| `DATABASE_URL` | app (`marketplace_app`) | application runtime only |

Take dumps over the **admin/owner** credential, not the app role — `pg_dump` needs
read access to every table and sequence, which the least-privilege app role does
not (and must not) have. Never log either URL; they are credentials
(`AGENTS.md` rule 5).

---

## 2. Frequency and retention

These are the **minimums**; a provider default that is shorter must be raised.

| Copy | Frequency | Retention | Encrypted at rest | Off-site |
|---|---|---|---|---|
| Logical full dump (`pg_dump -Fc`) | daily | 30 days | yes (see §6) | yes |
| Logical full dump | weekly | 12 weeks | yes | yes |
| Provider automated backup | per plan (target: daily) | 30 days | per provider | per provider |
| Provider PITR (WAL) | continuous (target) | 7 days | per provider | per provider |
| Pre-migration snapshot | before every production migration | until the migration is confirmed good | yes | yes |

A "pre-migration snapshot" means: take a logical dump (§3) **before** applying any
migration to production, and keep it until the change has survived a full business
day. This is the cheapest insurance against a bad `db:migrate`.

---

## 3. Backup procedure (logical)

`pg_dump`/`pg_restore` live under the PostgreSQL install, not on `PATH`. Resolve
the bin directory once per session:

```powershell
$pg = "C:\Program Files\PostgreSQL\17\bin"   # version must be >= the server's
$env:PG_BIN = $pg
```

Take a custom-format dump (compressed, selective-restore capable):

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
& "$pg\pg_dump.exe" -Fc -f "backup-$stamp.dump" $env:MIGRATIONS_DATABASE_URL
```

- `-Fc` (custom format) is deliberate: it allows `pg_restore -t table` selective
  restore and `-j` parallelism, and it is what the drill round-trips.
- Do **not** pass the URL on the command line in a shared shell where it lands in
  history; prefer the environment variable or `PGPASSWORD` + `-h/-U/-d`.
- Verify the dump is non-empty and record its hash:

```powershell
Get-FileHash "backup-$stamp.dump" -Algorithm SHA256
```

The `pg_restore` tool must be **>=** the source server major version; the drill
fails fast otherwise.

---

## 4. Recovery procedure

### 4.1 Fast path — provider PITR / snapshot (preferred for the common case)

1. Declare an incident; freeze writes (put the app in maintenance or scale to 0).
2. Restore the provider's most recent good snapshot / PITR point **onto a new
   instance** — never overwrite the live primary until the restore is verified.
3. Point the app's `DATABASE_URL` at the recovered instance.
4. Verify with §5, then drop the old instance once confirmed.

### 4.2 Portable path — logical dump restore

```powershell
# 1. Restore into a FRESH database, never over the live one.
$admin = "postgresql://postgres:<pw>@127.0.0.1:5432/postgres"
$target = "marketplace_recovered"
& "$pg\psql.exe" $admin -c "create database $target"

# 2. Restore (custom format). --no-owner because the target's role set may differ.
& "$pg\pg_restore.exe" --no-owner --no-privileges --exit-on-error `
    -d "postgresql://postgres:<pw>@127.0.0.1:5432/$target" "backup-<stamp>.dump"

# 3. Verify (see §5), then cut the app over by repointing DATABASE_URL.
```

`--exit-on-error` is intentional: a partial restore that "mostly worked" is worse
than a failed one. Never use `--clean` against the live database.

### 4.3 Schema prerequisite

The 15 files in `src/db/migrations/` are **additive patches** on a base schema that
`drizzle-kit` materialises from `src/db/schema.ts` — there is no base migration
file. A restore from a provider snapshot/PITR or a custom dump carries the base
schema with it, so nothing else is needed. Only when building a database **from
nothing** must you first materialise the base schema (as
`tests/security/harness.ts:790-853` and `scripts/db-restore-drill.mjs` do), then
run `npm run db:migrate`. See `docs/architecture.md` §5.

---

## 5. Post-restore verification (mandatory)

A restore is not done until it is verified. Minimum checks:

1. **Row counts + per-table content checksum** for all 23 public tables match the
   source. The drill computes this as
   `md5(string_agg(md5(row::text), '' ORDER BY row_hash))` per table — order
   independent, so it survives physical reordering.
2. **Schema object counts** match: tables (23), indexes, constraints, foreign
   keys (28), sequences.
3. **Sequences survived**: insert a throwaway restaurant + dependent session and
   confirm it receives the next id (then roll back). A restored sequence stuck at
   1 corrupts every subsequent insert.
4. **Structural integrity**: `pg_amcheck --heapallindexed --parent-check <conn>`
   reports no corruption (requires the `amcheck` extension; the drill installs it
   on the scratch DB).

The drill in §7 automates all four. For a real recovery, run at least 1–3 by hand
before cutting traffic over.

---

## 6. Security of backups

- **Encrypt at rest and in transit.** A logical dump contains every credential
  *hash*, the AES-GCM-wrapped POS webhook secret (`integration_records.webhook_secret`),
  and customer PII (names, phones, addresses in `orders`). Treat a dump as
  top-secret. Store only on encrypted volumes / in a private, access-controlled
  bucket. Never commit a dump, and never leave one in the repo or a shared temp
  dir.
- **Access** is limited to the smallest operator set; every restore is logged
  (who, when, which artifact, which target).
- **Deletion**: expire dumps on the retention schedule (§2) and securely delete
  when an incident closes.
- Backups are **not** run through `lib/security/security-events.ts`; do not paste
  database contents into chat/tickets/logs.

---

## 7. The restore drill

`scripts/db-restore-drill.mjs` proves the §3/§4.2 procedure end-to-end against a
real PostgreSQL, in scratch databases it creates and destroys:

```powershell
node scripts/db-restore-drill.mjs
```

It: creates `marketplace_backup_test`, builds the real schema (drizzle-kit
generate + all migrations), seeds fixtures plus one row per remaining table,
snapshots content, `pg_dump -Fc`, `pg_restore` into `marketplace_restore_test`,
re-snapshots and compares, probes sequences, runs `pg_amcheck`, then drops both
databases. Exit code is `0` on PASS, `1` on any failure.

| Env | Default | Purpose |
|---|---|---|
| `DRILL_ADMIN_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/postgres` | maintenance connection |
| `DRILL_SOURCE_DB` / `DRILL_RESTORE_DB` | `marketplace_backup_test` / `marketplace_restore_test` | scratch names (must contain `test`) |
| `PG_BIN` | auto-detected | PostgreSQL bin directory |
| `DRILL_KEEP=1` | unset | keep both DBs and the dump for inspection |

Last run: **PASS** — 23 tables / 225 rows / 82 indexes / 28 FKs round-tripped,
checksums matched, sequence probe OK, `pg_amcheck` clean.

Run the drill after: schema changes, migration-runner changes, a PostgreSQL major
upgrade, or a hosting-provider change. It is safe to run on a laptop and requires
no production access.

---

## 8. Applying D1 (CHECK constraints) safely

`docs/database-audit.md` finding **D1** recommends domain CHECK constraints
(status enums, non-negative money). Adding a validating constraint to a live table
takes an `ACCESS EXCLUSIVE` lock and scans every row, so do it in two steps:

1. **Add as `NOT VALID`** — enforces on new/updated rows immediately, skips the
   scan and the long lock:

   ```sql
   ALTER TABLE marketplace_payments
     ADD CONSTRAINT marketplace_payments_amount_nonneg CHECK (amount_cents >= 0) NOT VALID;
   ```

2. **Validate** later, in a low-traffic window:

   ```sql
   ALTER TABLE marketplace_payments VALIDATE CONSTRAINT marketplace_payments_amount_nonneg;
   ```

If validation fails, the constraint was right and the data was wrong: fix the rows
(or narrow the constraint) rather than dropping it. Ship these as dated files in
`src/db/migrations/` and update `src/db/schema.ts` in step (`AGENTS.md`).

---

## 9. RPO / RTO

| Metric | Target | How it is met | How it is verified |
|---|---|---|---|
| **RPO** (max data loss) | ≤ 24h logical; ≤ 5 min if provider PITR is on | daily logical dump + continuous WAL (PITR) | drill §7 round-trips a fresh dump; PITR gap confirmed with provider |
| **RTO** (time to recover) | ≤ 2h for a logical restore; ≤ 30 min from a provider snapshot | documented §4 procedure; dump restore into a fresh DB | drill completes the full round-trip in ~1 minute on a laptop; production is bounded by DB size and network transfer |

RPO is dominated by whether PITR is enabled (a plan decision, §1). Without PITR,
RPO is one day. **Action:** confirm PITR status with hosting and record it in §1.
