import "server-only";

import { NextResponse } from "next/server";

import {
  API_ERROR_CODES,
  codeForStatus,
  errorBody,
  type ApiErrorCode,
} from "@/lib/api-errors-core";

/**
 * Server-side builders for the standard error response.
 *
 * Every JSON error a route returns should be built here, so the body is always
 * `{ error: { code, message } }` and never a caught exception. The message is
 * supplied by the call site and is written for the caller; a `Throwable` is
 * never accepted, which is what keeps stack traces and driver text out of the
 * response by construction rather than by discipline.
 *
 * `code` defaults from the status (see `DEFAULT_CODE_BY_STATUS`), so the common
 * cases read as `badRequest("...")` with no code, and a route that needs a more
 * specific code (e.g. `VALIDATION_ERROR`) passes it explicitly.
 */
export function apiError(
  status: number,
  message?: string,
  code: ApiErrorCode | string = codeForStatus(status),
  init?: { headers?: HeadersInit; details?: unknown },
): NextResponse {
  return NextResponse.json(errorBody(code, message, init?.details), {
    status,
    headers: init?.headers,
  });
}

export function badRequest(
  message?: string,
  code: ApiErrorCode | string = API_ERROR_CODES.INVALID_REQUEST,
): NextResponse {
  return apiError(400, message, code);
}

export function unauthorized(message?: string): NextResponse {
  return apiError(401, message);
}

export function forbidden(message?: string): NextResponse {
  return apiError(403, message);
}

export function notFound(message?: string): NextResponse {
  return apiError(404, message);
}

export function conflict(message?: string): NextResponse {
  return apiError(409, message);
}

export function payloadTooLarge(message?: string): NextResponse {
  return apiError(413, message);
}

export function unsupportedMediaType(message?: string): NextResponse {
  return apiError(415, message);
}

export function tooMany(
  retryAfterSeconds?: number,
  message?: string,
): NextResponse {
  return apiError(429, message, API_ERROR_CODES.RATE_LIMITED, {
    headers:
      retryAfterSeconds !== undefined
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
  });
}

export function internalError(message?: string): NextResponse {
  return apiError(500, message);
}

export function notConfigured(message?: string): NextResponse {
  return apiError(503, message, API_ERROR_CODES.NOT_CONFIGURED);
}

export function serviceUnavailable(message?: string): NextResponse {
  return apiError(503, message, API_ERROR_CODES.SERVICE_UNAVAILABLE);
}
