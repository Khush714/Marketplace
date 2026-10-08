import { NextRequest } from "next/server";

import { requirePartnerSession } from "@/lib/security/restaurant-session";

/**
 * Shared plumbing for the partner menu API.
 *
 * Every handler resolves the restaurant from the caller's session; none of them
 * ever accept a restaurant id from the client, and none of them accept an owner
 * key either. That keeps the tenant boundary in the data layer
 * (`db/partner-menu.ts`) instead of trusting request bodies — and it means the
 * long-lived owner key is not on the wire for any menu request, which is the
 * point of the session work.
 *
 * `requirePartnerSession` already enforces origin + CSRF + a per-session budget on
 * writes, so a handler below only has to decide `mutating: true` or `false`.
 */

/**
 * Authorise a menu request and hand back the restaurant id to work with.
 *
 * Returns a ready `Response` on failure rather than a status code, so a handler
 * cannot forget to send one. The pattern is always:
 *
 * ```ts
 * const auth = await authoriseMenu(req, true);
 * if (!auth.ok) return auth.response;
 * return respond(await createMenuItem(auth.restaurantId, body));
 * ```
 */
export async function authoriseMenu(
  req: NextRequest,
  mutating: boolean,
): Promise<
  | { ok: true; restaurantId: number }
  | { ok: false; response: Response }
> {
  const auth = await requirePartnerSession(req, { mutating });
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, restaurantId: auth.session.restaurantId };
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
