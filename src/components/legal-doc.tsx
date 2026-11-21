import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL, LEGAL_ROUTES, isPlaceholder, legalEntityLabel } from "@/lib/site-legal";

/**
 * Shared chrome for the four policy pages.
 *
 * These are server components on purpose: the policy text is static, and none of
 * this needs to reach the client bundle. Only the interactive footer/consent
 * surfaces are client code.
 *
 * `PROSE` styles the descendants of a `<LegalSection>` once, so page bodies are
 * plain semantic HTML (`<p>`, `<ul>`, `<strong>`) rather than a wall of utility
 * classes repeated on every paragraph.
 */
const PROSE = [
  "[&_p]:mt-3",
  "[&_p]:text-sm",
  "[&_p]:leading-relaxed",
  "[&_p]:text-cream-300",
  "[&_ul]:mt-3",
  "[&_ul]:list-disc",
  "[&_ul]:space-y-1.5",
  "[&_ul]:pl-5",
  "[&_ol]:mt-3",
  "[&_ol]:list-decimal",
  "[&_ol]:space-y-1.5",
  "[&_ol]:pl-5",
  "[&_li]:text-sm",
  "[&_li]:leading-relaxed",
  "[&_li]:text-cream-300",
  "[&_li::marker]:text-cream-600",
  "[&_strong]:font-semibold",
  "[&_strong]:text-cream-200",
  "[&_a]:font-medium",
  "[&_a]:text-ember-400",
  "[&_a]:underline",
  "[&_a]:underline-offset-2",
  "[&_a:hover]:text-ember-300",
].join(" ");

export function LegalHeader({
  title,
  summary,
  updated,
}: {
  title: string;
  summary: string;
  updated?: boolean;
}) {
  return (
    <header className="border-b border-white/8 pb-7">
      <h1 className="font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">{summary}</p>
      <p className="mt-4 text-xs text-cream-600">
        Effective {formatEffectiveDate()}
        {updated ? " · Last updated" : ""} ·{" "}
        <Link href={LEGAL_ROUTES.contact} className="font-medium text-ember-400 hover:text-ember-300">
          Contact us
        </Link>
      </p>
    </header>
  );
}

export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 pt-8">
      <h2 className="font-display text-lg font-bold text-cream-50">{heading}</h2>
      <div className={PROSE}>{children}</div>
    </section>
  );
}

/**
 * The registered-entity block. Rendered on /contact and repeated at the foot of
 * every policy, because the DPDP notice and the Razorpay verification both want
 * the operator identified next to the terms being accepted.
 */
export function LegalEntityBlock() {
  return (
    <section className="mt-10 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <h2 className="font-display text-sm font-bold text-cream-50">Operated by</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <EntityRow label="Legal entity">{legalEntityLabel()}</EntityRow>
        <EntityRow label="Registered address">{LEGAL.registeredAddress}</EntityRow>
        {LEGAL.gstin ? <EntityRow label="GSTIN">{LEGAL.gstin}</EntityRow> : null}
        {LEGAL.fssaiLicense ? (
          <EntityRow label="FSSAI licence">{LEGAL.fssaiLicense}</EntityRow>
        ) : null}
        <EntityRow label="Support">
          <a href={`mailto:${LEGAL.supportEmail}`} className="text-ember-400 hover:text-ember-300">
            {LEGAL.supportEmail}
          </a>
          {" · "}
          {LEGAL.supportPhone}
          {!isPlaceholder(LEGAL.supportHours) ? ` · ${LEGAL.supportHours}` : null}
        </EntityRow>
      </dl>
    </section>
  );
}

/** Cross-links to the other three policies, shown at the foot of each page. */
export function LegalNav() {
  return (
    <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/8 pt-6 text-sm">
      <Link href={LEGAL_ROUTES.terms} className="font-medium text-cream-300 hover:text-cream-50">
        Terms &amp; Conditions
      </Link>
      <Link href={LEGAL_ROUTES.privacy} className="font-medium text-cream-300 hover:text-cream-50">
        Privacy Policy
      </Link>
      <Link href={LEGAL_ROUTES.refunds} className="font-medium text-cream-300 hover:text-cream-50">
        Cancellation &amp; Refund Policy
      </Link>
      <Link href={LEGAL_ROUTES.contact} className="font-medium text-cream-300 hover:text-cream-50">
        Contact
      </Link>
    </nav>
  );
}

/** Outer page container. Bottom padding clears the sticky bottom nav. */
export function LegalPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-8 md:px-6 md:pb-16 md:pt-12">
      {children}
    </div>
  );
}

function EntityRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs text-cream-600 sm:w-40 sm:pt-0.5">{label}</dt>
      <dd className="text-cream-200">{children}</dd>
    </div>
  );
}

function formatEffectiveDate(): string {
  const parsed = new Date(LEGAL.effectiveDate);
  if (Number.isNaN(parsed.getTime())) return LEGAL.effectiveDate;
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}