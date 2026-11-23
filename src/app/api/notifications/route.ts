import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { isInboxToken } from "@/lib/customer-notification-copy";
import {
  hashInboxToken,
  listCustomerNotifications,
  markCustomerNotificationsRead,
} from "@/lib/customer-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_MARK_IDS = 100;

/**
 * Device-scoped notification inbox. The raw token is never sent to the database:
 * it is validated here, hashed, and the hash is the only capability used for
 * reads/writes. There is deliberately no account-session requirement — the inbox
 * survives a signed-out browser and is tied to this device, not a customer.
 */
export async function GET(req: Request) {
  const throttled = guardRead(req, "notificationRead");
  if (throttled) return throttled;

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!isInboxToken(token)) {
    return Response.json({ ok: false, error: "Invalid notification token" }, { status: 400, headers: NO_STORE });
  }

  const inboxHash = hashInboxToken(token);
  const inbox = await listCustomerNotifications(inboxHash, 50);
  return Response.json(inbox, { headers: NO_STORE });
}

/** Mark one, several, or all notifications read — only inside this token's inbox. */
export async function PATCH(req: Request) {
  const blocked = await guardWrite(req, "notificationWrite");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown> | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!isInboxToken(token)) {
    return Response.json({ ok: false, error: "Invalid notification token" }, { status: 400, headers: NO_STORE });
  }

  let ids: number[] | "all" = "all";
  if (body?.all !== true) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > MAX_MARK_IDS) {
      return Response.json(
        { ok: false, error: "Choose a notification to mark as read" },
        { status: 400, headers: NO_STORE },
      );
    }
    const parsedIds: number[] = [];
    for (const value of body.ids) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        return Response.json({ ok: false, error: "Invalid notification id" }, { status: 400, headers: NO_STORE });
      }
      parsedIds.push(value);
    }
    ids = parsedIds;
  }

  const inboxHash = hashInboxToken(token);
  const updated = await markCustomerNotificationsRead(inboxHash, ids);
  return Response.json(
    { ok: true, updated, ...(await listCustomerNotifications(inboxHash, 50)) },
    { headers: NO_STORE },
  );
}
