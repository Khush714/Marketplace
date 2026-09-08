import { num } from "./format";

/**
 * PHASE 9 pricing engine.
 * Deliberately dependency-free so it can run on the client (cart totals) and
 * on the server (order write path) with identical results.
 */

export type LineModifierSelection = {
  groupId: number;
  groupName: string;
  modifierId: number;
  modifierName: string;
  priceDelta: number;
};

export type LineInput = {
  menuItemId: number;
  name: string;
  basePrice: number;
  quantity: number;
  modifiers: LineModifierSelection[];
};

export type LinePriced = LineInput & {
  unitPrice: number; // basePrice + Σ modifier deltas
  lineTotal: number; // unitPrice × quantity
};

export type PricingInput = {
  lines: LineInput[];
  taxRate: number;             // e.g. 0.0875
  deliveryFee: number;         // 0 if pickup
  fulfillment: "delivery" | "pickup";
  discount?: {
    code: string;
    kind: "percent" | "flat";
    value: number;
    minSubtotal: number;
  } | null;
};

export type PricingResult = {
  lines: LinePriced[];
  subtotal: number;
  discountAmount: number;
  discountCode: string | null;
  discountError: string | null;
  taxableBase: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function priceCart(input: PricingInput): PricingResult {
  const lines: LinePriced[] = input.lines.map((l) => {
    const delta = l.modifiers.reduce((s, m) => s + num(m.priceDelta), 0);
    const unitPrice = round2(num(l.basePrice) + delta);
    return {
      ...l,
      unitPrice,
      lineTotal: round2(unitPrice * Math.max(1, Math.floor(l.quantity))),
    };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  let discountAmount = 0;
  let discountCode: string | null = null;
  let discountError: string | null = null;

  if (input.discount) {
    if (subtotal < input.discount.minSubtotal) {
      discountError = `Code ${input.discount.code} needs a subtotal of at least ${input.discount.minSubtotal.toFixed(2)}.`;
    } else {
      discountCode = input.discount.code;
      discountAmount =
        input.discount.kind === "percent"
          ? round2((subtotal * input.discount.value) / 100)
          : round2(Math.min(subtotal, input.discount.value));
    }
  }

  const taxableBase = round2(Math.max(0, subtotal - discountAmount));
  const taxAmount = round2(taxableBase * num(input.taxRate));
  const deliveryFee =
    input.fulfillment === "pickup" ? 0 : round2(num(input.deliveryFee));

  const total = round2(taxableBase + taxAmount + deliveryFee);

  return {
    lines,
    subtotal,
    discountAmount,
    discountCode,
    discountError,
    taxableBase,
    taxAmount,
    deliveryFee,
    total,
  };
}
