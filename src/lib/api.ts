import { assertCustomerSafe } from "./marketplace";

/**
 * Serialise a customer-facing payload. Runs the safety tripwire first so an
 * internal field leaking into a response fails the request instead of shipping.
 */
export function safeJson(payload: unknown, status = 200): Response {
  assertCustomerSafe(payload);
  return Response.json(payload, { status });
}

export function errorJson(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function parsePagination(url: URL): { limit: number; offset: number } {
  const limit = Number(url.searchParams.get("limit") ?? 24);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}
