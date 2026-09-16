import type { ReactNode } from "react";

/**
 * Cinematic route transition. The template remounts on every navigation, so
 * each screen unrolls from a clipped, scaled inset into full bleed while a
 * hairline of light sweeps down the viewport. Pointer events are never blocked.
 */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <>
      {/* light sweep */}
      <div
        aria-hidden
        className="animate-sweep-line pointer-events-none fixed inset-x-0 top-0 z-[65] h-[2px] bg-gradient-to-r from-transparent via-ember-400 to-transparent shadow-[0_0_18px_3px_rgba(255,178,94,0.55)]"
      />
      <div className="animate-page-cinema">{children}</div>
    </>
  );
}
