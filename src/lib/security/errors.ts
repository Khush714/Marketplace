import "server-only";

import { NextResponse } from "next/server";

/** Standard error shapes for security/validation failures. */
export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, details }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export function tooMany(message = "Too many requests", retryAfterSeconds?: number) {
  const headers = retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined;
  return NextResponse.json({ ok: false, error: message }, { status: 429, headers });
}

export function internalError(message = "Internal error") {
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}