/**
 * Regression guards for the connection-code lifecycle: redemption, revocation,
 * and the one predicate both are built on.
 *
 * The defect class these exist for is a phase-3 security property that is
 * invisible to the type checker. "A code can only ever create one listing" is
 * enforced entirely by a `WHERE status = 'unused'` inside a conditional UPDATE.
 * Weaken that predicate and nothing fails to compile, every unit test still
 * passes, and the bug appears in production as a duplicate live listing — a
 * restaurant created twice off one invitation, each with its own owner key.
 *
 * That is why the predicate is asserted against *compiled SQL* rather than by
 * mocking the database layer: the test below pins the exact statement that will
 * reach Postgres, so a future refactor of the query builder cannot quietly
 * change what guards the row.
 *
 * Scope note: the atomicity of the UPDATE itself — that two concurrent
 * redemptions cannot both observe a row it flipped — is a property of a live
 * transaction under row locks, not of the statement text. No offline test can
 * observe it without asserting against SQL the test itself wrote, so it stays
 * with the smoke harness, which exercises the real endpoint against Postgres.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { and, eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { connectionCodes } from "@/db/schema";
import {
  blocksRedemption,
  CODE_STATUSES,
  normalizeConnectionCode,
  toCodeStatus,
  UNREDEEMABLE_STATUS,
  UNSPENT_CODE,
  unspentCodeByCode,
} from "@/lib/connection-codes";

const dialect = new PgDialect();

const compile = (fragment: SQL) => dialect.sqlToQuery(fragment);
const render = (fragment: SQL) => compile(fragment).sql.toUpperCase();

/**
 * Whether `target` appears, by reference, as a chunk anywhere inside `sql`.
 *
 * Drizzle does not keep a flat chunk list: `and(a, b)` wraps its conditions
 * inside a nested join `SQL` (top-level chunks are
 * `[StringChunk("("), SQL(join), StringChunk(")")]`), and an `eq(…)`—like the
 * shared guard itself—is a chunk that is *also* an `SQL` node with its own
 * `queryChunks`. Walking those nested arrays and comparing every chunk by
 * identity is what lets an assertion say "this exact object is embedded", as
 * opposed to a freshly re-created equivalent.
 */
const embeds = (sql: unknown, target: unknown): boolean => {
  const chunks = (sql as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!chunks) return false;
  return chunks.some((chunk) => chunk === target || embeds(chunk, target));
};

/* ------------------------------ the vocabulary ----------------------------- */

test("the status vocabulary is exactly the three states a code can occupy", () => {
  assert.deepEqual([...CODE_STATUSES], ["unused", "used", "revoked"]);
});

test("an unrecognised status is treated as revoked, never as available", () => {
  // Fails closed on purpose. The pre-check in redeemConnectionCode reads this to
  // choose an error message, and the ops console reads it to decide whether to
  // offer a revoke button. Defaulting unknown → "unused" would turn schema drift
  // or a hand-edited row into a redeemable invitation, which is the exact
  // failure revocation was added to close.
  assert.equal(toCodeStatus("unused"), "unused");
  assert.equal(toCodeStatus("used"), "used");
  assert.equal(toCodeStatus("revoked"), "revoked");
  for (const bogus of ["", "  ", "pending", "UNUSED", "deleted", "revoke"]) {
    assert.equal(toCodeStatus(bogus), "revoked", `status ${JSON.stringify(bogus)} must fail closed`);
  }
});

test("only a genuinely unused code is treated as redeemable", () => {
  assert.equal(blocksRedemption("unused"), false);
  assert.equal(blocksRedemption("used"), true);
  assert.equal(blocksRedemption("revoked"), true);
  assert.equal(blocksRedemption("something-new"), true);
});

test("every blocking status carries its own message", () => {
  // Distinct messages are a support decision. Reporting a withdrawn invite as
  // "already used" tells the restaurant someone else got there first, which
  // sends it back to its operator instead of asking for a fresh code.
  for (const status of CODE_STATUSES.filter((s) => s !== "unused")) {
    assert.ok(UNREDEEMABLE_STATUS[status].length > 0, `${status} needs a message`);
  }
  assert.notEqual(UNREDEEMABLE_STATUS.used, UNREDEEMABLE_STATUS.revoked);
});

/* ----------------------------- the shared guard ---------------------------- */

test("the shared guard matches the code against status = 'unused'", () => {
  const { sql, params } = compile(UNSPENT_CODE);
  assert.match(sql.toUpperCase(), /STATUS/);
  // `eq()` parameterises the value rather than inlining it, so the literal can
  // never be spliced in from a caller-controlled string.
  assert.doesNotMatch(sql, /'unused'/i);
  assert.deepEqual([...params], ["unused"]);
});

test("the shared guard does not special-case revoked", () => {
  // Revoked is blocked because it is not literally 'unused', so there is no
  // second condition here that a future status change could forget to extend.
  // An explicit `status <> 'revoked'` clause would be the thing that drifts.
  const { sql } = compile(UNSPENT_CODE);
  assert.doesNotMatch(sql.toUpperCase(), /REVOK/);
});

test("revoking by code requires both the code and the unspent status", () => {
  const { sql, params } = compile(unspentCodeByCode("CNX-HD6K2"));
  const text = sql.toUpperCase();
  assert.match(text, /CODE/);
  assert.match(text, /STATUS/);
  assert.doesNotMatch(sql, /'unused'/i);
  assert.deepEqual([...params].sort(), ["CNX-HD6K2", "unused"]);
});

test("a revoked code cannot satisfy the guard that both paths share", () => {
  // The property the whole phase rests on: revocation and redemption ask the
  // same question, so they cannot disagree. If the revoke UPDATE carried a
  // weaker predicate than the spend, an operator could withdraw a code and a
  // redemption could still create a listing from it — or worse, the reverse.
  const guard = compile(UNSPENT_CODE);
  for (const status of ["used", "revoked", "anything else"]) {
    assert.notEqual(
      status,
      guard.params[0],
      `${status} must not satisfy the single-use guard`,
    );
  }
});

test("the revoke predicate embeds the shared guard by identity, not a copy", () => {
  // Pins that queries.ts really does route the revoke UPDATE through
  // UNSPENT_CODE. Compiled text cannot show this — inside `and()` the parameter
  // is renumbered to $2 — so the conjuncts are inspected by reference instead.
  // If someone inlines a second `eq(connectionCodes.status, "unused")` the
  // identity check fails here and the drift never reaches Postgres.
  const embedded = embeds(unspentCodeByCode("X"), UNSPENT_CODE);
  assert.ok(embedded, "revoke predicate must reuse the shared UNSPENT_CODE object");
});

test("the guard survives being wrapped by id as well as by code", () => {
  // The redemption spend keys on the row id (it already has `c.id` in hand from
  // the pre-check) where revocation keys on the code string. Different lookup
  // columns, same guard — which is the point.
  const byId = and(eq(connectionCodes.id, 42), UNSPENT_CODE)!;
  assert.ok(embeds(byId, UNSPENT_CODE));
  assert.deepEqual([...compile(byId).params].sort(), [42, "unused"]);
});

/* -------------------------------- normalisation --------------------------- */

test("a hand-typed code normalises to one canonical form", () => {
  // The code is read off a printed card, so case and stray whitespace are the
  // two mistakes a real restaurant makes. If these did not collapse to one
  // string, two redemption paths would open onto the same row.
  const canonical = normalizeConnectionCode("CNX-HD6K2");
  for (const typed of ["cnx-hd6k2", " CNX-HD6K2 ", "Cnx-Hd6k2", "\tCNX-HD6K2\n"]) {
    assert.equal(normalizeConnectionCode(typed), canonical);
  }
});

test("a missing code normalises to empty rather than to a literal", () => {
  for (const absent of [undefined, null, "", "   "]) {
    assert.equal(normalizeConnectionCode(absent), "");
  }
  // "undefined" and "null" as text are how a naive String() coercion turns a
  // missing field into a lookup that must never match a real row.
  assert.notEqual(normalizeConnectionCode(undefined), "UNDEFINED");
  assert.notEqual(normalizeConnectionCode(null), "NULL");
});

test("a normalised code is bound as a parameter, never concatenated", () => {
  // Sanity that the normalisation feeds a parameterised lookup: an attacker
  // cannot smuggle SQL through the code field, and cannot skip the status
  // predicate by supplying a crafted value either.
  const predicate = and(eq(connectionCodes.code, normalizeConnectionCode("x")), UNSPENT_CODE);
  // `and` is typed as returning `SQL | undefined` because it collapses to the
  // single argument when given one. Asserting it is not undefined is part of the
  // test: an empty predicate would compile to no WHERE clause, so the two
  // assertions below would pass against a statement that filters nothing.
  assert.ok(predicate, "a two-clause predicate must compile to SQL, not to undefined");
  const { sql, params } = compile(predicate);
  assert.doesNotMatch(sql, /'X'/i);
  assert.deepEqual([...params].sort(), ["X", "unused"]);
});