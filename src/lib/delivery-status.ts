/**
 * PHASE 4 — compatibility shim.
 *
 * The delivery state machine moved to `src/lib/delivery-lifecycle.ts`
 * (`pending_assignment` is the canonical pre-dispatch state). This module just
 * re-exports it so existing consumers keep their import surface unchanged;
 * nothing else should import this file once dependents are migrated.
 */
export * from "./delivery-lifecycle";