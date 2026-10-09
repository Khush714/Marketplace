# Baseline Report (Phase 0)

Recorded 2026-10-09. This is the freeze point for the production-readiness
programme. Every number and status below was produced by a command run against
the working tree at the time of recording; the command is named so it can be
re-run and compared.

## 1. What was frozen

| Item | Value |
|---|---|
| Git HEAD | `eb8977eff70e2c89a2f3cbb9bf8efbba3177daa4` |
| Branch | `master` |
| Nearest tag | none (`git describe --tags --always` → `eb8977e`) |
| Commit subject at HEAD | `Market` |
| Working tree | **dirty** — 36 modified files, 11 untracked files |
| Diff size vs HEAD | 940 insertions, 130 deletions across 36 tracked files |

The tree carries an **uncommitted security hardening layer** on top of
`eb8977e`. This is the state being frozen: the higher-level layer is summarised
in §4 and inventoried in full in `architecture-inventory.md`. Nothing was
committed, reverted, or edited to produce the baseline; the only files written
during Phase 0 are the three documents in `docs/baseline/`.

Command: `git rev-parse HEAD`, `git status --short`, `git diff --stat`.

## 2. Toolchain present

| Tool | Version | Source |
|---|---|---|
| Node.js | v24.15.0 | `node --version` |
| npm | 11.12.1 | `npm --version` |
| PostgreSQL | 17.11 (x86_64-windows) | live probe of `127.0.0.1:5432` |
| Next.js | 16.3.6 | `package.json` / lockfile |
| TypeScript | 5.9.3 | `package.json` |
| OS | win32 (Windows) | environment |

PostgreSQL is reachable as `postgres/postgres@127.0.0.1:5432`, so the security
E2E harness (which requires it) ran for real rather than skipping.

## 3. Gate results at the freeze point

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) |
| Lint | `npm run lint` (`eslint .`) | **PASS** (exit 0) |
| Build | `npm run build` (`next build`) | **PASS** (exit 0) — 10 warnings, non-fatal |
| Full test suite | `npm test` | **PASS** — 374 tests, 8 suites, 0 fail, 0 skipped |
| Security E2E | `npm run test:security` (within `npm test`) | **PASS** — all 8 suites green against real PostgreSQL + `next start` |
| Dependency audit | `npm audit --audit-level=high` | **9 high-severity advisories** (advisory only in CI; no source change) |

Full raw detail is in `test-results.md`.

## 4. What the frozen working tree adds over HEAD

The uncommitted layer is a security hardening pass. It is coherent and tested,
but it is **not fully wired** — see §6. Summary:

1. **Anonymous customer sessions.** New `src/lib/customer-session-core.ts`,
   `src/lib/customer-session.ts`, table `customer_sessions`
   (`src/db/migrations/20261008_customer_sessions.sql`), and
   `POST /api/orders/attach`. Moves the per-order credential out of
   `localStorage` (`crave.profile.v1`) into an `HttpOnly` cookie; the row holds
   only order codes, hashed token, `expires_at`/`revoked_at`.
2. **Image SSRF boundary.** New `src/lib/image-policy.ts` is the single
   allowlist. `next.config.ts` narrows `images.remotePatterns` from the
   previous catch-all `https://**` to `images.pexels.com` + `*.supabase.co` and
   sets `dangerouslyAllowLocalIP: false`. `sanitizeImageUrl` now delegates to it;
   DTO readers and the POS menu-image reader re-validate.
3. **Error-disclosure fixes.** Unverified webhook refusals drop the `_diag`
   oracle; `/api/partner/integrations/verify` strips `webhook_secret`; POS
   bridge fall-through errors map to fixed copy instead of `err.message`.
4. **Input bounds + server-enforced consent.** `order-input-core.ts` caps free
   text (`customerName` 80, `addressText` 500, `instructions` 500, slug 120) and
   rejects `acceptedTerms !== true`; the checkout form now sends the flag.
5. **Timing-safe owner-key compare** (`timingSafeEqual`).
6. **Capped body reads** on partner integration/verify/rotate and the
   partner-menu API (shared `readJsonBody`).
7. **Payment decline→retry correctness.** `FAILED` remains resumable; a late
   `payment.failed` can no longer downgrade or rebind a captured payment
   (`PAYMENT_ATTEMPT_SUPERSEDED` / `PAYMENT_ALREADY_SETTLED`).
8. **Internal drain route** now goes through `requireCronAuth` instead of its
   own ad-hoc `CRON_SECRET` comparison.
9. **LIKE escaping** in `browseRestaurants`.
10. **CI hardening.** `.github/workflows/ci.yml` sets `REQUIRE_SECURITY_TESTS=1`
    and runs unit tests, security E2E, audit and build; the harness is
    fail-closed in CI.
11. **New/updated tests:** `customer-session.test.ts`, `error-disclosure.test.ts`,
    `image-ssrf.test.ts`, plus extensions to `cron-auth`, `abuse-guards`,
    `order-checkout-validation`, `pos-menu-image`, `pos-verify-outcome` and the
    security E2E suite.

## 5. Uncommitted file inventory

Modified (36): `.github/workflows/ci.yml`, `SECURITY_HARDENING_ROADMAP.md`,
`next.config.ts`, `package.json`, `tsconfig.json`, and 32 `src/`/`tests/` files
(full list in `git status`). Untracked (11):

```
docs/baseline/architecture-inventory.md      (Phase 0 deliverable)
src/app/api/orders/attach/route.ts
src/db/migrations/20261008_customer_sessions.sql
src/lib/customer-session-core.ts
src/lib/customer-session.ts
src/lib/image-policy.ts
src/lib/order-authorized.ts
tests/customer-session.test.ts
tests/error-disclosure.test.ts
tests/image-ssrf.test.ts
```

## 6. Pre-existing failures and open items

No gate failed. The following are recorded as **open** at the freeze point and
are the first candidates for Phase 1; they are pre-existing, not introduced by
recording the baseline.

1. **Incomplete customer-session migration (highest priority).**
   `src/lib/order-authorized.ts` is exported but **imported by no route**
   (`grep` shows only its definition). The order read/pay/cancel routes still
   authenticate with the `x-order-token` header alone
   (`src/app/api/orders/[code]/route.ts:15`,
   `src/app/api/orders/[code]/cancel/route.ts:19`). The new
   `ABUSE_BUDGETS.orderCancel` budget (`src/lib/abuse-core.ts`) is likewise
   declared but **not wired**: `orders/[code]/cancel` has no `guardWrite`. The
   session half therefore exists, is tested in isolation, and is reachable via
   `/api/orders/attach`, but the read path it was built to serve is not yet
   switched over.
2. **Dependency advisories — 9 high.** Notably `next@16.3.6` (advisory range
   `16.0.0–16.3.7`, includes an image-optimization SSRF and cache-poisoning
   advisories; fix `next@16.4.0`, outside the current range), `sharp@0.35.4`
   (librsvg `CVE-2026-96889`, fix `>=0.35.5`), and dev-toolchain transitives
   `brace-expansion@1.1.18`, `braces@3.0.3`, `source-map-js@1.2.1`. CI treats
   audit as advisory (`continue-on-error: true`).
3. **Build warnings (10, non-fatal).** Edge-Runtime warnings for Node built-ins
   pulled into the Edge bundle (`process.once` in `instrumentation.ts`;
   `node:crypto` reached via `instrumentation.ts` import traces through
   `image-policy`/`session` modules). Build still exits 0. Also a Turbopack
   warning that `package-lock.json` sits outside the Git repo root.
4. **`.env` application credential.** `SECURITY_HARDENING_ROADMAP.md` (Phase 11
   notes) records the committed `.env` `DATABASE_URL` failing auth (`28P01`) —
   the Phase 0 credential-rotation item is still open. The baseline probe used
   the local `postgres/postgres` superuser, which is reachable; the deployed app
   credential was not exercised.
5. **Least-privilege DB role not switched over.** `marketplace_app` exists and
   is provisioned (`20261007_application_role.sql`) but the application still
   connects as an over-privileged role (documented open item carried from the
   prior inventory).

## 7. Freeze declaration

Effective at `eb8977e` + the dirty working tree recorded above, **no source
file may be modified** until this baseline is accepted. Any change after this
point is measured against the results in §3 and `test-results.md`.
