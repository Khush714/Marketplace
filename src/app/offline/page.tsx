import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4">
      <div className="text-center">
        <div className="text-5xl">📡</div>
        <h1 className="mt-4 text-xl font-bold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-slate-500">
          TABLZ needs a connection to load live menus and prices. Pages you
          already visited are still available.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
