import { NextRequest } from "next/server";

import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { CUSTOMER_MAX_ADDRESSES } from "@/lib/customer-account-core";
import { createCustomerAddress, listCustomerAddresses } from "@/db/customer-accounts";
import { requireAccountSession } from "@/lib/security/customer-account-session";

export const dynamic = "force-dynamic";

function toAddressDto(a: { id: number; label: string; text: string; isDefault: boolean }) {
  return { id: String(a.id), label: a.label, text: a.text, isDefault: a.isDefault };
}

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, "customerAccountRead");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: false });
  if (!auth.ok) return auth.response;

  const rows = await listCustomerAddresses(auth.session.account.id);
  return Response.json({ ok: true, addresses: rows.map(toAddressDto) });
}

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { label?: unknown; text?: unknown; isDefault?: unknown };

  const existing = await listCustomerAddresses(auth.session.account.id);
  if (existing.length >= CUSTOMER_MAX_ADDRESSES) {
    return Response.json({ ok: false, error: "Address limit reached" }, { status: 400 });
  }

  const created = await createCustomerAddress(auth.session.account.id, {
    label: body.label,
    text: body.text,
    isDefault: body.isDefault === true,
  });
  if (!created) {
    return Response.json({ ok: false, error: "Unable to save address" }, { status: 400 });
  }

  return Response.json({ ok: true, address: toAddressDto(created) }, { status: 201 });
}
