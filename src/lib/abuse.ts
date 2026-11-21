import "server-only";

import { checkRateLimit, clientKey, rateLimited } from "@/lib/security/rate-limit";
import {
  ABUSE_BUDGETS,
  decideOrigin,
  honeypotTripped,
  MAX_JSON_BODY_BYTES,
  type AbuseScope,
  type OriginDecision,
} from "@/lib/abuse-core";
import { appOrigin } from "@/lib/app-url";

/**
 * Server wiring for the abuse policy in `abuse-core.ts`.
 *
 * `null` means "allowed, carry on"; a `Response` means the request is already
 * answered and the caller must return it unchanged. Every guard is deliberately
 * cheap enough to sit above the database: the whole point is to reject the
 * request before it costs a query or a provider call.
 */

/** Hosts a browser-origin request may legitimately claim. */
function allowedHosts(req: { headers: Headers }): string[] {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  let configured = "";
  try {
    configured = new URL(appOrigin()).host;
  } catch {
    configured = "";
  }
  return [host ?? "", configured];
}

/** Resolve the origin decision for a request against this deployment. */
export function originDecision(req: { headers: Headers }): OriginDecision {
  return decideOrigin(req.headers, allowedHosts(req));
}

/** 403 for a request a browser was used to fire at this origin from elsewhere. */
function crossSiteRejected(): Response {
  return Response.json(
    { ok: false, error: "Request rejected" },
    { status: 403 },
  );
}

/**
 * Count this request against the route's budget.
 *
 * Keyed on the client address, which is the only stable identity an
 * unauthenticated caller has. See `ABUSE_BUDGETS` for why the limits are set
 * where they are rather than as tight as the abuse would suggest.
 */
export function guardBudget(req: { headers: Headers }, scope: AbuseScope): Response | null {
  const budget = ABUSE_BUDGETS[scope];
  const result = checkRateLimit(clientKey(req, scope), budget.limit, budget.windowMs);
  return result.allowed ? null : rateLimited(result.retryAfterSeconds);
}

/** 413 for a body over the cap, whether or not `Content-Length` declared it. */
function tooLarge(): Response {
  return Response.json({ ok: false, error: "Request too large" }, { status: 413 });
}

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

export type RawBodyResult = { ok: true; text: string } | { ok: false; response: Response };

/**
 * Read a raw body under a hard size cap, returning the exact bytes.
 *
 * `Content-Length` is checked first because it is free, but it cannot be
 * trusted: a chunked request sends no length, so the stream is counted as it
 * arrives and cut off the moment it passes the cap. That ordering matters
 * because Next.js has already buffered the request by the time a handler runs —
 * reading the body with a cap stops an unauthenticated caller from making the
 * platform hold an arbitrarily large payload in memory.
 *
 * The exact bytes are required by the signature-verified webhooks: a signature
 * covers the raw frame, so those handlers need the text as sent, not a parsed
 * projection. Returns the response to send rather than throwing, so callers
 * keep one error path for "could not use this body" instead of three.
 */
export async function readRawBodyCapped(req: Request, maxBytes: number): Promise<RawBodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: tooLarge() };
  }

  try {
    const body = req.body;
    if (!body) {
      return { ok: false, response: Response.json({ ok: false, error: "Invalid request" }, { status: 400 }) };
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancel rather than drain: draining would still consume the bytes we
        // are refusing, which is the cost this guard exists to avoid.
        await reader.cancel().catch(() => {});
        return { ok: false, response: tooLarge() };
      }
      chunks.push(value);
    }
    return { ok: true, text: new TextDecoder().decode(concat(chunks)) };
  } catch {
    return { ok: false, response: Response.json({ ok: false, error: "Invalid request" }, { status: 400 }) };
  }
}

/**
 * Read and parse a JSON body under the standard size cap.
 *
 * Delegates the bounded read to `readRawBodyCapped`, so every route that takes
 * a JSON body — including the ones that parse it themselves afterwards — shares
 * one implementation of the same cap.
 */
export async function readJsonBody(req: Request): Promise<JsonBodyResult> {
  const raw = await readRawBodyCapped(req, MAX_JSON_BODY_BYTES);
  if (!raw.ok) return { ok: false, response: raw.response };

  try {
    return { ok: true, body: JSON.parse(raw.text) as unknown };
  } catch {
    return { ok: false, response: Response.json({ ok: false, error: "Invalid request" }, { status: 400 }) };
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Guard an unauthenticated write: origin, then volume, then declared size.
 *
 * Origin is checked first because it is a header comparison that rejects a whole
 * class of caller for free. The budget comes next: it bounds everything that
 * survives, including requests that would fail validation anyway. The
 * `content-length` check is last because `readJsonBody` enforces the same cap on
 * the stream itself — it is repeated here so a route that forgets to use that
 * helper still cannot be handed an oversized body.
 */
export async function guardWrite(req: Request, scope: AbuseScope): Promise<Response | null> {
  if (originDecision(req) === "cross-site") return crossSiteRejected();

  const throttled = guardBudget(req, scope);
  if (throttled) return throttled;

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return tooLarge();

  return null;
}

/** Guard an unauthenticated read: volume only. GETs carry no body to bound. */
export function guardRead(req: { headers: Headers }, scope: AbuseScope): Response | null {
  return guardBudget(req, scope);
}

/**
 * Reject a filled honeypot with a success-shaped response.
 *
 * The bot gets `{ ok: true }` and moves on, learning nothing about the field it
 * tripped or whether the rest of the form would have been accepted. A real user
 * never sees this path — the field is hidden and unfocusable — so the response
 * is written to be indistinguishable from the one a success would return.
 */
export function honeypotRejected(): Response {
  return Response.json({ ok: true });
}

/** Whether the request tripped the honeypot on an already-parsed body. */
export function bodyTrippedHoneypot(body: unknown): boolean {
  return honeypotTripped(body);
}