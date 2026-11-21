/**
 * Support chat is another browser boundary: a caller may propose a message and
 * an ops caller may propose a status, but never an author, a timestamp or an
 * order identity. These tests pin the pure rules shared by both surfaces.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUPPORT_MESSAGE_CHARS,
  customerSupportThreadDto,
  hasUnreadOpsReply,
  isSupportThreadId,
  opsSupportThreadDto,
  parseSupportMessage,
  parseSupportStatus,
  supportMessageDto,
  supportStatusFilter,
  supportThreadDto,
  type OpsSupportThreadRow,
} from "../src/lib/support-core";

test("a support message is trimmed, bounded and required", () => {
  assert.equal(parseSupportMessage({ message: "  Where is my order?  " }), "Where is my order?");
  assert.equal(parseSupportMessage({ message: "x".repeat(MAX_SUPPORT_MESSAGE_CHARS + 50) })?.length, MAX_SUPPORT_MESSAGE_CHARS);
  assert.equal(parseSupportMessage({ message: "   " }), null);
  assert.equal(parseSupportMessage({ message: 42 }), null);
  assert.equal(parseSupportMessage({}), null);
  assert.equal(parseSupportMessage({ reply: "  Fine  " }, "reply"), "Fine");
});

test("the body cannot assert an author or a timestamp", () => {
  const parsed = parseSupportMessage({
    message: "I am still waiting",
    authorRole: "OPS",
    createdAt: "2020-01-01T00:00:00.000Z",
    orderCode: "CRV-OTHER",
  });
  assert.equal(parsed, "I am still waiting");
  assert.deepEqual(
    supportMessageDto({
      id: "m1",
      authorRole: "CUSTOMER",
      body: parsed ?? "",
      createdAt: new Date("2026-11-21T10:00:00.000Z"),
    }),
    {
      id: "m1",
      author: "customer",
      body: "I am still waiting",
      createdAt: "2026-11-21T10:00:00.000Z",
    },
  );
  assert.equal(
    supportMessageDto({ id: "m2", authorRole: "OPS", body: "On it", createdAt: new Date(0) }).author,
    "ops",
  );
});

test("only the two thread states are accepted", () => {
  assert.equal(parseSupportStatus({ status: "OPEN" }), "OPEN");
  assert.equal(parseSupportStatus({ status: "RESOLVED" }), "RESOLVED");
  assert.equal(parseSupportStatus({ status: "open" }), null);
  assert.equal(parseSupportStatus({ status: "DELETED" }), null);
  assert.equal(parseSupportStatus({}), null);
  assert.equal(supportStatusFilter("OPEN"), "OPEN");
  assert.equal(supportStatusFilter("RESOLVED"), "RESOLVED");
  assert.equal(supportStatusFilter("anything"), "all");
  assert.equal(supportStatusFilter(null), "all");
});

test("thread ids are uuids before they reach a typed column", () => {
  const id = "9f5b0f7e-2a1c-4d6b-8e93-0c1f2a3b4c5d";
  assert.equal(isSupportThreadId(id), true);
  assert.equal(isSupportThreadId(id.toUpperCase()), true);
  assert.equal(isSupportThreadId("not-a-uuid"), false);
  assert.equal(isSupportThreadId("1; DROP TABLE support_threads;--"), false);
  assert.equal(isSupportThreadId(undefined), false);
});

test("the customer DTO exposes the conversation, not internal order data", () => {
  const dto = supportThreadDto(
    {
      id: "t1",
      status: "RESOLVED",
      messageCount: 2,
      createdAt: new Date("2026-11-21T09:00:00.000Z"),
      updatedAt: new Date("2026-11-21T10:00:00.000Z"),
      resolvedAt: new Date("2026-11-21T10:00:00.000Z"),
    },
    [
      { id: "m1", authorRole: "CUSTOMER", body: "Help", createdAt: new Date("2026-11-21T09:00:00.000Z") },
      { id: "m2", authorRole: "OPS", body: "Done", createdAt: new Date("2026-11-21T10:00:00.000Z") },
    ],
  );
  assert.deepEqual(Object.keys(dto).sort(), [
    "createdAt", "id", "messageCount", "messages", "resolvedAt", "status", "updatedAt",
  ]);
  assert.equal(dto.status, "resolved");
  assert.deepEqual(dto.messages.map((m) => m.author), ["customer", "ops"]);
});

test("only a trailing ops reply after the watermark is unread", () => {
  const reply = new Date("2026-11-22T10:00:00.000Z");
  const older = new Date("2026-11-22T09:00:00.000Z");
  const newer = new Date("2026-11-22T11:00:00.000Z");
  assert.equal(hasUnreadOpsReply({ lastAuthorRole: "OPS", lastMessageAt: reply, customerLastReadAt: null }), true);
  assert.equal(hasUnreadOpsReply({ lastAuthorRole: "OPS", lastMessageAt: reply, customerLastReadAt: older }), true);
  assert.equal(hasUnreadOpsReply({ lastAuthorRole: "OPS", lastMessageAt: reply, customerLastReadAt: reply }), false);
  assert.equal(hasUnreadOpsReply({ lastAuthorRole: "OPS", lastMessageAt: reply, customerLastReadAt: newer }), false);
  // A customer reply closes the loop even for threads that predate the column.
  assert.equal(hasUnreadOpsReply({ lastAuthorRole: "CUSTOMER", lastMessageAt: reply, customerLastReadAt: null }), false);
});

test("the customer thread DTO adds the unread bit, not the watermark", () => {
  const dto = customerSupportThreadDto(
    {
      id: "t1",
      status: "OPEN",
      messageCount: 1,
      createdAt: new Date("2026-11-22T09:00:00.000Z"),
      updatedAt: new Date("2026-11-22T10:00:00.000Z"),
      resolvedAt: null,
      lastAuthorRole: "OPS",
      lastMessageAt: new Date("2026-11-22T10:00:00.000Z"),
      customerLastReadAt: null,
    },
    [{ id: "m1", authorRole: "OPS", body: "On it", createdAt: new Date("2026-11-22T10:00:00.000Z") }],
  );
  assert.deepEqual(Object.keys(dto).sort(), [
    "createdAt", "id", "messageCount", "messages", "resolvedAt", "status", "updatedAt", "unreadOpsReply",
  ].sort());
  assert.equal(dto.unreadOpsReply, true);
  assert.doesNotMatch(JSON.stringify(dto), /customerLastReadAt|lastMessageAt|lastAuthorRole/);
});

test("the ops list preview comes from the denormalised thread fields", () => {
  const row: OpsSupportThreadRow = {
    id: "t1",
    status: "OPEN",
    messageCount: 3,
    createdAt: new Date("2026-11-21T09:00:00.000Z"),
    updatedAt: new Date("2026-11-21T10:00:00.000Z"),
    resolvedAt: null,
    lastMessage: "A rider is on the way",
    lastAuthorRole: "OPS",
    lastMessageAt: new Date("2026-11-21T10:00:00.000Z"),
    orderCode: "CRV-12345",
    restaurantName: "Curry House",
    customerName: "Asha",
  };
  const dto = opsSupportThreadDto(row);
  assert.equal(dto.preview, "A rider is on the way");
  assert.equal(dto.lastAuthor, "ops");
  assert.equal(dto.orderCode, "CRV-12345");
  assert.equal(dto.status, "open");
});
