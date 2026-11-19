/**
 * Pure policy and DTO mapping for order-scoped support threads.
 *
 * No `server-only`, no database, no clock: the browser, the customer route and
 * the ops routes all share these rules. That split is what makes the trust
 * boundary testable — a caller may propose a message body and an ops caller may
 * propose a status, but neither may assert an author, a timestamp, a thread id
 * or another order's conversation. Author roles are fixed by the route that
 * writes them, never read from the payload.
 */

/** Longest message accepted. A support reply is a sentence or two, not a document. */
export const MAX_SUPPORT_MESSAGE_CHARS = 1000;

/** Hard ceiling on messages returned to either surface in one read. */
export const MAX_SUPPORT_MESSAGES = 200;

/** Thread states. A customer message reopens a resolved thread. */
export const SUPPORT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** DTO-facing author, deliberately lower-case for the two chat bubbles. */
export type SupportAuthor = "customer" | "ops";

/**
 * A message body is required, trimmed and bounded. `field` lets the ops reply
 * route accept the same rule under its own field name without a second parser.
 */
export function parseSupportMessage(body: Record<string, unknown>, field = "message"): string | null {
  const raw = body[field];
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, MAX_SUPPORT_MESSAGE_CHARS);
  return text || null;
}

/** Ops may only move a thread to one of the two known states. */
export function parseSupportStatus(body: Record<string, unknown>): SupportStatus | null {
  const status = body.status;
  return status === "OPEN" || status === "RESOLVED" ? status : null;
}

/** Ops list filter: one state, or every thread. Unknown values mean "all". */
export function supportStatusFilter(raw: string | null | undefined): SupportStatus | "all" {
  return raw === "OPEN" || raw === "RESOLVED" ? raw : "all";
}

/** Reject a malformed thread id before it reaches a uuid-typed column. */
const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSupportThreadId(value: string | undefined): value is string {
  return typeof value === "string" && THREAD_ID_RE.test(value);
}

function mapAuthor(role: string): SupportAuthor {
  return role === "OPS" ? "ops" : "customer";
}

export type SupportMessageRow = {
  id: string;
  authorRole: string;
  body: string;
  createdAt: Date;
};

export function supportMessageDto(row: SupportMessageRow) {
  return {
    id: row.id,
    author: mapAuthor(row.authorRole),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SupportMessageDto = ReturnType<typeof supportMessageDto>;

export type SupportThreadRow = {
  id: string;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

/** Customer-facing thread; no order code or internal id leaks past the DTO. */
export function supportThreadDto(row: SupportThreadRow, messages: readonly SupportMessageRow[]) {
  return {
    id: row.id,
    status: row.status === "RESOLVED" ? "resolved" as const : "open" as const,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    messages: messages.map(supportMessageDto),
  };
}

export type SupportThreadDto = ReturnType<typeof supportThreadDto>;

export type OpsSupportThreadRow = SupportThreadRow & {
  lastMessage: string;
  lastAuthorRole: string;
  lastMessageAt: Date;
  orderCode: string;
  restaurantName: string;
  customerName: string;
};

/** Ops list row: a summary only, with the denormalised last message as preview. */
export function opsSupportThreadDto(row: OpsSupportThreadRow) {
  return {
    id: row.id,
    status: row.status === "RESOLVED" ? "resolved" as const : "open" as const,
    messageCount: row.messageCount,
    preview: row.lastMessage,
    lastAuthor: mapAuthor(row.lastAuthorRole),
    lastMessageAt: row.lastMessageAt.toISOString(),
    orderCode: row.orderCode,
    restaurantName: row.restaurantName,
    customerName: row.customerName,
  };
}

export type OpsSupportThreadDto = ReturnType<typeof opsSupportThreadDto>;

export type OpsSupportThreadDetail = SupportThreadDto & {
  orderCode: string;
  restaurantName: string;
  customerName: string;
};
