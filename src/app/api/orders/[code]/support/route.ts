import { customerSendSupportMessage, customerSupportThread } from "@/db/support";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { orderAuthorized } from "@/lib/order-authorized";
import { parseSupportMessage } from "@/lib/support-core";

export const dynamic = "force-dynamic";

/**
 * Customer support for one order. The code alone is not a credential — the
 * signed token minted at checkout or a session bound to that code is — and the
 * message body is parsed again here. The author role, order identity and
 * timestamps are fixed server-side, so a caller cannot post an "ops" reply or
 * attach a message to another order.
 */

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const blocked = guardRead(req, "supportRead");
  if (blocked) return blocked;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const result = await customerSupportThread(code);
  if (!result.orderFound) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, thread: result.thread });
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const blocked = await guardWrite(req, "supportWrite");
  if (blocked) return blocked;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
    ? parseSupportMessage(parsed.body as Record<string, unknown>)
    : null;
  if (!input) {
    return Response.json({ ok: false, error: "Write a message before sending." }, { status: 400 });
  }

  const result = await customerSendSupportMessage(code, input);
  if (result.kind === "NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
  if (result.kind === "CONFLICT") {
    return Response.json({ ok: false, error: "Please try again." }, { status: 409 });
  }
  return Response.json({ ok: true, thread: result.thread });
}
