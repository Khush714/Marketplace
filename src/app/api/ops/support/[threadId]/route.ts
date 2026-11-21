import { NextRequest } from "next/server";
import { opsReplyToSupportThread, opsSetSupportStatus, opsSupportThread } from "@/db/support";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { requireOpsToken } from "@/lib/ops-auth";
import { isSupportThreadId, parseSupportMessage, parseSupportStatus } from "@/lib/support-core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ threadId: string }> };

/**
 * One support thread for ops: read the conversation, reply, or resolve/reopen.
 * Each handler charges its budget before the ops token check, validates the id
 * before it reaches a uuid column, and re-parses the body so no author role or
 * timestamp can be asserted by the caller.
 */

export async function GET(req: NextRequest, ctx: Ctx) {
  const blocked = guardRead(req, "opsSupportRead");
  if (blocked) return blocked;
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { threadId } = await ctx.params;
  if (!isSupportThreadId(threadId)) return Response.json({ error: "Not found" }, { status: 404 });
  const thread = await opsSupportThread(threadId);
  if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, thread });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const blocked = await guardWrite(req, "opsSupportWrite");
  if (blocked) return blocked;
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { threadId } = await ctx.params;
  if (!isSupportThreadId(threadId)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
    ? parseSupportMessage(parsed.body as Record<string, unknown>)
    : null;
  if (!input) {
    return Response.json({ ok: false, error: "Write a reply before sending." }, { status: 400 });
  }

  const result = await opsReplyToSupportThread(threadId, input);
  if (result.kind === "NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, thread: result.thread });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const blocked = await guardWrite(req, "opsSupportWrite");
  if (blocked) return blocked;
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const { threadId } = await ctx.params;
  if (!isSupportThreadId(threadId)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const status = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
    ? parseSupportStatus(parsed.body as Record<string, unknown>)
    : null;
  if (!status) {
    return Response.json({ ok: false, error: "Choose OPEN or RESOLVED." }, { status: 400 });
  }

  const result = await opsSetSupportStatus(threadId, status);
  if (result.kind === "NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, thread: result.thread });
}
