"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser side of the Razorpay checkout (Phase 6).
 *
 * Everything here is deliberately thin:
 *   - the ORDER already exists and a provider ORDER id is already allocated by
 *     the server, so the customer never pays for something we have not stored;
 *   - the instrument (UPI intent, card, netbanking, wallet) is chosen by the
 *     customer inside Razorpay's own UI — we never collect a PAN, a CVV, or a
 *     VPA in our own form, and we never render a QR we did not generate;
 *   - the checkout response is only a *claim*. It goes to
 *     /api/orders/[code]/pay/verify, which signature-verifies it and re-reads the
 *     money facts from the provider before anything is marked paid.
 *
 * `mode === "dev"` is the local stand-in for deployments with no Razorpay keys;
 * the server refuses to run it in production.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type ProviderMode = "razorpay" | "dev" | "unavailable";

export type PayPhase =
  | "starting"
  | "opening"
  | "verifying"
  | "confirming"
  | "paid"
  | "refunded"
  | "failed"
  | "cancelled";

export interface PaymentTarget {
  code: string;
  token: string;
  reference: string;
  providerOrderId: string | null;
  keyId: string | null;
  amountCents: number;
  currency: string;
  mode: ProviderMode;
  payeeName: string;
  customerName: string;
  phone: string;
}

interface CheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: { code?: string; description?: string; reason?: string };
  code?: string;
  description?: string;
  source?: string;
  step?: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", handler: (payload: RazorpayFailure) => void) => void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

/* ------------------------------ checkout.js ------------------------------ */

let scriptPromise: Promise<void> | null = null;

function loadCheckoutJs(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Payment is only available in a browser"));
  }
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => {
      if (window.Razorpay) resolve();
      else reject(new Error("Payment provider did not initialise"));
    };
    el.onerror = () => {
      scriptPromise = null;
      el.remove();
      reject(new Error("Could not reach the payment provider"));
    };
    document.body.appendChild(el);
  });
  return scriptPromise;
}

/* ------------------------------ server calls ------------------------------ */

interface StartResponse {
  ok?: boolean;
  error?: string;
  status?: string;
  reference?: string;
  providerOrderId?: string | null;
  keyId?: string | null;
  amountCents?: number;
  currency?: string;
  mode?: ProviderMode;
}

async function callOrder<T>(target: PaymentTarget, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-order-token": target.token,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return data;
}

function statusMessage(data: { error?: string }, fallback: string): string {
  const raw = (data.error ?? "").trim();
  return raw || fallback;
}

/* -------------------------------- polling -------------------------------- */

const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 16;

async function readPaymentStatus(
  target: PaymentTarget,
): Promise<{ status: string; orderStatus: string } | null> {
  try {
    const data = await callOrder<{ order?: { paymentStatus: string; status: string } }>(
      target,
      `/api/orders/${encodeURIComponent(target.code)}`,
    );
    if (!data.order) return null;
    return { status: data.order.paymentStatus, orderStatus: data.order.status };
  } catch {
    return null;
  }
}

/**
 * Terminal status classification, matching the vocabulary the payment store
 * actually writes (see db/payments.ts): UNPAID / PAYMENT_PENDING / PAID /
 * FAILED / PAYMENT_CANCELLED / REFUND_PENDING / REFUNDED / PARTIALLY_REFUNDED.
 *
 * A refund is deliberately NOT success: money was captured and handed back, so
 * the order was paid and is no longer paid. Folding REFUNDED into the paid set
 * would tell a customer their payment succeeded when it was reversed, so it gets
 * its own phase.
 */
const CAPTURED_STATES = new Set(["PAID", "CAPTURED"]);
const REFUNDED_STATES = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);
const FAILED_STATES = new Set(["FAILED", "PAYMENT_CANCELLED", "CANCELLED", "EXPIRED"]);

type PaymentPhase =
  | { kind: "paid" }
  | { kind: "refunded" }
  | { kind: "failed"; error: string }
  | { kind: "pending" };

/** Map a persisted payment status onto the phase the UI may show for it. */
function classifyPaymentStatus(status: string): PaymentPhase {
  const s = status.toUpperCase();
  if (CAPTURED_STATES.has(s)) return { kind: "paid" };
  if (REFUNDED_STATES.has(s)) return { kind: "refunded" };
  if (FAILED_STATES.has(s)) {
    return { kind: "failed", error: "The payment did not go through. No money was captured." };
  }
  return { kind: "pending" };
}

function applyPaymentPhase(
  outcome: PaymentPhase,
  update: (patch: Partial<PaymentUiState>) => void,
  confirmAndPoll: () => void,
): void {
  switch (outcome.kind) {
    case "paid":
      update({ phase: "paid" });
      return;
    case "refunded":
      update({ phase: "refunded" });
      return;
    case "failed":
      update({ phase: "failed", error: outcome.error });
      return;
    case "pending":
      confirmAndPoll();
  }
}

/* --------------------------------- hook --------------------------------- */

interface PaymentUiState {
  /** Which order the phase/error belong to — a reset is keyed on this. */
  code: string | null;
  phase: PayPhase;
  error: string | null;
  busy: boolean;
}

const FRESH: PaymentUiState = { code: null, phase: "starting", error: null, busy: false };

export function useOrderPayment(target: PaymentTarget | null) {
  const [ui, setUi] = useState<PaymentUiState>(FRESH);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A different order means a different payment: reset while rendering rather
  // than in an effect, so the first frame is already correct.
  const code = target?.code ?? null;
  if (ui.code !== code) setUi({ ...FRESH, code });

  const { phase, error, busy } = ui;

  const update = useCallback((patch: Partial<PaymentUiState>) => {
    setUi((s) => (alive.current ? { ...s, ...patch } : s));
  }, []);

  const pollForCapture = useCallback(async () => {
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      if (!alive.current) return;
      await new Promise((r) => window.setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return;
      const seen = await readPaymentStatus(target!);
      if (!seen) continue;
      const outcome = classifyPaymentStatus(seen.status);
      if (outcome.kind === "pending") continue;
      applyPaymentPhase(outcome, update, () => {});
      return;
    }
    // The capture webhook is still the authority; do not claim success.
    update({
      phase: "confirming",
      error: "Still confirming with your bank. Your order is saved — check the tracking page in a moment.",
    });
  }, [target, update]);

  const confirm = useCallback(
    async (body: Record<string, unknown>) => {
      update({ phase: "verifying", error: null });
      const data = await callOrder<{ ok?: boolean; error?: string; status?: string; pending?: boolean }>(
        target!,
        `/api/orders/${encodeURIComponent(target!.code)}/pay/verify`,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (data.pending) {
        await pollForCapture();
        return;
      }
      if (!data.ok) {
        update({ phase: "failed", error: statusMessage(data, "We could not confirm the payment") });
        return;
      }
      // The server answered ok without a pending flag: trust only the status it
      // reports, which is re-read from the provider, never the checkout claim.
      applyPaymentPhase(classifyPaymentStatus(data.status ?? ""), update, () => {
        void pollForCapture();
      });
    },
    [pollForCapture, target, update],
  );

  const begin = useCallback(async () => {
    if (!target || busy) return;
    update({ busy: true, error: null });

    try {
      if (target.mode === "unavailable") {
        throw new Error("Online payment is unavailable right now. Please use cash on delivery.");
      }

      if (target.mode === "dev") {
        await confirm({ dev: true });
        return;
      }

      let providerOrderId = target.providerOrderId;
      let keyId = target.keyId;

      if (!providerOrderId || !keyId) {
        // Allocation failed at order creation (or this is a retry): ask the
        // server for the session — it is idempotent per order.
        const started = await callOrder<StartResponse>(
          target,
          `/api/orders/${encodeURIComponent(target.code)}/pay/start`,
          { method: "POST" },
        );
        if (!started.ok || !started.providerOrderId) {
          throw new Error(statusMessage(started, "Could not start the payment"));
        }
        providerOrderId = started.providerOrderId ?? null;
        keyId = started.keyId ?? null;
      }

      update({ phase: "opening" });
      await loadCheckoutJs();
      if (!alive.current || !window.Razorpay || !providerOrderId || !keyId) return;

      const razorpay = new window.Razorpay({
        key: keyId,
        amount: target.amountCents,
        currency: target.currency,
        name: target.payeeName,
        description: `Order ${target.code}`,
        order_id: providerOrderId,
        prefill: {
          name: target.customerName || undefined,
          // Resuming a payment from a token-gated page has no phone (the public
          // order projection never carries one). Send nothing rather than a
          // fabricated "+91" the provider would treat as a real number.
          ...(target.phone ? { contact: `+91${target.phone}` } : {}),
        },
        notes: { order: target.code, reference: target.reference },
        retry: { enabled: false },
        theme: { color: "#f97316" },
        modal: {
          escape: true,
          ondismiss: () => update({ phase: "cancelled" }),
        },
        handler: (response: CheckoutResponse) => {
          void confirm({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
          });
        },
      });

      razorpay.on("payment.failed", (payload) => {
        const message =
          payload?.error?.description ??
          payload?.error?.reason ??
          payload?.description ??
          "The payment was declined. No money was captured.";
        update({ phase: "failed", error: message });
      });

      razorpay.open();
    } catch (e) {
      if (!alive.current) return;
      update({
        phase: "failed",
        error: e instanceof Error ? e.message : "Something went wrong starting the payment",
      });
    } finally {
      if (alive.current) update({ busy: false });
    }
  }, [busy, confirm, target, update]);

  const reopen = useCallback(() => {
    update({ error: null, phase: "starting" });
  }, [update]);

  return { phase, error, busy, begin, reopen };
}
