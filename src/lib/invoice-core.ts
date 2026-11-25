/** Customer-safe, downloadable payment receipt. No GST taxonomy is asserted. */

import type { OrderItemSnapshot } from "@/db/schema";
import { orderItemLineTotalCents } from "@/db/schema";

export interface InvoiceOrder {
  code: string;
  createdAt: string;
  restaurantName: string;
  customerName: string;
  addressText: string;
  paymentStatus: string;
  paymentMethod: string;
  items: OrderItemSnapshot[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  tipCents: number;
  totalCents: number;
}

export function rupees(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

function esc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function invoiceDocument(order: InvoiceOrder) {
  const lines = order.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    amountCents: orderItemLineTotalCents(item),
  }));
  return {
    documentNumber: `RCP-${order.code}`,
    issuedAt: order.createdAt,
    restaurantName: order.restaurantName,
    customerName: order.customerName,
    addressText: order.addressText,
    paymentMethod: order.paymentMethod,
    lines,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    platformFeeCents: order.platformFeeCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    paymentStatus: order.paymentStatus,
  };
}

export function invoiceHtml(order: InvoiceOrder): string {
  const doc = invoiceDocument(order);
  const rows = doc.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.name)}</td><td class="num">${line.quantity}</td><td class="num">${rupees(line.amountCents)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.documentNumber)}</title>
<style>body{font:14px system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.num{text-align:right}.muted{color:#666}.total{font-weight:700;font-size:16px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(doc.restaurantName)}</h1><p class="muted">Payment receipt ${esc(doc.documentNumber)} · ${esc(doc.issuedAt)}</p>
<p><strong>Billed to:</strong> ${esc(doc.customerName)}<br>${esc(doc.addressText)}</p>
<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
<tr><td>Subtotal</td><td class="num">${rupees(doc.subtotalCents)}</td></tr>
<tr><td>Discount</td><td class="num">−${rupees(doc.discountCents)}</td></tr>
<tr><td>Delivery fee</td><td class="num">${rupees(doc.deliveryFeeCents)}</td></tr>
<tr><td>Platform fee</td><td class="num">${rupees(doc.platformFeeCents)}</td></tr>
<tr><td>Tip</td><td class="num">${rupees(doc.tipCents)}</td></tr>
<tr class="total"><td>Total paid / payable</td><td class="num">${rupees(doc.totalCents)}</td></tr>
</tbody></table><p class="muted">Payment status: ${esc(doc.paymentStatus)} · Method: ${esc(doc.paymentMethod)}</p>
<p class="muted">This is a platform payment receipt, not a GST tax invoice.</p>
</body></html>`;
}
