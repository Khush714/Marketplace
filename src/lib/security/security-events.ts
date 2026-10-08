import {
  buildSecurityEvent,
  formatSecurityEvent,
  type SecurityEventFields,
  type SecurityEventName,
} from "./security-events-core";

/**
 * Emit one structured security event to the log stream.
 *
 * Follows the `pos-bridge` precedent: a single compact JSON line per event,
 * on stderr. stderr rather than stdout because these are operational records
 * the platform should never discard for log-volume reasons, and because the
 * one structured emitter this codebase already had writes there — one stream
 * to tail is worth more than the stdout/stderr distinction.
 *
 * The never-log guarantee lives in `buildSecurityEvent` (Phase 12 core): the
 * fields passed here are redacted before formatting, so call sites express
 * *what they want to record* and cannot leak a secret by remembering its
 * key wrong. Keep call-site fields boring identifiers — ids, reasons,
 * outcomes — never raw credentials, even though redaction would catch them.
 *
 * Intentionally not `server-only`: the edge proxy reaches this through
 * `rate-limit.ts`, and `node --test` imports the core directly.
 */
export function emitSecurityEvent(
  name: SecurityEventName,
  fields: SecurityEventFields = {},
): void {
  console.error(formatSecurityEvent(buildSecurityEvent(name, fields)));
}
