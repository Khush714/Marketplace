/**
 * Tests for the shared API conventions: the error envelope and cursor
 * pagination.
 *
 * Run with: npm test
 *
 * Both modules are `*-core.ts` — pure, no `server-only`, no DB, no network — so
 * the contract the routes and the frontend both depend on can be pinned here
 * rather than inferred from 50-odd call sites.
 *
 * The error envelope is `{ error: { code, message, details? } }` for 4xx/5xx
 * only. The reader must stay tolerant of the legacy bare-string `error` because
 * the external-contract routes (`/api/integration/**`, `/api/integrations/**`)
 * are deliberately NOT migrated, and a shared reader that threw on their shape
 * would take the whole frontend down if one were ever wired to it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_ERROR_CODES,
  apiErrorMessage,
  codeForStatus,
  defaultMessageForCode,
  errorBody,
  readApiError,
} from "../src/lib/api-errors-core";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  nextCursor,
  parsePageSize,
} from "../src/lib/api-pagination-core";

/* ------------------------------ error core ------------------------------- */

test("errorBody wraps a code and message under `error`", () => {
  assert.deepEqual(errorBody("NOT_FOUND", "No such order."), {
    error: { code: "NOT_FOUND", message: "No such order." },
  });
});

test("errorBody falls back to the code's default message and carries details", () => {
  assert.deepEqual(errorBody("NOT_FOUND"), {
    error: { code: "NOT_FOUND", message: defaultMessageForCode("NOT_FOUND") },
  });
  assert.deepEqual(errorBody("CONFLICT", "Taken.", { transfer: { id: 1 } }), {
    error: { code: "CONFLICT", message: "Taken.", details: { transfer: { id: 1 } } },
  });
});

test("every standard code has a non-empty default message", () => {
  for (const code of Object.values(API_ERROR_CODES)) {
    assert.ok(defaultMessageForCode(code).length > 0, `${code} needs a default message`);
  }
});

test("codeForStatus maps the standard statuses and defaults the rest", () => {
  assert.equal(codeForStatus(400), "INVALID_REQUEST");
  assert.equal(codeForStatus(401), "UNAUTHORIZED");
  assert.equal(codeForStatus(403), "FORBIDDEN");
  assert.equal(codeForStatus(404), "NOT_FOUND");
  assert.equal(codeForStatus(409), "CONFLICT");
  assert.equal(codeForStatus(413), "PAYLOAD_TOO_LARGE");
  assert.equal(codeForStatus(415), "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(codeForStatus(429), "RATE_LIMITED");
  assert.equal(codeForStatus(503), "SERVICE_UNAVAILABLE");
  assert.equal(codeForStatus(418), "INTERNAL_ERROR");
});

test("readApiError reads the envelope, and stays tolerant of a legacy string", () => {
  assert.deepEqual(readApiError({ error: { code: "FORBIDDEN", message: "Nope." } }), {
    code: "FORBIDDEN",
    message: "Nope.",
  });
  assert.deepEqual(readApiError({ error: "legacy string" }), {
    code: "UNKNOWN",
    message: "legacy string",
  });
  assert.equal(readApiError(null), null);
  assert.equal(readApiError({}), null);
  assert.equal(readApiError("nonsense"), null);
});

test("apiErrorMessage prefers the envelope message, then a legacy string, then the fallback", () => {
  assert.equal(apiErrorMessage({ error: { code: "CONFLICT", message: "Clash." } }, "fallback"), "Clash.");
  assert.equal(apiErrorMessage({ error: "legacy" }, "fallback"), "legacy");
  assert.equal(apiErrorMessage({}, "fallback"), "fallback");
  assert.equal(apiErrorMessage(undefined, "fallback"), "fallback");
});

/* ---------------------------- pagination core ---------------------------- */

test("parsePageSize clamps into (0, MAX] and defaults on junk", () => {
  assert.equal(parsePageSize(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize("abc"), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize("0"), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize("-5"), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize("10"), 10);
  assert.equal(parsePageSize("10.9"), 10);
  assert.equal(parsePageSize(String(MAX_PAGE_SIZE + 500)), MAX_PAGE_SIZE);
  assert.equal(parsePageSize(undefined, 50), 50);
});

test("a cursor round-trips through encode/decode", () => {
  for (const offset of [0, 24, 1, 999999]) {
    assert.equal(decodeCursor(encodeCursor(offset)), offset, `offset ${offset}`);
  }
});

test("decodeCursor treats anything malformed as the start of the list", () => {
  assert.equal(decodeCursor(undefined), 0);
  assert.equal(decodeCursor(""), 0);
  assert.equal(decodeCursor("!!!not base64!!!"), 0);
  assert.equal(decodeCursor("_"), 0);
  assert.equal(decodeCursor(btoa("garbage")), 0);
});

test("nextCursor is null on a short page and advances on a full one", () => {
  assert.equal(nextCursor(0, 24, 20), null);
  assert.equal(nextCursor(0, 24, 24), encodeCursor(24));
  assert.equal(nextCursor(48, 24, 24), encodeCursor(72));
});
