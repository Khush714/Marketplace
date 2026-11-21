# ADR-0006: Security is a layered, fail-closed, centrally-observable architecture

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `src/proxy.ts`, `src/lib/abuse-core.ts`, `src/lib/abuse.ts`,
  `src/lib/edge-policy-core.ts`, `src/lib/security/*`,
  `src/lib/image-policy.ts`, `src/lib/owner-key.ts`, `src/lib/webhook-crypto.ts`,
  `docs/architecture.md`, `SECURITY_HARDENING_ROADMAP.md`

## Context

The marketplace is internet-facing, handles money and PII, and is integrated with
two external systems that push data in. The threat surface is broad: unauthenticated
volume (spam, scraping, credential grinding), cross-site request forgery, XSS
stealing browser-held credentials, SSRF through image optimisation, secret leakage
via logs, timing attacks on secret comparisons, and confusing "fail open" defaults
when a deployment is misconfigured.

Security had grown organically: five copy-pasted ops-token comparisons that
disagreed about failure, owner-key comparison via a non-constant-time path,
unbounded request bodies, a catch-all image host allowlist (`https://**`), and no
single observability stream. The programme's job was to make the defences
systematic.

## Decision

**Defence in depth with two properties that are non-negotiable: fail closed, and
never trust the browser.** Organised as layers, each cheap and independent:

1. **Edge boundary first (`src/proxy.ts`).** Before routing, RSC, or a DB
   connection: method allowlist; host allowlist (`ALLOWED_HOSTS` + deployment host
   + Vercel previews) to stop raw-IP/rebinding; declared `content-length` cap;
   per-client burst ceiling (deliberately looser than per-route budgets so shared
   NATs are not throttled); and `withSecurityHeaders` + HSTS on every response.
   All decisions live in `edge-policy-core.ts` so they are testable.

2. **Per-route budgets (`abuse-core.ts` / `abuse.ts`).** `guardWrite`/`guardRead`
   combine an **origin (CSRF) check** with a per-scope budget. Credential-grade
   scopes are charged **before** the credential is checked, so a wrong credential
   is counted rather than answered for free. Budgets defend *unauthenticated
   volume*, not access.

3. **Bounded input everywhere.** `readJsonBody` / `readRawBodyCapped` cap bodies;
   free text is length-capped (`order-input-core.ts`); search terms and slug lists
   are clamped; LIKE wildcards are escaped (`escapeLike`). Consent is
   server-enforced (`acceptedTerms === true`).

4. **Credentials are server-minted, hashed at rest, and constant-time compared.**
   Every token in the schema is stored as SHA-256 (`owner-key.ts`); comparisons
   use `timingSafeEqual`; POS webhook secrets are sealed AES-256-GCM
   (`webhook-crypto.ts`). Sessions (ADR-0002, ADR-0003) have bounded lifetimes and
   revocation.

5. **Browser credentials are `HttpOnly`.** Owner/console/customer credentials are
   cookies the page cannot read; CSRF is defended by `SameSite=Lax` + a
   double-submit token; order access is a per-order HMAC token plus a bound
   session (ADR-0002, `lib/order-authorization`). The per-order credential no
   longer lives in `localStorage`.

6. **SSRF boundary for images (`image-policy.ts`).** One allowlist
   (`images.pexels.com`, `*.supabase.co`, https-only) imported by `next.config.ts`
   so the optimiser cannot drift; `dangerouslyAllowLocalIP: false`; private/
   reserved host detection; rooted wildcard matching. Applied on write and read.

7. **Fail closed on misconfiguration.** An unset ops token denies in production;
   an unset cron secret returns 503; missing provider keys refuse online checkout;
   a loopback `POS_BASE_URL` on a deployed function is refused. Development-only
   conveniences are explicitly gated on `NODE_ENV`.

8. **No error or diagnostic oracles.** Remote failures map to fixed copy (no
   `err.message` passthrough); unverified webhook refusals carry no `_diag`;
   `/integrations/verify` strips the webhook secret; ops/cron failures do not
   distinguish a valid prefix.

9. **Single structured security-event stream with a never-log guarantee.**
   `security-events-core.ts` fixes the event vocabulary and redacts inside
   `buildSecurityEvent` (keys matched case/punctuation-insensitively, plus a value
   rule for `postgres://` connection strings), so every emission shares one
   guarantee and a call site cannot forget the rule. `security-events.ts` writes
   one JSON line to stderr.

10. **CI is part of the control.** `.github/workflows/ci.yml` sets
    `REQUIRE_SECURITY_TESTS=1` (fail-closed), runs typecheck, lint, unit tests, the
    8-suite security E2E against real Postgres, and a build.

## Consequences

**Positive**
- A single misconfigured deployment fails safe rather than open.
- Cheap attacks are rejected before they reach a handler or the database.
- Secrets cannot leak through the log stream even if a future call site is careless.
- Each layer is independently testable (`*-core.ts` + source-assertion tests +
  the behavioural E2E suite), which is what keeps the policy from drifting.

**Negative / costs**
- Many small modules and guards; authors must call the right guard in the right
  order (documented per route in the Phase 0 inventory).
- Some budgets are generous by design (shared mobile NAT), so the per-route limiter
  is not an authoritative control on its own — the edge burst ceiling and the
  credential checks are the primary controls.
- In-process rate-limit buckets are per-instance; a multi-instance deployment needs
  a shared store or a WAF/edge limiter for authoritative limits.

## Alternatives considered

- **A single middleware doing everything.** Rejected: some guards need DB/session
  reads; splitting policy into pure cores keeps them testable.
- **Fail open in dev and prod alike.** Rejected: the exact production footgun that
  motivated the fail-closed rules.
- **Rely on `SameSite` alone for CSRF.** Rejected: the double-submit token is the
  control that must be unforgeable; `SameSite` is the first, not only, layer.
- **Log full context to debug faster.** Rejected: the never-log list exists because
  a leaked token in a log is as bad as a leaked token anywhere.

## Notes for future work (open items, not design choices)

- `api/orders/[code]/cancel` still lacks a `guardWrite` and the declared
  `ABUSE_BUDGETS.orderCancel` is unwired; the customer-session read path is not
  fully switched over (see `architecture.md` §12).
- 9 high dependency advisories remain (`next@16.3.6`, `sharp@0.35.4`, transitives).
- The least-privilege `marketplace_app` DB role exists but the app still connects
  as an over-privileged role.
- Shared/multi-instance rate limiting is not implemented.
