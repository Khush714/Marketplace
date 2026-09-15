import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Rider portal",
};

/**
 * Rider landing page. The rider opens a token-credential link (given to them
 * by a dispatcher, admin, or POS) and is taken straight to their job console.
 * The /rider/login page accepts a token manually and deep-links in.
 */
export default function RiderLandingPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="rounded-3xl border border-white/8 bg-ink-850 p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-cream">Rider portal</h1>
        <p className="mt-2 text-sm text-cream/60">
          Enter your delivery token to open today&apos;s job console.
        </p>
        <Link
          href="/rider/login"
          className="mt-6 inline-block rounded-full bg-emerald-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          Enter token
        </Link>
      </div>
    </main>
  );
}