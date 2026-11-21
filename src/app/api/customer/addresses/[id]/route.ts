import { NextRequest } from "next/server";

import { guardWrite, readJsonBody } from "@/lib/abuse";
import { deleteCustomerAddress, updateCustomerAddress } from "@/db/customer-accounts";
import { requireAccountSession } from "@/lib/security/customer-account-session";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function toAddressDto(a: { id: number; label: string; text: string; isDefault: boolean }) {
  return { id: String(a.id), label: a.label, text: a.text, isDefault: a.isDefault };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return Response.json({ ok: false, error: "Address not found" }, { status: 404 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { label?: unknown; text?: unknown; isDefault?: unknown };

  const updated = await updateCustomerAddress(auth.session.account.id, id, {
    label: body.label,
    text: body.text,
    isDefault: typeof body.isDefault === "boolean" ? body.isDefault : undefined,
  });
  if (!updated) return Response.json({ ok: false, error: "Address not found" }, { status: 404 });

  return Response.json({ ok: true, address: toAddressDto(updated) });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return Response.json({ ok: false, error: "Address not found" }, { status: 404 });

  const deleted = await deleteCustomerAddress(auth.session.account.id, id);
  if (!deleted) return Response.json({ ok: false, error: "Address not found" }, { status: 404 });

  return Response.json({ ok: true });
}
