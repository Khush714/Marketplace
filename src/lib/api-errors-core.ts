/**
 * The API error contract, as pure functions.
 *
 * Every JSON error this API returns is shaped `{ error: { code, message } }`:
 * a stable `code` a client branches on, and a human `message` safe to show. The
 * shape lives here — with no `server-only`, no database and no request — so the
 * server helpers, the browser readers and the tests all agree on one definition
 * instead of three remembered ones.
 *
 * What must never appear in either field is the point of centralising this:
 * stack traces, raw driver/`pg` errors, internal exception text, and secrets.
 * The message is written for the caller, never copied from a caught error. The
 * server-side helper takes a code and a hand-written message; it never accepts a
 * `Throwable`.
 */

/**
 * The stable, finite set of codes a client is allowed to branch on.
 *
 * `NOT_CONFIGURED` and `SERVICE_UNAVAILABLE` are deliberately distinct: the
 * first is a deployment missing a required secret (fail-closed), the second is a
 * healthy deployment whose dependency is down. A caller should retry the second
 * and page an operator for the first.
 */
export const API_ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * The one wire shape for an error.
 *
 * `details` is optional and only for structured, non-secret context a client
 * genuinely needs to render the failure (for example the holder of a contested
 * POS identity). It must never carry credentials, tokens or raw provider text.
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  };
}

/** Build the standard error body. Message defaults to the code's stock text. */
export function errorBody(
  code: ApiErrorCode | string,
  message?: string,
  details?: unknown,
): ApiErrorBody {
  const body: ApiErrorBody = { error: { code, message: message ?? defaultMessageForCode(code) } };
  if (details !== undefined) body.error.details = details;
  return body;
}

/**
 * The `code` a bare status would carry.
 *
 * Used by the response builders when a caller supplies only a status, so a route
 * cannot emit an error body with no code at all.
 */
export const DEFAULT_CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: API_ERROR_CODES.INVALID_REQUEST,
  401: API_ERROR_CODES.UNAUTHORIZED,
  403: API_ERROR_CODES.FORBIDDEN,
  404: API_ERROR_CODES.NOT_FOUND,
  409: API_ERROR_CODES.CONFLICT,
  413: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
  415: API_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  429: API_ERROR_CODES.RATE_LIMITED,
  500: API_ERROR_CODES.INTERNAL_ERROR,
  503: API_ERROR_CODES.SERVICE_UNAVAILABLE,
};

/** The stock, caller-safe sentence for a code. */
export function defaultMessageForCode(code: ApiErrorCode | string): string {
  switch (code) {
    case API_ERROR_CODES.INVALID_REQUEST:
      return "Invalid request.";
    case API_ERROR_CODES.VALIDATION_ERROR:
      return "The request was not valid.";
    case API_ERROR_CODES.UNAUTHORIZED:
      return "Authentication is required.";
    case API_ERROR_CODES.FORBIDDEN:
      return "You do not have permission to do that.";
    case API_ERROR_CODES.NOT_FOUND:
      return "Not found.";
    case API_ERROR_CODES.CONFLICT:
      return "That conflicts with the current state.";
    case API_ERROR_CODES.RATE_LIMITED:
      return "Too many requests. Please wait a moment and try again.";
    case API_ERROR_CODES.PAYLOAD_TOO_LARGE:
      return "Request too large.";
    case API_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE:
      return "Unsupported content type.";
    case API_ERROR_CODES.INTERNAL_ERROR:
      return "Something went wrong.";
    case API_ERROR_CODES.NOT_CONFIGURED:
      return "This feature is not configured on this deployment.";
    case API_ERROR_CODES.SERVICE_UNAVAILABLE:
      return "The service is temporarily unavailable.";
    default:
      return "Something went wrong.";
  }
}

/** The `code` for a status, or a 500 code for anything unmapped. */
export function codeForStatus(status: number): ApiErrorCode {
  return DEFAULT_CODE_BY_STATUS[status] ?? API_ERROR_CODES.INTERNAL_ERROR;
}

/**
 * Read an error out of any response body, old or new.
 *
 * The browser reads through this rather than touching `body.error` directly, so
 * a page written against the string-shaped error of yesterday keeps working
 * while the API migrates to the object shape. `code` is `UNKNOWN` when the body
 * predates codes — callers must not treat it as a real code.
 */
export function readApiError(
  body: unknown,
): { code: string; message: string; details?: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { error?: unknown }).error;

  if (typeof raw === "string") {
    const message = raw.trim();
    return message ? { code: "UNKNOWN", message } : null;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { code?: unknown; message?: unknown; details?: unknown };
    const message = typeof obj.message === "string" ? obj.message.trim() : "";
    if (!message) return null;
    const code = typeof obj.code === "string" && obj.code ? obj.code : "UNKNOWN";
    return obj.details === undefined
      ? { code, message }
      : { code, message, details: obj.details };
  }
  return null;
}

/** The message to show a user, falling back when the body carries none. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  return readApiError(body)?.message ?? fallback;
}
