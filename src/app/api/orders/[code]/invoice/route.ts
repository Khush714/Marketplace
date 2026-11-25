import { getOrderByCode } from "@/db/queries";
import { guardRead } from "@/lib/abuse";
import { invoiceDocument, invoiceHtml } from "@/lib/invoice-core";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

/** Downloadable platform payment receipt for an order the caller can already track. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = guardRead(req, "invoiceRead");
  if (blocked) return blocked;

  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

  const invoiceOrder = {
    code: order.code,
    createdAt: order.createdAt,
    restaurantName: order.restaurantName,
    customerName: order.customerName,
    addressText: order.addressText,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    items: order.items,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    platformFeeCents: order.platformFeeCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
  };
  const doc = invoiceDocument(invoiceOrder);
  return new Response(invoiceHtml(invoiceOrder), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${doc.documentNumber}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
