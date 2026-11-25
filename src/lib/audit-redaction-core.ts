/** Redaction applied before an audit row is rendered in the ops console. */

const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|api[_-]?key|webhook)/i;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 64 ? `${value.slice(0, 8)}…` : "••••";
  if (Array.isArray(value)) return value.map(redactValue);
  return "[redacted]";
}

export function redactAuditDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object") return detail ?? null;
  if (Array.isArray(detail)) return detail.map(redactAuditDetail);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? redactValue(value) : redactAuditDetail(value);
  }
  return out;
}

/** Keep enough of an address to correlate rows without exposing a full client IP. */
export function maskIp(raw: string | null | undefined): string {
  if (!raw) return "";
  if (raw.includes(".")) {
    const parts = raw.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.***` : "***";
  }
  return raw.includes(":") ? `${raw.split(":").slice(0, 2).join(":")}::***` : "***";
}
