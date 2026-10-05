import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata because the checkout page is a client component.
 * `NOINDEX` matters most here of anywhere: this is the step where an address and
 * a payment method are entered, and a crawler must never reach a live checkout.
 */
export const metadata: Metadata = {
  title: "Checkout",
  description: "Confirm your delivery address, review the bill and pay by UPI, card or cash.",
  ...NOINDEX,
};

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return children;
}