import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="grid size-16 place-items-center rounded-3xl bg-gradient-to-b from-ember-400/20 to-chili-600/10 text-ember-400">
        <Compass className="size-8" />
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-cream-50">
        This kitchen doesn&apos;t exist
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-cream-500">
        The page you&apos;re after may have been eaten. Let&apos;s get you back to something delicious.
      </p>
      <Link
        href="/"
        className="press mt-6 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
      >
        Back to discovery
      </Link>
    </div>
  );
}
