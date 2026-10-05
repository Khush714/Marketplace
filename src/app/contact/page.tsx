import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import {
  LegalEntityBlock,
  LegalHeader,
  LegalNav,
  LegalPage,
  LegalSection,
} from "@/components/legal-doc";
import { LEGAL, isPlaceholder } from "@/lib/site-legal";

export const metadata: Metadata = {
  title: "Contact",
  description:
    `Contact ${LEGAL.brand} for order support, refunds, grievances and data requests. Registered entity, address, email and phone.`,
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Contact us"
        summary="Support, refunds, complaints and data requests all come to the same small team. Please include your order code — it is the fastest way for us to find your order."
      />

      <LegalSection id="reach" heading="How to reach us">
        <ul className="space-y-3">
          <ContactRow Icon={Mail} label="Email">
            <a
              href={`mailto:${LEGAL.supportEmail}`}
              className="text-ember-400 hover:text-ember-300"
            >
              {LEGAL.supportEmail}
            </a>
            <p className="mt-1 text-xs text-cream-500">
              General support, order issues and refunds. We aim to reply within one business
              day.
            </p>
          </ContactRow>
          <ContactRow Icon={Phone} label="Phone">
            <span className="text-cream-200">{LEGAL.supportPhone}</span>
            <p className="mt-1 text-xs text-cream-500">
              {LEGAL.supportHours}. Callers outside these hours can leave a message and we will
              call back.
            </p>
          </ContactRow>
          <ContactRow Icon={ShieldAlert} label="Data protection grievances">
            <a
              href={`mailto:${LEGAL.grievanceEmail}`}
              className="text-ember-400 hover:text-ember-300"
            >
              {LEGAL.grievanceEmail}
            </a>
            <p className="mt-1 text-xs text-cream-500">
              Access, correction, erasure and consent-withdrawal requests under the Digital
              Personal Data Protection Act, 2023.
              {!isPlaceholder(LEGAL.grievanceOfficer) && ` Handled by ${LEGAL.grievanceOfficer}.`}
            </p>
          </ContactRow>
          <ContactRow Icon={MapPin} label="Registered address">
            <span className="text-cream-200">{LEGAL.registeredAddress}</span>
          </ContactRow>
        </ul>
      </LegalSection>

      <LegalSection id="partners" heading="Restaurant partners">
        <p>
          If you run a restaurant and want to list it on {LEGAL.brand}, start on the{" "}
          <a href="/partner" className="text-ember-400 hover:text-ember-300">
            partner page
          </a>
          . For integration or listing issues with an existing listing, email{" "}
          <a href={`mailto:${LEGAL.supportEmail}`} className="text-ember-400 hover:text-ember-300">
            {LEGAL.supportEmail}
          </a>{" "}
          with the restaurant name and your identifier.
        </p>
      </LegalSection>

      <LegalSection id="what-to-include" heading="What to include in your message">
        <p>It almost always lets us resolve things in one go to include:</p>
        <ul>
          <li>
            your <strong>order code</strong>, in the form{" "}
            <span className="font-mono text-cream-200">CRV-XXXXX</span> — it is the first
            thing we need, and it is the only way we can find your order, since we do not hold
            customer accounts;
          </li>
          <li>the order date and the restaurant you ordered from;</li>
          <li>the amount charged, and when;</li>
          <li>what has gone wrong, and what outcome you are looking for; and</li>
          <li>
            for a data request, confirmation of the phone number on the order so we can verify
            it is really yours.
          </li>
        </ul>
      </LegalSection>

      <LegalEntityBlock />
      <LegalNav />
    </LegalPage>
  );
}

function ContactRow({
  Icon,
  label,
  children,
}: {
  Icon: typeof Mail;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-ember-400/10 text-ember-400">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-cream-50">{label}</span>
        <span className="mt-0.5 block text-sm break-words">{children}</span>
      </span>
    </li>
  );
}