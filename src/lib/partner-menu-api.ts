import { NextRequest } from "next/server";

/**
 * Shared plumbing for the partner menu API.
 *
 * Every handler resolves the restaurant from `x-owner-key`; none of them ever
 * accept a restaurant id from the client. That keeps the tenant boundary in
 * the data layer (`db/partner-menu.ts`) instead of trusting request bodies.
 */

/** Owner key rides a header, never a URL query (queries leak into logs, proxies, history). */
export const OWNER_KEY_HEADER = "x-owner-key";

export function readOwnerKey(req: NextRequest): string {
  return String(req.headers.get(OWNER_KEY_HEADER) ?? "").trim();
}

/** 404 rather than 401: an unknown key must not confirm whether a listing exists. */
export function invalidOwnerKey() {
  return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
}

export function badRequest(error: string) {
  return Response.json({ ok: false, error }, { status: 400 });
}

/** Parse a JSON object body, or null when it is absent/unusable. */
export async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Path segment → number, or null when it is not a positive row id. */
export function readRowId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Map a `{ ok, error }` data-layer result onto an HTTP response. */
export function respond<T extends object>(
  result: { ok: true } & T | { ok: false; error: string },
) {
  if (!result.ok) return badRequest(result.error);
  return Response.json(result, { status: 200 });
}
