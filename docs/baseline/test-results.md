# Test Results (Phase 0 Baseline)

Recorded 2026-10-09 against working tree `eb8977e` + uncommitted layer.
All commands run from the repository root on Windows, Node v24.15.0.

## Summary

| Gate | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | PASS |
| Lint | `npm run lint` | 0 | PASS |
| Build | `npm run build` | 0 | PASS (with warnings) |
| Tests (unit + security) | `npm test` | 0 | PASS |
| Security E2E | `npm run test:security` | 0 | PASS |
| Audit | `npm audit --audit-level=high` | 1 | 9 high advisories (advisory) |

Test runner totals printed by `node --test`:

```
tests 374
suites 8
pass 374
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 80795.5566
```

## Typecheck

```
> typecheck
> tsc --noEmit
EXIT=0
```

## Lint

```
> lint
> eslint .
EXIT=0
```

## Build

`next build` (Turbopack) exited 0:

- `Compiled successfully in 27.0s`
- `Finished TypeScript in 21.8s`
- 17 static pages generated; 53 API routes + 18 page routes emitted as dynamic
  where required.
- `poweredByHeader: false`; `images.remotePatterns` now built from
  `IMAGE_HOST_PATTERNS`.

Non-fatal warnings (10 total, all Edge-Runtime built-in warnings plus one
Turbopack root notice):

- `./src/instrumentation.ts:51` and `:52` — `process.once` is not supported in
  the Edge Runtime.
- `node:crypto` imported into the Edge instrumentation trace via
  `src/lib/order-tracking.ts`, `src/db/payments.ts`,
  `src/integrations/pos/client.ts`, `src/integrations/pos/payment-bridge.ts`,
  `src/lib/owner-key.ts`, `src/lib/webhook-crypto.ts`,
  `src/lib/restaurant-session-core.ts`, `src/lib/customer-session-core.ts`.
- Turbopack: `package-lock.json` is outside the current Git repository
  (`C:\Users\hp\Desktop`), so it was ignored.

These warnings are pre-existing and do not fail the build.

## Tests — unit (`tests/*.test.ts`, 26 files)

All 26 unit files passed. Notable suites and their focus:

- `abuse-guards` — budgets are bounded, the guard runs before route work and
  before credential checks, honeypot ordering, body caps, the new
  `customerSession` budget wiring.
- `cron-auth` — shared `requireCronAuth` decisions: ops token, bearer
  `CRON_SECRET`, spoofed `x-vercel-cron` refusal, fail-closed unconfigured.
- `customer-session` — 90-day TTL, renewal threshold, liveness/revocation
  ordering, cookie attributes (`HttpOnly`, `SameSite=Lax`, scheme-following
  `Secure`), and order-code normalisation/cap.
- `error-disclosure` — no `_diag` on unverified webhook refusals, no
  `webhook_secret` in the verify attestation, no remote error text to clients.
- `image-ssrf` — `next.config.ts` mirrors `image-policy`, no `**` host,
  private/reserved hosts refused, `sanitizeImageUrl` fallback, read/write
  wiring.
- `order-checkout-validation` — field caps and server-enforced
  `TERMS_NOT_ACCEPTED`.
- `payment-security` — only webhook HMAC / checkout signature + provider
  re-read can write `PAID`; signature-verified provenance.
- `security-events`, `security-headers`, `database-security`,
  `restaurant-session`, `integration-*`, `pos-*`, `seo-surfaces`.

## Tests — security E2E (`tests/security/`, 1 file, 8 suites)

The harness (`tests/security/harness.ts`) created a scratch database
`crave_security_test`, applied the real migrations, seeded fixtures, and served
the compiled app with `next start` on a random localhost port. It ran for real
because local PostgreSQL 17.11 is reachable.

Suites (all passed):

1. ops admin authentication (delivery ops tokens)
2. partner session lifecycle (connect, expiry, revocation, sign-out)
3. restaurant A/B authorization isolation
4. order privacy and tracking enumeration protection
5. connection code redemption guardrails
6. integration bearer authentication and scoping
7. restaurant deletion gates
8. payment webhook verification (Phase 6/9 contract) — including the new
   decline → retry cases: `FAILED` stays resumable, a retried checkout is
   confirmable, a capture after decline lands `PAID`, and a late
   `payment.failed` for a superseded attempt cannot un-pay a capture.

The harness is fail-closed when `CI` is truthy or `REQUIRE_SECURITY_TESTS=1`
(`securityTestsRequired()`); a missing PostgreSQL prerequisite fails rather than
skips in those environments. Locally (this run) it was present, so nothing
skipped.

## Audit (`npm audit --audit-level=high`)

Exit 1, **9 high-severity vulnerabilities**. CI runs this step with
`continue-on-error: true`, so it is recorded, not gating. Grouped:

| Package | Installed | Advisory / note | Fix |
|---|---|---|---|
| `next` | 16.3.6 | Range `16.0.0–16.3.7`: `use cache` draft-mode leak; SSG/ISR cache poisoning; dev MCP info disclosure; metadata image route `dynamicParams` bypass; cache poisoning (cross-user substitution + DoS); **Image Optimization SSRF** (`GHSA-cjq9-62q9-8jv4`) | `next@16.4.0` (breaking vs pinned range) |
| `sharp` | 0.35.4 | librsvg `CVE-2026-96889` (`GHSA-wq5f-xc86-pv6w`) | `>=0.35.5` via `npm audit fix` |
| `brace-expansion` | 1.1.18 | Multiple ReDoS / stack-exhaustion advisories | `npm audit fix` |
| `braces` | 3.0.3 | Stack-exhaustion DoS (`GHSA-vfj7-8cjw-p6xm`) | `npm audit fix --force` (eslint-config-next downgrade) |
| `source-map-js` | 1.2.1 | Event-loop DoS (`GHSA-68fv-2mgg-jv7q`) | `npm audit fix` |

The Image Optimization SSRF advisory is directly relevant to the frozen
working-tree change that narrows `images.remotePatterns` and sets
`dangerouslyAllowLocalIP: false` — that mitigation reduces the exploit surface
but does not remove the framework advisory.

## Pre-existing failures

**None** in typecheck, lint, build, unit tests, or security E2E. Baseline is
green. The open items (incomplete customer-session wiring, dependency
advisories, build warnings, `.env` credential rotation, least-privilege DB role)
are recorded in `baseline-report.md` §6 and are not gate failures.
