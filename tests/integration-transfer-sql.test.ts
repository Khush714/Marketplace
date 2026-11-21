/**
 * Regression guards for the open-order predicate used when approving an
 * identity transfer.
 *
 * These exist because the first version of that predicate was broken in a way
 * that typechecked, unit-tested cleanly, and only failed against a real
 * database: `count(*) FILTER (WHERE …)` is idiomatic Postgres, but FILTER is a
 * reserved word and drizzle emits the fragment unquoted, so Postgres rejected
 * the whole statement with 42601 "syntax error at or near filter" and the live
 * approval endpoint returned 500.
 *
 * Scope note: the *other* defect fixed alongside this one — granting the
 * identity before clearing the holder, which the immediate (non-deferred)
 * unique constraint on `restaurants.marketplace_id` rejects unconditionally —
 * is a statement-ordering property of a live transaction. No offline test can
 * observe it without asserting against SQL the test itself wrote, so it is
 * covered by the smoke harness instead, which exercises the real endpoint.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { OPEN_ORDER_PREDICATE } from "@/lib/integration-transfer";
import { TERMINAL_STATUSES } from "@/integrations/pos/order-status";

const dialect = new PgDialect();

/** Compiles a fragment to the statement and parameters it would send. */
const compile = (fragment: SQL) => dialect.sqlToQuery(fragment);
/** Upper-cased statement text, for keyword assertions. */
const render = (fragment: SQL) => compile(fragment).sql.toUpperCase();

test("the open-order predicate parameterises the terminal set instead of inlining it", () => {
  const { sql: text, params } = compile(OPEN_ORDER_PREDICATE);

  assert.match(text.toUpperCase(), /NOT IN/);
  // `notInArray` emits $n placeholders, so a terminal status can never be
  // spliced into the statement as a literal.
  assert.doesNotMatch(text, /'COMPLETED'/);
  assert.doesNotMatch(text, /'CANCELLED'/);
  assert.doesNotMatch(text, /'REJECTED'/);
  assert.deepEqual([...params].sort(), [...TERMINAL_STATUSES].sort());
});

test("the open-order predicate stays derived from the status vocabulary", () => {
  // The set is spread into the predicate rather than re-typed, so adding a
  // terminal status cannot leave "still mid-flight" counts quietly wrong.
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ["CANCELLED", "COMPLETED", "REJECTED"]);
});

test("the open-order count never emits the reserved word FILTER", () => {
  const open = sql<number>`sum(case when ${OPEN_ORDER_PREDICATE} then 1 else 0 end)::int`;
  assert.doesNotMatch(render(open), /FILTER/);
});

test("sanity: the rejected spelling really is what 500s", () => {
  // Pins the original defect, so a future "cleanup" back to the idiomatic form
  // fails here instead of in production.
  const idiomatic = sql<number>`count(*)::int filter (where ${OPEN_ORDER_PREDICATE})`;
  assert.match(render(idiomatic), /FILTER/);
});

test("the cast encloses a completed aggregate", () => {
  // `count(*)::int filter (…)` applies the cast to the argument and leaves
  // FILTER dangling after it; the cast has to wrap the whole aggregate.
  assert.match(render(sql<number>`sum(case when true then 1 else 0 end)::int`), /SUM\(/);
});
