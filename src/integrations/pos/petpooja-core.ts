/**
 * Petpooja wire helpers, as pure functions.
 *
 * No `server-only` here on purpose: the POS order bridge and `node --test` both
 * import this module, so the wire encoding stays testable without a database.
 * Money is integer paise inside the Marketplace; the strings produced here are
 * a wire encoding only.
 */

/**
 * Format integer paise as a plain rupee decimal string ("329.00").
 *
 * Built with integer arithmetic so a value that cannot be represented exactly
 * as a float (large order totals) still renders the billed amount. No currency
 * symbol or thousands separators: this is a machine-readable wire value, not a
 * display label.
 */
export function formatCentsAsRupees(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const absolute = Math.abs(safe);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
