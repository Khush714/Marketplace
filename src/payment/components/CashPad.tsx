import { AnimatePresence, motion } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  breakdown,
  type CashBalance,
  CASH_SHORTCUTS,
  formatINR,
  ORDER,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  accent: Accent;
  disabled: boolean;
  received: number;
  balance: CashBalance;
  onAdd: (value: number) => void;
  onExact: () => void;
  onClear: () => void;
  onSetAmount: (value: number) => void;
};

export default function CashPad({
  accent,
  disabled,
  received,
  balance,
  onAdd,
  onExact,
  onClear,
  onSetAmount,
}: Props) {
  const rgb = ACCENTS[accent].rgb;
  const changeParts = balance.kind === "over" ? breakdown(balance.change) : [];

  return (
    <div className={disabled ? "pointer-events-none select-none opacity-45" : ""}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.34em] text-white/35">DENOMINATIONS</p>
        <button
          type="button"
          onClick={onClear}
          disabled={received <= 0}
          className="text-[10px] tracking-[0.22em] text-white/30 transition-colors hover:text-white/70 disabled:opacity-30"
        >
          CLEAR
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
        {CASH_SHORTCUTS.map((value) => (
          <motion.button
            key={value}
            type="button"
            onClick={() => onAdd(value)}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.18, ease }}
            className="glass-soft group relative overflow-hidden rounded-2xl px-3 py-3 text-left transition-colors duration-400 hover:border-white/20"
          >
            <span className="block font-mono text-[13px] tracking-[0.04em] text-white/80 transition-colors group-hover:text-white">
              ₹{formatINR(value, false)}
            </span>
            <span
              className="mt-1 block text-[8px] tracking-[0.22em] text-white/25 transition-colors group-hover:text-white/45"
              style={{ color: undefined }}
            >
              NOTE
            </span>
            <span
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              style={{
                background: `radial-gradient(circle at 30% 20%, rgba(${rgb},0.18), transparent 60%)`,
              }}
            />
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </motion.button>
        ))}

        <motion.button
          type="button"
          onClick={onExact}
          whileTap={{ scale: 0.94 }}
          className="relative overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all duration-400"
          style={{
            borderColor: `rgba(${rgb},0.45)`,
            background: `linear-gradient(145deg, rgba(${rgb},0.22), rgba(255,255,255,0.03))`,
            boxShadow: `0 10px 28px -14px rgba(${rgb},0.85)`,
          }}
        >
          <span className="block text-[11px] font-medium tracking-[0.18em] text-white">EXACT</span>
          <span className="mt-1 block font-mono text-[10px]" style={{ color: ACCENTS[accent].soft }}>
            ₹{formatINR(ORDER.amount, false)}
          </span>
        </motion.button>
      </div>

      {/* manual entry */}
      <div className="mt-4">
        <p className="mb-2 text-[10px] tracking-[0.34em] text-white/35">OR ENTER AMOUNT</p>
        <ManualEntry accent={accent} value={received} onSet={onSetAmount} />
      </div>

      {/* change breakdown */}
      <AnimatePresence>
        {balance.kind === "over" && changeParts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 8, height: 0 }}
            transition={{ duration: 0.45, ease }}
            className="mt-5 overflow-hidden"
          >
            <p className="mb-2.5 text-[10px] tracking-[0.34em]" style={{ color: ACCENTS[accent].soft }}>
              CHANGE BREAKDOWN · RETURN TO CUSTOMER
            </p>
            <div className="flex flex-wrap gap-1.5">
              {changeParts.map((part) => (
                <span
                  key={part.value}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-[0.04em]"
                  style={{
                    borderColor: `rgba(${rgb},0.3)`,
                    background: `rgba(${rgb},0.08)`,
                    color: ACCENTS[accent].soft,
                  }}
                >
                  <span className="text-white/40">{part.count}×</span>
                  ₹{formatINR(part.value, false)}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {balance.kind === "under" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-5 rounded-2xl border border-[#e06a6a]/25 bg-[#e06a6a]/08 px-3.5 py-3"
          >
            <p className="text-[10px] tracking-[0.22em] text-[#f3b8b8]/80">
              ADDITIONAL ₹{formatINR(balance.remaining, false)} REQUIRED
            </p>
          </motion.div>
        )}

        {balance.kind === "exact" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-3.5 py-3"
          >
            <p className="text-[10px] tracking-[0.22em] text-emerald-100/85">
              ✓ EXACT CASH · NO CHANGE REQUIRED
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ManualEntry({
  accent,
  value,
  onSet,
}: {
  accent: Accent;
  value: number;
  onSet: (n: number) => void;
}) {
  const rgb = ACCENTS[accent].rgb;
  const display = value > 0 ? String(value) : "";

  return (
    <div
      className="glass-soft flex items-center overflow-hidden rounded-2xl transition-all duration-400"
      style={{
        borderColor: value > 0 ? `rgba(${rgb},0.3)` : undefined,
      }}
    >
      <span className="pl-4 font-mono text-[14px] text-white/40">₹</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={display}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, "");
          onSet(raw === "" ? 0 : Math.min(999999, parseInt(raw, 10)));
        }}
        placeholder="0"
        className="w-full bg-transparent px-2 py-3.5 font-mono text-[14px] tracking-[0.06em] text-white outline-none placeholder:text-white/20"
      />
      {value > 0 && (
        <button
          type="button"
          onClick={() => onSet(0)}
          className="pr-3 text-[10px] tracking-[0.18em] text-white/30 hover:text-white/60"
        >
          ✕
        </button>
      )}
    </div>
  );
}
