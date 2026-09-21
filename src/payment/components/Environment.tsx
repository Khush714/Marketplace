import { ACCENTS, type Accent } from "../lib/checkout";

/**
 * Cinematic room the checkout lives in: near-black base, slow graphite haze,
 * two drifting light streaks tinted by the current transaction accent.
 */
export default function Environment({ accent }: { accent: Accent }) {
  const rgb = ACCENTS[accent].rgb;

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {/* base */}
      <div className="absolute inset-0 bg-[#040404]" />
      <div
        className="absolute inset-0 transition-[background] duration-[1600ms] ease-out"
        style={{
          background: `radial-gradient(120% 85% at 50% -10%, rgba(${rgb},0.16) 0%, rgba(${rgb},0.05) 28%, rgba(4,4,4,0) 62%)`,
        }}
      />

      {/* drifting light streaks */}
      <div
        className="anim-drift-a absolute -left-[18%] top-[6%] h-[46rem] w-[46rem] rounded-full blur-[120px] transition-[background] duration-[1600ms]"
        style={{
          background: `radial-gradient(circle at 40% 40%, rgba(${rgb},0.30), rgba(${rgb},0.06) 45%, transparent 70%)`,
        }}
      />
      <div
        className="anim-drift-b absolute -right-[14%] bottom-[-14%] h-[42rem] w-[42rem] rounded-full blur-[130px] transition-[background] duration-[1600ms]"
        style={{
          background: `radial-gradient(circle at 60% 60%, rgba(${rgb},0.22), rgba(255,255,255,0.03) 42%, transparent 72%)`,
        }}
      />
      <div className="anim-drift-b absolute left-[30%] top-[40%] h-[30rem] w-[60rem] -rotate-12 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(120,120,130,0.13),transparent_65%)] blur-[100px]" />

      {/* thin diagonal beams */}
      <div
        className="absolute -top-1/3 left-1/4 h-[160%] w-px opacity-40 blur-[1px]"
        style={{
          background: `linear-gradient(to bottom, transparent, rgba(${rgb},0.55), transparent)`,
          transform: "rotate(14deg)",
        }}
      />
      <div
        className="absolute -top-1/3 right-1/3 h-[160%] w-px opacity-25 blur-[1px]"
        style={{
          background: `linear-gradient(to bottom, transparent, rgba(255,255,255,0.5), transparent)`,
          transform: "rotate(-11deg)",
        }}
      />

      {/* precision grid */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(75% 60% at 50% 45%, #000 20%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(75% 60% at 50% 45%, #000 20%, transparent 78%)",
        }}
      />

      {/* floor reflection */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black via-black/70 to-transparent" />

      {/* grain + vignette */}
      <div className="noise absolute inset-0 opacity-[0.045] mix-blend-overlay" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_50%,transparent_45%,rgba(0,0,0,0.75)_100%)]" />
    </div>
  );
}
