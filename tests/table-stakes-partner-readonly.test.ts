import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("the KDS and print board only reads orders and never writes fulfilment", () => {
  const board = readSource("src/components/kds-board.tsx");

  assert.match(board, /\/api\/partner\/orders/);
  assert.match(board, /POS is authoritative/);
  assert.match(board, /RequirePartnerSession/);
  assert.doesNotMatch(board, /method:\s*["'](POST|PATCH|DELETE)["']/, "read-only views must not write");
  assert.doesNotMatch(board, /\/api\/partner\/orders\/[^\s"']/, "no per-order status route is used");
});

test("print tickets are bounded to one valid order code and use print-only styles", () => {
  const board = readSource("src/components/kds-board.tsx");
  const kdsPage = readSource("src/app/partner/kds/page.tsx");
  const printPage = readSource("src/app/partner/print/page.tsx");

  assert.match(board, /@media print/);
  assert.match(board, /window\.print\(\)/);
  assert.match(board, /partner-print-hide/);

  for (const source of [kdsPage, printPage]) {
    assert.match(source, /export const metadata: Metadata/);
    assert.match(source, /\.\.\.NOINDEX/);
    assert.match(source, /from "@\/lib\/seo"/);
  }
  assert.match(printPage, /searchParams: Promise<\{ code\?: string \| string\[\] \}/);
  assert.match(printPage, /A-Za-z0-9_-/);
  assert.match(printPage, /initialCode=\{code\}/);
});

test("the audit route gates, bounds and redacts before it returns rows", () => {
  const route = readSource("src/app/api/ops/integration-audit/route.ts");

  const guardAt = route.indexOf('guardRead(req, "auditRead")');
  const tokenAt = route.indexOf("requireOpsToken(req)");
  assert.ok(guardAt >= 0 && tokenAt > guardAt, "the read budget must run before the ops token check");
  assert.doesNotMatch(route, /req\.json\(/, "the audit route must not parse a request body");

  assert.match(route, /boundedInt\(params\.get\("limit"\)/);
  assert.match(route, /boundedInt\(params\.get\("offset"\)/);
  assert.match(route, /MAX_LIMIT = 100/);
  assert.match(route, /parseAuditActor\(params\.get\("actor"\)\)/);
  assert.match(route, /restaurant_id/);
  assert.match(route, /Cache-Control": "no-store"/);

  const redactAt = route.indexOf("redactAuditDetail(row.detail)");
  const responseAt = route.indexOf("Response.json(");
  assert.ok(redactAt >= 0 && responseAt > redactAt, "details must be redacted before the response");
  assert.match(route, /maskIp\(row\.ipAddress\)/);
  assert.match(route, /actors: AUDIT_ACTORS/);
});

test("the ops audit panel is read-only and uses the shared token-bearing call", () => {
  const ops = readSource("src/app/ops/ops-console.tsx");
  const panel = functionSource(ops, "IntegrationAuditPanel");

  assert.match(panel, /\/api\/ops\/integration-audit/);
  assert.match(panel, /<details/);
  assert.doesNotMatch(panel, /method:\s*["'](POST|PATCH|DELETE)["']/, "the audit panel must not write");
  assert.match(ops, /x-ops-token/);
  assert.doesNotMatch(ops, /@\/db\/audit-read/, "server-only audit helpers must not reach the browser");
});
