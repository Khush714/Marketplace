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
  title: "Privacy Policy",
  description:
    "How crave. collects, uses, shares and protects your personal data, and how to exercise your rights under Indian data protection law.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Privacy Policy"
        summary={`${LEGAL.brand} is a food marketplace that connects you with restaurants and delivers your order. Delivering an order requires us to know who you are and where to bring it. This notice explains exactly what we collect, why, who else sees it, how long we keep it, and the rights you have over it.`}
      />

      <LegalSection id="scope" heading="1. Who this applies to">
        <p>
          This notice applies to everyone who uses {LEGAL.brand} — our website and mobile
          web app, whether you are browsing, ordering, or tracking an order. It also covers
          restaurant partners who onboard through our partner area, since we hold business
          contact and login data for them too.
        </p>
        <p>
          We are the <strong>Data Fiduciary</strong> for your personal data: we decide why it is
          processed and how. Our payment gateway and hosting provider act as Data Processors
          on our instructions, not as independent controllers of your order data.
        </p>
        <p>
          This notice should be read together with our{" "}
          <Link href={LEGAL_ROUTES.terms}>Terms &amp; Conditions</Link> and our{" "}
          <Link href={LEGAL_ROUTES.refunds}>Cancellation &amp; Refund Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="what-we-collect" heading="2. What we collect">
        <p>
          We collect only what is needed to show you restaurants, take your order, deliver it,
          and pay the restaurant. Concretely, that means:
        </p>
        <ul>
          <li>
            <strong>Your name and mobile number.</strong> Entered by you at checkout and used to
            confirm the order with the restaurant and the rider. Your number is stored so our
            support team can find your order when you call.
          </li>
          <li>
            <strong>Your delivery address</strong>, including the label you give it (such as
            &ldquo;Home&rdquo; or &ldquo;Work&rdquo;) and any landmark or pincode you type in.
          </li>
          <li>
            <strong>Your order</strong> — the dishes, quantities, modifier selections, and the
            resulting prices, plus any delivery instructions you write (for example
            &ldquo;extra spicy&rdquo;). We keep this as a record of what was sold and served.
          </li>
          <li>
            <strong>Payment status and amounts.</strong> Whether you paid online or chose cash
            on delivery, and the amounts charged, discounted, and refunded.
          </li>
          <li>
            <strong>Your approximate locality.</strong> If you allow your browser to share your
            location, we use it <em>in your browser only</em> to work out which of the areas we
            serve you are in, and we send only that area name to our server. Your precise
            coordinates are never transmitted to or stored by us.
          </li>
          <li>
            <strong>Your IP address</strong>, recorded on order, sign-up and integration
            requests for fraud prevention and rate limiting.
          </li>
        </ul>
        <p>
          <strong>What we never collect:</strong> card numbers, CVVs, UPI PINs, netbanking
          credentials or any other payment instrument credential. Those are entered inside the
          payment provider&rsquo;s own secure checkout frame and never reach our servers. We
          also do not ask for, and do not store, your Aadhaar, PAN or passport.
        </p>
      </LegalSection>

      <LegalSection id="payments" heading="3. Payments and what the provider sees">
        <p>
          Online payments are processed by Razorpay, an RBI-authorised payment aggregator. When
          you choose to pay online we pass your name, email, phone number and order amount to
          Razorpay, and Razorpay returns an order identifier, a payment status, and — if
          something fails — a failure code. Razorpay acts on our instructions and its own{" "}
          <a href="https://razorpay.com/privacy-policy/" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>{" "}
          governs what it does with your data.
        </p>
        <p>
          Where you have already authorised Razorpay (for example via a saved method or a
          mandate), Razorpay may confirm that identity itself. We receive only the result, not
          the instrument.
        </p>
        <p>
          Cash on delivery is handled outside our systems entirely — the rider collects the
          amount from you.
        </p>
      </LegalSection>

      <LegalSection id="restaurants-and-riders" heading="4. Who else receives your data">
        <p>An order cannot be fulfilled without sharing limited details with others:</p>
        <ul>
          <li>
            <strong>The restaurant</strong> you ordered from receives your name, phone number,
            delivery address, order contents and delivery instructions — the minimum needed to
            prepare and hand over your food. It receives your order only after an online
            payment is confirmed.
          </li>
          <li>
            <strong>The delivery rider</strong> receives your address and phone number (and the
            restaurant&rsquo;s address) for the duration of the delivery so they can reach you.
          </li>
          <li>
            <strong>The restaurant&rsquo;s own point-of-sale system</strong>, which the
            restaurant&rsquo;s software provider operates. Restaurant menus and order status
            flow between their system and ours.
          </li>
          <li>
            <strong>Our hosting provider,</strong>{" "}
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
              Vercel
            </a>
            , which stores and serves the site and the database.
          </li>
          <li>
            <strong>Google Fonts</strong>, which serves the typeface files your browser
            downloads when the site loads.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal data, and we do not share it for
          advertising. We disclose it outside this list only where Indian law compels us — for
          example to a court, a police request, or a statutory authority — or to establish or
          defend a legal claim.
        </p>
      </LegalSection>

      <LegalSection id="tracking" heading="5. Cookies, analytics and advertising">
        <p>
          <strong>{LEGAL.brand} sets no tracking cookies.</strong> We set no advertising cookies,
          cross-site trackers, or third-party analytics scripts, so there is no cross-site profile
          of you to opt out of.
        </p>
        <p>
          The only cookie we ever set is a strictly necessary sign-in session for restaurant
          partners on the console. It is <code>HttpOnly</code> and expires within 30 days; it holds
          nothing that could follow you around the web, and browsing this site as a customer sets
          nothing at all.
        </p>
        <p>
          We do keep a small amount of information in your browser&rsquo;s local storage. It stays
          on your device and reaches us only when you act on it:
        </p>
        <ul>
          <li>your saved name, phone number and addresses, so checkout is faster next time;</li>
          <li>your order history codes, so you can reopen past orders;</li>
          <li>your cart contents and favourite restaurants;</li>
          <li>your most recent search terms and selected area;</li>
          <li>
            for restaurant partners, the owner key that authorises menu and integration changes.
          </li>
        </ul>
        <p>
          On your first visit we ask whether to keep the optional parts of that list &mdash; your
          favourite restaurants and recent search terms. Everything else above is what the site
          needs in order to function, so it is kept either way. Choosing the essential option also
          deletes any favourites and search terms already stored. You can change your answer at any
          time from <strong>Storage preferences</strong> in the footer of every page; the record of
          your choice is held in your own browser and is not sent to us.
        </p>
        <p>
          Clearing your browser&rsquo;s site data removes all of it, along with the recorded choice.
          Partner keys are additionally held for the current browser tab only, so closing the tab
          ends that session.
        </p>
      </LegalSection>

      <LegalSection id="security" heading="6. How we protect your data">
        <ul>
          <li>
            All traffic is encrypted in transit over HTTPS.
          </li>
          <li>
            Access to an order requires a signed, per-order token that is verified with a
            constant-time comparison. Someone who knows only your order code cannot read or
            cancel your order.
          </li>
          <li>
            Integration credentials held at rest are encrypted with AES-256-GCM. Owner keys and
            passkeys are stored only as salted hashes, so a database copy cannot be replayed.
          </li>
          <li>
            Administrative and internal endpoints are protected by secret tokens that fail
            closed in production, and public write endpoints are rate limited per IP address.
          </li>
          <li>
            Secrets are held in server-side environment configuration and are never shipped to
            your browser. The only payment value that reaches the client is the provider&rsquo;s
            public key identifier.
          </li>
          <li>
            Partner console access is restricted to authorised operators and logged to an
            append-only audit trail recording who did what, with timestamps and IP addresses.
          </li>
        </ul>
        <p>
          No system is perfectly secure. If a breach affecting your data occurs, we will notify
          you and the Data Protection Board as required by law and take steps to contain it.
        </p>
      </LegalSection>

      <LegalSection id="retention" heading="7. How long we keep your data">
        <p>
          We keep personal data only as long as the purpose it was collected for continues, and
          then delete or de-identify it.
        </p>
        <ul>
          <li>
            <strong>Order records</strong> (name, phone, address, instructions, items) are
            retained for the period required to fulfil the order, resolve any dispute or
            refund, and meet applicable tax and accounting record-keeping requirements. They
            are not retained indefinitely for convenience.
          </li>
          <li>
            <strong>Payment records</strong> are retained for as long as applicable law
            requires, including transaction and refund history.
          </li>
          <li>
            <strong>Security and integration audit logs</strong> (IP address, actor, event) are
            retained for at least one year, consistent with the minimum period the Digital
            Personal Data Protection Act, 2023 expects.
          </li>
          <li>
            <strong>Information stored in your own browser</strong> (saved addresses, order
            history, cart) stays until you clear it, and is never readable by us.
          </li>
        </ul>
        <p>
          Where we must retain something longer than its purpose — because tax or accounting
          law requires it — we restrict it to that purpose only.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" heading="8. Your rights">
        <p>
          Under the Information Technology Act, 2000 and the Digital Personal Data Protection
          Act, 2023, you may:
        </p>
        <ul>
          <li>
            <strong>Access</strong> — ask what personal data we hold about you and how we use
            it.
          </li>
          <li>
            <strong>Correct or complete</strong> — ask us to fix inaccurate information. You can
            edit your saved name, phone and addresses yourself from the Profile page.
          </li>
          <li>
            <strong>Erase</strong> — ask us to delete your personal data where we no longer
            have a lawful reason to keep it.
          </li>
          <li>
            <strong>Withdraw consent</strong> &mdash; where we rely on your consent, ask us to
            stop. The storage choices described in section 5 you can withdraw yourself, instantly,
            from <strong>Storage preferences</strong> in the footer. Withdrawing consent will not
            affect processing already carried out lawfully. Some data we must keep for legal reasons
            regardless.
          </li>
          <li>
            <strong>Raise a grievance</strong> — ask us to investigate. We aim to respond
            within the period prescribed by law, currently 30 days, and in practice much
            sooner.
          </li>
          <li>
            <strong>Nominate</strong> someone to exercise these rights on your behalf after
            your death.
          </li>
        </ul>
        <p>
          To exercise any of these, email{" "}
          <a href={`mailto:${LEGAL.grievanceEmail}`}>{LEGAL.grievanceEmail}</a> with the subject
          line &ldquo;Data request&rdquo;. Please include your order code(s) so we can locate your
          records. We may ask you to verify your identity first. You can find our full contact
          details on the <Link href={LEGAL_ROUTES.contact}>Contact</Link> page.
        </p>
        <p>
          If you are not satisfied with our response, you are entitled to complain to the Data
          Protection Board of India.
        </p>
      </LegalSection>

      <LegalSection id="children" heading="9. Children">
        <p>
          {LEGAL.brand} is not directed at children and is not intended for anyone under 18. We
          do not knowingly collect personal data from children. If you believe a child has
          given us personal data, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection id="transfers" heading="10. Processing outside India">
        <p>
          Some of our processors operate outside India. Vercel stores and serves the site and
          the database from infrastructure located outside India, and Razorpay and Google Fonts
          are also established outside India. Your data may therefore be processed outside
          India, under the terms set out in this notice and their linked privacy policies. If
          the Government of India notifies restrictions on transferring personal data outside
          India, we will comply with them.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="11. Changes to this notice">
        <p>
          We update this notice when our practices change. The effective date at the top always
          reflects the current version. Where a change materially affects how we use your
          data, we will give you notice and ask for fresh consent where the law requires it.
        </p>
      </LegalSection>

      <LegalEntityBlock />
      <LegalNav />
    </LegalPage>
  );
}