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
import {
  DELIVERY_FEE_CENTS,
  DELIVERY_FREE_ABOVE_CENTS,
  PLATFORM_FEE_CENTS,
  formatINR,
} from "@/lib/domain";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms that govern your use of crave., placing orders, delivery, cancellation and refunds, and resolving disputes.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Terms & Conditions"
        summary={`These terms govern your use of ${LEGAL.brand} and every order placed through it. By browsing, ordering or partnering with us you accept them. They also tell you who actually cooks your food and who is responsible for it.`}
      />

      <LegalSection id="acceptance" heading="1. Acceptance of these terms">
        <p>
          These terms form a binding agreement between you and the operator of{" "}
          {LEGAL.brand}, identified in the &ldquo;Operated by&rdquo; panel below and on our{" "}
          <Link href={LEGAL_ROUTES.contact}>Contact</Link> page (in these terms,{" "}
          &ldquo;{LEGAL.brand}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). Our website and
          mobile web app are together the &ldquo;Platform&rdquo;. By using the Platform or
          placing an order you confirm you have read and accept these terms, our{" "}
          <Link href={LEGAL_ROUTES.privacy}>Privacy Policy</Link> and our{" "}
          <Link href={LEGAL_ROUTES.refunds}>Cancellation &amp; Refund Policy</Link>. If you do
          not accept them, please do not use the Platform.
        </p>
        <p>
          We may update these terms. Material changes will be notified on the Platform and, where
          required, we will ask for your fresh acceptance before they apply to a new order.
          Continuing to use the Platform after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection id="marketplace-role" heading="2. Our role — we are a marketplace, not the seller">
        <p>
          {LEGAL.brand} is an <strong>intermediary platform</strong>. Each restaurant listed on
          the Platform is an independent business that contracts with you directly for the food
          it prepares and sells. <strong>The restaurant is the seller of the food</strong> — we
          are not the seller, we are the platform that lets you find, order from and track it.
        </p>
        <p>This matters in three practical ways:</p>
        <ul>
          <li>
            <strong>Food quality and safety are the restaurant&rsquo;s responsibility.</strong> It
            prepares and hands over the food, and it is liable to you for anything wrong with it.
            Each restaurant must hold the food safety licence required to operate legally in
            India (an FSSAI licence, and any other licence its local authority requires), and
            must display it on its listing where we hold it.
          </li>
          <li>
            <strong>Your contract for the food is with the restaurant.</strong> A claim about the
            food, its ingredients or an allergy should be raised with the restaurant first. We
            will help you reach them and will assist with any refund we have agreed.
          </li>
          <li>
            <strong>We handle the platform and the payment leg.</strong> We process your
            payment through our payment provider, release the order to the restaurant, provide
            live tracking, and run the cancellation and refund process described below.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="eligibility" heading="3. Who may order">
        <p>
          You must be at least 18 years old, or placing the order with the involvement and
          consent of a parent or guardian. You must be able to form a binding contract, and you
          must use the Platform only for yourself or for someone who has asked you to order for
          them.
        </p>
        <p>
          <strong>No customer account is created.</strong> The Platform does not ask you to
          register or set a password. Your access to an order rests on a private per-order link
          generated for you at checkout, stored only in your own browser. Keep it to yourself —
          anyone holding that link can view and cancel that order. See also our{" "}
          <Link href={LEGAL_ROUTES.privacy}>Privacy Policy</Link> on what that means for your
          data.
        </p>
      </LegalSection>

      <LegalSection id="orders" heading="4. Placing an order">
        <p>
          An order is a request to buy. It becomes a contract with the restaurant when that
          restaurant accepts it, which you will see reflected in the live status on your tracking
          screen. A restaurant may decline an order — for example if an item is out of stock or
          it cannot serve your area — and if it does, any payment taken is refunded in full under
          our <Link href={LEGAL_ROUTES.refunds}>Cancellation &amp; Refund Policy</Link>.
        </p>
        <p>You confirm at checkout that:</p>
        <ul>
          <li>the delivery address and phone number you gave are accurate and reachable;</li>
          <li>you are entitled to use the payment method you chose; and</li>
          <li>
            you have read and accepted these terms, as recorded by the consent tick on the
            checkout page.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="pricing" heading="5. Prices and fees">
        <p>
          Prices shown on a restaurant&rsquo;s listing are the restaurant&rsquo;s own prices. The
          total you pay is made up of the food subtotal, any discount the restaurant offers, plus
          the platform fee and the delivery fee. At the date of these terms the delivery fee is{" "}
          {formatINR(DELIVERY_FEE_CENTS)}, waived on orders of{" "}
          {formatINR(DELIVERY_FREE_ABOVE_CENTS)} and above, and the platform fee is{" "}
          {formatINR(PLATFORM_FEE_CENTS)} per order.
        </p>
        <p>
          <strong>The bill shown at checkout is the authoritative one.</strong> We recompute the
          total on our server when the order is placed, so a stale or tampered-with browser total
          cannot change what you are charged. Applicable taxes and charges are included in the
          price shown. Fees may change; the figure displayed at checkout always governs your order.
        </p>
      </LegalSection>

      <LegalSection id="delivery" heading="6. Delivery">
        <p>
          Delivery estimates shown on the Platform are estimates, not guarantees. Factors outside
          our and the rider&rsquo;s control — traffic, weather, roadworks, distance, restaurant
          queues — affect arrival time.
        </p>
        <ul>
          <li>
            Delivery is available only to addresses inside the areas a restaurant serves. We
            serve{" "}
            <strong>Old City, Zadeshwar and Maktampur</strong> in Bharuch, and generally within
            a 25 km radius of those areas. An address outside a restaurant&rsquo;s serviceable
            area may be declined, in which case you are refunded in full.
          </li>
          <li>
            <strong>Please be accurate.</strong> A wrong or incomplete address, an unreachable
            phone, or a failed delivery attempt caused by these will not normally be refundable.
          </li>
          <li>
            If the rider cannot reach you, they will attempt contact and return to the restaurant.
            Re-delivery depends on availability and may carry a further charge agreed with you at
            the time.
          </li>
          <li>
            Please check your order at handover. Report a missing or incorrect item promptly via{" "}
            <Link href={LEGAL_ROUTES.contact}>our contact page</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="allergens" heading="7. Allergies and food safety information">
        <p>
          <strong>Tell the restaurant, in the delivery instructions, about any allergy or
          intolerance before ordering.</strong> Menu information and ingredient details are
          supplied by the restaurant and may be incomplete or out of date. The restaurant
          prepares your food in a kitchen that handles other ingredients, so cross-contact is
          possible even when a request is followed.
        </p>
        <p>
          It is the restaurant&rsquo;s responsibility to inform you accurately about allergens in
          what it sells. We are not liable for any allergic reaction, illness or loss arising
          from food prepared or described by a restaurant, save to the extent our law does not
          permit us to exclude it.
        </p>
      </LegalSection>

      <LegalSection id="conduct" heading="8. Acceptable use">
        <p>You must not, and must not permit anyone to:</p>
        <ul>
          <li>
            use the Platform to order anything unlawful, or to harass, abuse or defraud a
            restaurant, rider or another customer;
          </li>
          <li>
            probe, scan, test or attempt to gain unauthorised access to the Platform, its
            servers, its APIs or another user&rsquo;s order;
          </li>
          <li>
            scrape, bulk-harvest, crawl or extract listings, menus or content by automated means,
            or resell access to the Platform;
          </li>
          <li>
            interfere with, disable, circumvent or overload the Platform, including by automated
            requests — our endpoints are rate limited, and abuse may be refused or blocked; or
          </li>
          <li>
            submit false reviews, fake orders, misleading listing information, or content that
            is unlawful, infringing or defamatory.
          </li>
        </ul>
        <p>
          We may refuse service, cancel orders and restrict access where we reasonably believe
          these terms or the law have been breached. Where we cancel for this reason, we will
          refund any amount already taken.
        </p>
      </LegalSection>

      <LegalSection id="ip" heading="9. Intellectual property">
        <p>
          The Platform&rsquo;s software, design, text, graphics, logos and the &ldquo;
          {LEGAL.brand}&rdquo; name and marks belong to us or our licensors. Restaurants own their
          own names, logos, photographs and menu content; by listing with us they grant us a
          limited licence to display that content for the purpose of operating the Platform.
        </p>
        <p>
          You may not copy, reproduce or republish Platform content commercially without our
          written permission.
        </p>
      </LegalSection>

      <LegalSection id="liability" heading="10. Disclaimers and liability">
        <p>
          The Platform is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
          basis. To the extent the law allows, we exclude implied warranties of merchantability,
          fitness for a particular purpose and non-infringement. We do not warrant that the
          Platform will be uninterrupted or error free, or that restaurant information,
          photographs, prices or availability will always be accurate or current — restaurant
          content is supplied by restaurants.
        </p>
        <p>
          Nothing in these terms excludes or limits our liability for death or personal injury
          caused by our negligence, for fraud or fraudulent misrepresentation, or for anything
          else that cannot lawfully be excluded, including your statutory consumer rights.
        </p>
        <p>
          Subject to that, we are not liable for indirect or consequential loss, or for lost
          profits or business opportunity. Our total aggregate liability arising out of or in
          connection with an order is limited to the amount you actually paid for that order —
          that is, the order value plus the fees shown on your bill.
        </p>
      </LegalSection>

      <LegalSection id="partners" heading="11. Restaurant and partner terms">
        <p>
          Restaurants onboard through our partner area. By listing with us you warrant that you
          hold every licence and registration required to prepare and sell food in India,
          including a valid FSSAI licence for each kitchen, and that the menu, prices and
          information you publish are accurate and not misleading. You are responsible for the
          food you sell, for the allergen information you provide, and for your own tax
          position. Breach of these obligations may lead to delisting.
        </p>
        <p>
          Partner credentials are personal to you and to your business. You are responsible for
          everything done with them; tell us immediately if you believe a key has been
          compromised so we can revoke it.
        </p>
      </LegalSection>

      <LegalSection id="changes-termination" heading="12. Suspension and changes">
        <p>
          We may modify or discontinue any part of the Platform, or suspend your access, where we
          need to do so for legal or security reasons, to maintain the service, or where we have
          reasonable grounds to believe you have breached these terms. Where we suspend an
          account, any pending order is handled under the{" "}
          <Link href={LEGAL_ROUTES.refunds}>Cancellation &amp; Refund Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="law" heading="13. Governing law and disputes">
        <p>
          These terms and any dispute arising from them are governed by {LEGAL.governingLaw}. The
          courts at {LEGAL.jurisdiction} have exclusive jurisdiction. Before commencing
          proceedings, please raise the matter with us first — most disputes are resolved quickly
          and without cost through{" "}
          <Link href={LEGAL_ROUTES.contact}>our contact page</Link>. Consumers retain the benefit
          of any mandatory consumer forum or grievance mechanism available to them under
          Indian law.
        </p>
      </LegalSection>

      <LegalEntityBlock />
      <LegalNav />
    </LegalPage>
  );
}