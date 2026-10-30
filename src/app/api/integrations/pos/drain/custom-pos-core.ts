import { createHmac, timingSafeEqual } from "node:crypto";

export const CUSTOM_POS_HEADER_SIGNATURE = "x-savour-signature";
export const CUSTOM_POS_HEADER_TIMESTAMP = "x-savour-timestamp";
export const CUSTOM_POS_MAX_REPLAY_SECONDS = 300; // 5-minute replay window

export interface CustomPosOrderPayload {
  event: "order.created";
  orderId: string;
  orderNumber: string;
  restaurantId: number;
  restaurantSlug: string;
  orderType: "delivery" | "pickup";
  createdAt: string;
  customer: {
    name: string;
    phone: string;
    address?: string | null;
  };
  items: {
    id: string;
    name: string;
    quantity: number;
    pricePaise: number;
    priceFormatted: string;
    notes?: string | null;
  }[];
  totals: {
    subtotalPaise: number;
    taxPaise: number;
    deliveryFeePaise: number;
    grandTotalPaise: number;
    grandTotalFormatted: string;
  };
  payment: {
    status: "PAID";
    method: "ONLINE";
  };
}

export function computeCustomPosSignature(
  rawBody: string,
  timestamp: string | number,
  secret: string
): string {
  const message = `${timestamp}\n${rawBody}`;
  const digest = createHmac("sha256", secret.trim()).update(message, "utf8").digest("hex");
  return `sha256=${digest}`;
}

export function verifyCustomPosSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowEpochSeconds?: number;
}): { valid: boolean; reason?: string } {
  if (!input.timestamp || !input.signature || !input.secret) {
    return { valid: false, reason: "MISSING_CREDENTIALS" };
  }

  const timestampNum = parseInt(input.timestamp, 10);
  if (isNaN(timestampNum)) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }

  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > CUSTOM_POS_MAX_REPLAY_SECONDS) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_WINDOW" };
  }

  const expected = computeCustomPosSignature(input.rawBody, input.timestamp, input.secret);
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(input.signature);

  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { valid: true };
}

export function buildCustomPosPayload(order: any): CustomPosOrderPayload {
  return {
    event: "order.created",
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId,
    restaurantSlug: order.restaurantSlug,
    orderType: order.type,
    createdAt: order.createdAt.toISOString(),
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      address: order.deliveryAddress ?? null,
    },
    items: (order.items || []).map((it: any) => ({
      id: it.id,
      name: it.name,
      quantity: it.qty,
      pricePaise: it.pricePaise,
      priceFormatted: `₹${((it.pricePaise || 0) / 100).toFixed(2)}`,
      notes: it.notes ?? null,
    })),
    totals: {
      subtotalPaise: order.subtotalPaise || 0,
      taxPaise: order.taxPaise || 0,
      deliveryFeePaise: order.deliveryFeePaise || 0,
      grandTotalPaise: order.totalPaise || 0,
      grandTotalFormatted: `₹${((order.totalPaise || 0) / 100).toFixed(2)}`,
    },
    payment: {
      status: "PAID",
      method: "ONLINE",
    },
  };
}