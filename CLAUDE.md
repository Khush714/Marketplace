# CLAUDE.md

This file gives Claude Code guidance for this repository. The canonical,
tool-agnostic instructions live in **`AGENTS.md`**; read it first — the rules
there apply here too. This file adds only what is specific to working with
Claude on this codebase.

## Orientation

- `docs/system-design.md` — what the system is and why.
- `docs/architecture.md` — how it is built (layers, flows, module map, known gaps).
- `docs/decisions/0001`–`0006` — the ADRs behind the tricky parts (tenancy,
  sessions, POS auth, payments, delivery journal, security).
- `docs/baseline/` — frozen Phase 0 snapshot (do not edit).

## Working style for this repo

- **Plan before editing.** This codebase is security- and money-sensitive; make a
  short todo list, then change one coherent unit at a time.
- **Read the neighbours first.** When editing a route, read the other routes in
  the same family and the guards it uses (`guardWrite`/`guardRead`,
  `requirePartnerSession`, `requireIntegrationAuth`, `requireOpsToken`). Match the
  pattern; don't invent a new auth path.
- **Keep policy pure and tested.** If a decision is worth asserting, put it in a
  `*-core.ts` pure module and unit-test it; put the DB/server wiring beside it.
- **Verify with the repo's own gates**, not ad-hoc commands:
  `npm run verify` for any change, and `npm run test:security` for auth, payments,
  tenancy or delivery changes. Report the gate output.
- **Windows/PowerShell:** `rg` is not available and shell redirection can fail
  (EPERM). Use the built-in file search/read/edit tools instead of shell text
  processing.

## Hard stops

- Never make anything the browser sends able to mark an order `PAID`, grant order
  access, or skip a POS journal row.
- Never let a missing secret/token/config fail open.
- Never log a credential, token, key, or full customer address.
- Never edit `docs/baseline/*` (treat it as historical).
- Never commit unless explicitly asked.
