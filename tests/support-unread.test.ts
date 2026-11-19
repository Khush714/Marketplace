/**
 * Unread support replies are a server-side watermark, not a browser flag. A
 * clear of localStorage must not resurrect a reply the customer already read,
 * and a client must not be able to clear a badge by writing web storage. These
 * source assertions pin the migration, the guarded mark-read route, the list
 * projection and the two places the badge is rendered.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("the migration adds a nullable watermark without backfilling PII", () => {
  const migration = source("src/db/migrations/20261122_support_unread.sql");
  assert.match(migration, /ALTER TABLE public\.support_threads/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS customer_last_read_at timestamptz/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDROP\b/, "a watermark needs no backfill or destructive step");

  const schema = source("src/db/schema.ts");
  assert.match(schema, /customerLastReadAt: timestamp\("customer_last_read_at", \{ withTimezone: true \}\)/);
});

test("the watermark is stamped on customer replies and on an explicitly read thread", () => {
  const db = source("src/db/support.ts");
  assert.match(db, /customerLastReadAt: message\.createdAt/, "sending a reply acknowledges earlier ops answers");
  assert.match(db, /export async function markSupportThreadRead\(code: string\)/);
  assert.match(db, /lastMessageAt: supportThreads\.lastMessageAt[\s\S]*?\.for\("update"\)/);
  assert.match(db, /customerLastReadAt: thread\.lastMessageAt/, "mark-read must not swallow a newer reply");
  assert.match(db, /export async function unreadSupportCodes/);
  assert.match(db, /rows\.filter\(hasUnreadOpsReply\)/, "list badges use the same pure rule as the thread DTO");
});

test("both order lists attach the badge after the caller has been authorised", () => {
  const publicOrder = source("src/lib/order-public.ts");
  assert.match(publicOrder, /unreadOpsReply\?: boolean/);

  const history = source("src/app/api/orders/history/route.ts");
  assert.match(history, /unreadSupportCodes\(codes\)/);
  assert.match(history, /unreadOpsReply: unread\.has\(row\.code\)/);

  const lookup = source("src/app/api/orders/lookup/route.ts");
  assert.match(lookup, /unreadSupportCodes\(verified\.map\(\(v\) => v\.code\)\)/);
  assert.match(lookup, /unreadOpsReply: unread\.has\(order\.code\)/);
});

test("mark-read is a guarded, credential-gated write that returns the fresh thread", () => {
  const route = source("src/app/api/orders/[code]/support/read/route.ts");
  assert.match(route, /guardWrite\(req, "supportMarkRead"\)/);
  assert.match(route, /orderAuthorized\(req, code\)/);
  assert.ok(route.indexOf("guardWrite") < route.indexOf("orderAuthorized"), "charge the budget before the credential");
  assert.match(route, /await markSupportThreadRead\(code\)/);
  assert.match(route, /thread: result\.thread/);

  const abuse = source("src/lib/abuse-core.ts");
  assert.match(abuse, /supportMarkRead: \{ limit: 30, windowMs: 10 \* MINUTE_MS \}/);
});

test("the support card shows the badge and only pings after an explicit opt-in", () => {
  const support = source("src/components/order-support.tsx");
  assert.match(support, /thread\?\.unreadOpsReply/);
  assert.match(support, /New reply/);
  assert.match(support, /\/api\/orders\/\$\{encodeURIComponent\(code\)\}\/support\/read`/);
  assert.match(support, /new Notification\(`New reply about order \$\{code\}`/);

  const permissionEffect = support.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/)?.[0] ?? "";
  assert.match(permissionEffect, /Notification\.permission/, "the effect only reads the current permission");
  assert.doesNotMatch(permissionEffect, /requestPermission/, "permission must be requested from a click");
  assert.match(support, /onClick=\{\(\) => \{ void requestNotify\(\); \}\}/);
  assert.doesNotMatch(support, /unreadOpsReply:\s*true/, "the badge comes from the server, never a client flag");
});

test("the history card renders the server-provided reply badge", () => {
  const page = source("src/app/orders/page.tsx");
  assert.match(page, /o\.unreadOpsReply/);
  assert.match(page, /New support reply/);
  assert.doesNotMatch(page, /unreadOpsReply:\s*true/, "history must not manufacture an unread reply");
});
