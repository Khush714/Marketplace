import { motion } from "framer-motion";
import { ACCENTS, type Accent, type Channel, type Phase } from "../lib/checkout";

const UPI_STEPS = [
  { id: "initiated", label: "INITIATED" },
  { id: "verifying", label: "VERIFYING" },
  { id: "settled", label: "SETTLED" },
] as const;

const CARD_STEPS = [
  { id: "authorising", label: "AUTHORISING" },
  { id: "processing", label: "PROCESSING" },
  { id: "settled", label: "SETTLED" },
] as const;

const CASH_STEPS = [
  { id: "received", label: "RECEIVED" },
  { id: "verified", label: "VERIFIED" },
  { id: "recorded", label: "RECORDED" },
] as const;

function indexFor(phase: Phase) {
  switch (phase) {
    case "idle":
      return -1;
    case "initiated":
      return 0;
    case "verifying":
    case "pending":
      return 1;
    case "success":
      return 2;
    default:
      return 1;
  }
}

export default function StatusRail({
  phase,
  accent,
  channel = "upi",
}: {
  phase: Phase;
  accent: Accent;
  channel?: Channel;
}) {
  const steps = channel === "cash" ? CASH_STEPS : channel === "card" ? CARD_STEPS : UPI_STEPS;
  const active = indexFor(phase);
  const rgb = ACCENTS[accent].rgb;
  const failed = phase === "failed" || phase === "expired" || phase === "cancelled";

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = i < active || (i === active && phase === "success");
        const current = i === active && !done;
        return (
          <div key={step.id} className="flex flex-1 items-center gap-2">
            <div className="flex-1">
              <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  initial={false}
                  animate={{ width: done ? "100%" : current ? "60%" : "0%" }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    background: failed && current ? "rgba(224,106,106,0.8)" : `rgba(${rgb},0.9)`,
                    boxShadow: `0 0 12px rgba(${rgb},0.7)`,
                  }}
                />
                {current && (
                  <span
                    className="absolute inset-y-0 w-10 animate-pulse rounded-full blur-[4px]"
                    style={{ background: `rgba(${rgb},0.5)`, left: "45%" }}
                  />
                )}
              </div>
              <p
                className="mt-2 font-mono text-[9px] tracking-[0.22em] transition-colors duration-500"
                style={{
                  color: done || current ? `rgba(${rgb},0.9)` : "rgba(255,255,255,0.22)",
                }}
              >
                {step.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
