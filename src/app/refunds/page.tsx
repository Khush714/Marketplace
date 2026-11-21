import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalEntityBlock,
  LegalHeader,
  LegalNav,
  LegalPage,
  LegalSection,
} from "@/components/legal-doc";
import { LEGAL, LEGAL_ROUTES } from "@/lib/site-legal";

export const metadata: Metadata = {
  title: "Cancellation & Refund Policy",
  description:
    "How to cancel an order on crave., when a full refund applies, how long a refund takes, and how to request one.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Cancellation & Refund Policy"
        summary={`Food is made to order, so the point at which you cancel changes whether the cost can be recovered. This page states plainly what happens in each case, and how long a refund takes once it is raised.`}
      />

      <LegalSection id="summary" heading="1. The short version">
        <ul>
          <li>
            <strong>Cancel before the restaurant starts preparing</strong> — you are refunded in
            full.
          </li>
          <li>
            <strong>Cancel once the restaurant has started preparing</strong> — the restaurant
            may decline the cancellation, and any amount already charged may be treated as
            non-refundable for food already made.
          </li>
          <li>
            <strong>Restaurant declines or cannot deliver</strong> — you are refunded in full,
            automatically.
          </li>
          <li>
            <strong>Cash on delivery that was not collected</strong> — nothing was charged to
            your payment method, so there is nothing to refund.
          </li>
          <li>
            <strong>Wrong, missing or undelivered items</strong> — report it promptly and we
            will assess a refund or replacement with you.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="how-to-cancel" heading="2. How to cancel">
        <p>
          Open the order from your Orders page or the tracking link, and use the cancel
          option there. The request goes to the restaurant&rsquo;s own system, which makes the
          decision — the Platform does not cancel unilaterally, because only the kitchen knows
          whether your food is already in the pan.
        </p>
        <p>
          You will see the outcome on the tracking screen. A cancellation may be confirmed
          immediately or held pending the restaurant&rsquo;s response; if the restaurant&rsquo;s
          system cannot be reached, the cancellation will not complete and your order will carry
          on. Please do not assume a cancellation succeeded until it shows as cancelled.
        </p>
        <p>
          <strong>To cancel, you need your order&rsquo;s private link.</strong> Cancellation is
          authorised by a token issued for that order, not by the order code alone, so nobody
          else can cancel your delivery.
        </p>
      </LegalSection>

      <LegalSection id="cases" heading="3. Case by case">
        <p>
          <strong>Cancelled before preparation begins.</strong> Refunded in full, including the
          delivery fee. Refunds are initiated automatically as soon as the restaurant confirms
          the cancellation.
        </p>
        <p>
          <strong>Cancelled after preparation has begun.</strong> The restaurant may refuse. We
          pass the request on and show you their decision. If they cannot accept it, the order
          continues to delivery and is charged as normal.
        </p>
        <p>
          <strong>Restaurant rejects the order, or it cannot reach your area.</strong> Refunded
          in full, automatically, without you needing to ask.
        </p>
        <p>
          <strong>Restaurant cancels after accepting.</strong> Refunded in full. This is the
          restaurant&rsquo;s own decision through its system, and the refund follows without a
          request from you.
        </p>
        <p>
          <strong>Delivery fails — we cannot reach you, or the address is wrong or unreachable.</strong>{" "}
          A delivery charge may apply, and food already prepared is generally non-refundable,
          because it has been made and cannot be resold. Where the failure is ours — for example
          a rider assigned outside your area, or a system fault on our side — we will refund the
          delivery fee and, at our discretion, the food charge.
        </p>
        <p>
          <strong>Food arrives damaged, incorrect or incomplete.</strong> Tell us through{" "}
          <Link href={LEGAL_ROUTES.contact}>our contact page</Link> within 24 hours of delivery,
          quoting your order code and describing the problem. We will take the order back to the
          restaurant and, where the issue is established, arrange a replacement or a refund.
          <strong> We cannot accept claims made after 24 hours</strong>, because after that point
          neither we nor the restaurant can verify what was served.
        </p>
        <p>
          <strong>Duplicate orders.</strong> If a request was retried and you were charged
          twice, the duplicate is refunded in full. Our system carries a per-checkout
          idempotency key so a retried request does not create a second order, but if one
          escapes, contact us and it will be reversed.
        </p>
        <p>
          <strong>Payment failed but the order was placed.</strong> If a payment was attempted
          and failed, no money is taken and there is nothing to refund. If money was taken but
          not captured by the provider, the provider&rsquo;s auto-refund returns it to your
          account, normally within five working days.
        </p>
      </LegalSection>

      <LegalSection id="timing" heading="4. How long a refund takes">
        <p>
          A refund is always routed back to the same payment method you paid with — we cannot
          refund to a different account or method.
        </p>
        <ul>
          <li>
            <strong>Initiated:</strong> as soon as the cancellation is confirmed, with no
            waiting period and no cancellation fee. Where you are asking us to reverse a charge
            after the fact, we aim to initiate within one business day of approval.
          </li>
          <li>
            <strong>UPI refunds</strong> are usually received in the linked bank account within a
            few hours.
          </li>
          <li>
            <strong>Card, netbanking and wallet refunds</strong> take <strong>5–7 working
            days</strong> to appear, because the change has to travel back through your issuing
            bank. Your bank controls this part, not us.
          </li>
          <li>
            Any <strong>delivery fee</strong> already applied is refunded on the same timeline
            as the order total.
          </li>
        </ul>
        <p>
          If a refund has not reached you within 10 working days, contact us with your order code
          and we will trace it with the provider.
        </p>
      </LegalSection>

      <LegalSection id="promotions" heading="5. Offers, discounts and free delivery">
        <p>
          A discount offered by a restaurant is applied at checkout against the food subtotal.
          Where an order is cancelled and refunded in full, the discount falls away with it. Where
          a partial refund is agreed, any discount already consumed is accounted for at that
          point, and this may mean the refunded amount is lower than the proportional share of
          what you paid.
        </p>
        <p>
          Free delivery above our published threshold is a promotional benefit. It is applied to
          an order as placed, and is not refunded as a separate item.
        </p>
      </LegalSection>

      <LegalSection id="claims" heading="6. Making a claim">
        <p>
          Contact us through{" "}
          <Link href={LEGAL_ROUTES.contact}>our contact page</Link> with your order code, the
          amount charged, and what has gone wrong. We aim to acknowledge within one business day
          and resolve within 7 working days.
        </p>
        <p>
          Where a claim concerns the food itself, we will ordinarily put you in touch with the
          restaurant concerned, since it is the seller and holds the facts. We will coordinate
          with it and handle the refund leg.
        </p>
        <p>
          These terms do not limit any right or remedy available to you under the Consumer
          Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020.
        </p>
      </LegalSection>

      <LegalEntityBlock />
      <LegalNav />
    </LegalPage>
  );
}