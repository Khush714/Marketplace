/** Ambient background environment — a static base, a morphing aurora field,
 *  drifting accents and film grain.
 *
 *  Each decoration is its own layer with its own mode class, so the device can
 *  be given a different treatment per layer rather than one treatment for the
 *  whole environment. The blur, the blend modes and the animation shorthand all
 *  live in CSS (`globals.css`, "ambient modes") rather than here, because the
 *  modes are chosen by media query: that way the right treatment is applied at
 *  first paint instead of one frame later, and this file stays free of tier
 *  branching. Position, size and gradient stay inline as ordinary utilities. */
import { experiments } from "@/lib/experiments";

export function Ambient() {
  const staticOnly = experiments.ambientOff();

  return (
    <div aria-hidden className="grain pointer-events-none fixed inset-0 overflow-hidden">
      {/* base vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#12101a_0%,#07070a_55%,#050506_100%)]" />

      {/* morphing aurora field */}
      {!staticOnly && (
        <>
          <div className="ambient-aurora ambient-aurora--a absolute -top-56 left-[8%] h-[560px] w-[720px] bg-[radial-gradient(closest-side,rgba(255,110,60,0.20),transparent_72%)]" />
          <div className="ambient-aurora ambient-aurora--b absolute -left-52 top-[26%] h-[520px] w-[520px] bg-[radial-gradient(closest-side,rgba(255,90,60,0.13),transparent_72%)]" />
          <div className="ambient-aurora ambient-aurora--c absolute -right-56 top-[48%] h-[560px] w-[560px] bg-[radial-gradient(closest-side,rgba(150,110,255,0.12),transparent_72%)]" />
          <div className="ambient-aurora ambient-aurora--d absolute -bottom-64 left-[26%] h-[500px] w-[680px] bg-[radial-gradient(closest-side,rgba(255,158,67,0.11),transparent_72%)]" />

          {/* slow drifting accents */}
          <div className="ambient-drift ambient-drift--a absolute left-[14%] top-[10%] h-40 w-40 rounded-full bg-[radial-gradient(closest-side,rgba(255,178,94,0.12),transparent_70%)]" />
          <div className="ambient-drift ambient-drift--b absolute right-[18%] top-[34%] h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgba(196,161,255,0.10),transparent_70%)]" />
        </>
      )}
    </div>
  );
}
