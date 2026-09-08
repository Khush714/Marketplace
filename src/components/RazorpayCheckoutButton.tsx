"use client";

import { useState, useCallback, useRef } from "react";
import { currency } from "@/lib/format";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

type RazorpayCheckout = {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
};

type PayItem = {
  menuItemId: number;
  quantity: number;
  modifierIds?: number[];
};

type RazorpayCheckoutButtonProps = {
  restaurant: string; // id or slug
  amountInr: number;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  fulfillmentType: "delivery" | "pickup";
  notes?: string;
  discountCode?: string;
  items: PayItem[];
  onSuccess: (result: { reference: string; total: number }) => void;
  label?: string;
};

/**
 * PHASE 24 — Razorpay hosted checkout.
 *
 * Flow: create a Razorpay order server-side (amount server-priced), open the
 * official checkout modal with the returned order id, and only after the modal
 * returns a successful (signature-verified) payment do we hand the reference
 * back to the parent — which then shows the order confirmation. The order row
 * is created server-side in POST /api/payments/verify.
 */
export function RazorpayCheckoutButton({
  restaurant,
  amountInr,
  customerName,
  customerPhone,
  customerAddress = "",
  fulfillmentType,
  notes,
  discountCode,
  items,
  onSuccess,
  label = "Pay online",
}: RazorpayCheckoutButtonProps) {
  const [processing, setProcessing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const loadPromise = useRef<Promise<void> | null>(null);

  const loadCheckoutScript = useCallback((): Promise<void> => {
    if (!loadPromise.current) {
      loadPromise.current = new Promise((resolve, reject) => {
        if (typeof window !== "undefined" && window.Razorpay) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          loadPromise.current = null;
          reject(
            new Error(
              "Could not load the payment gateway. Check your connection.",
            ),
          );
        };
        document.body.appendChild(script);
      });
    }
    return loadPromise.current;
  }, []);

  const startCheckout = useCallback(async () => {
    if (processing || verifying) return;
    setProcessing(true);
    setErrorText(null);

    try {
      // 1. Server creates a Razorpay order & records the intent.
      const res = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant,
          customerName,
          customerPhone,
          customerAddress,
          fulfillmentType,
          notes,
          discountCode,
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorText(data.error ?? "Could not start payment");
        setProcessing(false);
        return;
      }

      await loadCheckoutScript();

      setProcessing(false);

      // 2. Open the official Razorpay modal.
      const checkout = new (window.Razorpay as new (
        o: Record<string, unknown>,
      ) => RazorpayCheckout)({
        key: data.keyId,
        amount: data.amountPaise,
        currency: data.currency ?? "INR",
        name: "TABLZ",
        description: "Food order",
        order_id: data.razorpayOrderId,
        handler: async (response: {
          razorpay_payment_id?: string;
          razorpay_order_id?: string;
          razorpay_signature?: string;
        }) => {
          // 3. Verify server-side — this also creates the order.
          setVerifying(true);
          try {
            const verifyRes = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reference: data.reference,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok || !verifyData.ok) {
              setErrorText(
                verifyData.error ??
                  "Payment verification failed. The funds were not charged.",
              );
              return;
            }
            onSuccess({
              reference: verifyData.reference ?? data.reference,
              total: Number(verifyData.total ?? data.amountInr),
            });
          } catch {
            setErrorText(
              "Payment succeeded but verification failed. Tap Pay again to recover, or contact support with your payment reference.",
            );
          } finally {
            setVerifying(false);
          }
        },
        prefill: {
          name: customerName,
          contact: customerPhone,
        },
        theme: { color: "#f97316" },
        modal: {
          ondismiss: () => {
            setProcessing(false);
          },
        },
        retry: { enabled: false },
      });

      checkout.on("payment.failed", (_response: unknown) => {
        setErrorText("Payment failed. Please try again or use cash on delivery.");
        setProcessing(false);
      });

      checkout.open();
    } catch (e) {
      setErrorText(
        e instanceof Error
          ? e.message
          : "Payment could not be started. Please try again.",
      );
      setProcessing(false);
    }
  }, [
    processing,
    verifying,
    restaurant,
    customerName,
    customerPhone,
    customerAddress,
    fulfillmentType,
    notes,
    discountCode,
    items,
    loadCheckoutScript,
    onSuccess,
  ]);

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={processing || verifying}
        className="w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
      >
        {verifying
          ? "Confirming payment..."
          : processing
            ? "Starting payment..."
            : `${label} · ${currency(amountInr)}`}
      </button>
      {errorText && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {errorText}
          <button
            type="button"
            onClick={() => setErrorText(null)}
            className="ml-2 font-bold underline"
          >
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}