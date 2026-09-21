import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS, type Accent } from "../lib/checkout";
import { AppMark, ArrowRight } from "./Glyphs";

const APPS = [
  { id: "gpay", label: "Google Pay", tint: "#8ab4f8" },
  { id: "phonepe", label: "PhonePe", tint: "#b9a3ff" },
  { id: "paytm", label: "Paytm", tint: "#7cc5ff" },
  { id: "other", label: "Other UPI", tint: "#ffd79a" },
];

const VPA_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;
const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  accent: Accent;
  disabled: boolean;
  vpa: string;
  onVpa: (v: string) => void;
  onApp: (label: string) => void;
  onVpaPay: () => void;
};

export default function MethodDeck({ accent, disabled, vpa, onVpa, onApp, onVpaPay }: Props) {
  const rgb = ACCENTS[accent].rgb;
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [verified, setVerified] = useState(false);

  const valid = VPA_RE.test(vpa.trim());
  const invalid = vpa.length > 3 && !valid;

  useEffect(() => {
    setVerified(false);
    if (!valid) return;
    const t = window.setTimeout(() => setVerified(true), 620);
    return () => window.clearTimeout(t);
  }, [vpa, valid]);

  const choose = (app: (typeof APPS)[number]) => {
    if (disabled) return;
    setSelected(app.id);
    window.setTimeout(() => onApp(app.label), 520);
  };

  return (
    <div className={disabled ? "pointer-events-none select-none opacity-45" : ""}>
      <p className="mb-3 text-[10px] tracking-[0.34em] text-white/35">PAY USING</p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
        {APPS.map((app) => {
          const active = selected === app.id;
          return (
            <motion.button
              key={app.id}
              type="button"
              onClick={() => choose(app)}
              whileTap={{ scale: 0.97 }}
              animate={{ scale: active ? 1.035 : 1 }}
              transition={{ duration: 0.35, ease }}
              className="glass-soft group relative flex items-center gap-2.5 overflow-hidden rounded-full px-3.5 py-2.5 text-left transition-colors duration-500 hover:border-white/20"
              style={{
                borderColor: active ? `rgba(${rgb},0.55)` : undefined,
                boxShadow: active
                  ? `0 0 0 1px rgba(${rgb},0.35), 0 12px 30px -14px rgba(${rgb},0.8)`
                  : undefined,
              }}
            >
              <span
                className="transition-all duration-500"
                style={{
                  color: active ? app.tint : "rgba(255,255,255,0.45)",
                  filter: active ? `drop-shadow(0 0 8px ${app.tint}aa)` : "none",
                }}
              >
                <AppMark id={app.id} className="h-[18px] w-[18px]" />
              </span>
              <span
                className={`text-[12px] tracking-[0.04em] transition-colors duration-500 ${
                  active ? "text-white" : "text-white/60 group-hover:text-white/85"
                }`}
              >
                {app.label}
              </span>
              <AnimatePresence>
                {active && (
                  <motion.span
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="ml-auto text-[10px] tracking-[0.18em]"
                    style={{ color: ACCENTS[accent].soft }}
                  >
                    ✓
                  </motion.span>
                )}
              </AnimatePresence>
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </motion.button>
          );
        })}
      </div>

      {/* divider */}
      <div className="my-5 flex items-center gap-4">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/12 to-white/12" />
        <span className="text-[10px] tracking-[0.34em] text-white/25">OR</span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent via-white/12 to-white/12" />
      </div>

      {/* UPI ID field */}
      <div className="relative">
        <label
          htmlFor="vpa"
          className={`pointer-events-none absolute left-4 z-10 origin-left font-mono tracking-[0.2em] transition-all duration-300 ${
            focused || vpa
              ? "top-1.5 text-[9px] text-white/45"
              : "top-1/2 -translate-y-1/2 text-[11px] text-white/35"
          }`}
        >
          UPI ID
        </label>
        <div
          className="glass-soft relative flex items-center overflow-hidden rounded-2xl transition-all duration-500"
          style={{
            borderColor: invalid
              ? "rgba(224,106,106,0.5)"
              : focused || verified
                ? `rgba(${rgb},0.45)`
                : undefined,
            boxShadow:
              focused && !invalid
                ? `0 0 0 1px rgba(${rgb},0.25), 0 0 34px -12px rgba(${rgb},0.9)`
                : undefined,
          }}
        >
          <input
            id="vpa"
            value={vpa}
            onChange={(e) => onVpa(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && verified) onVpaPay();
            }}
            placeholder={focused ? "name@bank" : ""}
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-transparent px-4 pb-2.5 pt-6 font-mono text-[13px] tracking-[0.06em] text-white outline-none placeholder:text-white/20"
          />

          <div className="flex items-center gap-1.5 pr-2">
            <AnimatePresence>
              {verified && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.35, ease }}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-400/15 text-emerald-200"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
                    <motion.path
                      d="M6 12.5 10.5 17 18 7.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.4, ease }}
                    />
                  </svg>
                </motion.span>
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={onVpaPay}
              disabled={!verified}
              aria-label="Pay with this UPI ID"
              className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-400 disabled:opacity-30"
              style={{
                borderColor: verified ? `rgba(${rgb},0.5)` : "rgba(255,255,255,0.08)",
                background: verified
                  ? `linear-gradient(145deg, rgba(${rgb},0.3), rgba(255,255,255,0.03))`
                  : "rgba(255,255,255,0.02)",
                color: verified ? "#fff" : "rgba(255,255,255,0.5)",
                boxShadow: verified ? `0 0 26px -8px rgba(${rgb},0.95)` : "none",
              }}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 h-4 pl-1">
          <AnimatePresence mode="wait">
            {invalid ? (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-[10.5px] tracking-[0.1em] text-[#e0a0a0]"
              >
                Enter a valid UPI ID, e.g. name@bank
              </motion.p>
            ) : verified ? (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-[10.5px] tracking-[0.1em] text-emerald-200/70"
              >
                Verified · account name matched
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
