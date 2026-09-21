import { AnimatePresence, motion } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  type CardBrand,
  type CardDetails,
  type CardField,
  type CardKind,
  validateCard,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  accent: Accent;
  disabled: boolean;
  card: CardDetails;
  focus: CardField;
  brand: CardBrand;
  cardKind: CardKind;
  onKind: (k: CardKind) => void;
  onChange: (patch: Partial<CardDetails>) => void;
  onFocus: (f: CardField) => void;
  onSubmit: () => void;
};

export default function CardForm({
  accent,
  disabled,
  card,
  focus,
  brand,
  cardKind,
  onKind,
  onChange,
  onFocus,
  onSubmit,
}: Props) {
  const v = validateCard(card);

  return (
    <div className={disabled ? "pointer-events-none select-none opacity-45" : ""}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.34em] text-white/35">CARD DETAILS</p>
        <KindToggle accent={accent} value={cardKind} onChange={onKind} />
      </div>

      <div className="space-y-3">
        <Field
          id="cc-name"
          label="CARDHOLDER NAME"
          value={card.name}
          placeholder="NAME ON CARD"
          accent={accent}
          focused={focus === "name"}
          valid={card.name.length > 0 ? v.nameOk : null}
          onChange={(name) => onChange({ name })}
          onFocus={() => onFocus("name")}
          onBlur={() => onFocus(null)}
          autoComplete="cc-name"
        />

        <Field
          id="cc-number"
          label="CARD NUMBER"
          value={card.number}
          placeholder="0000 0000 0000 0000"
          accent={accent}
          focused={focus === "number"}
          valid={v.numberFull ? v.numberOk : null}
          onChange={(number) => onChange({ number })}
          onFocus={() => onFocus("number")}
          onBlur={() => onFocus(null)}
          inputMode="numeric"
          autoComplete="cc-number"
          mono
          trailing={<BrandTag brand={brand} accent={accent} />}
          hint={v.numberFull && !v.numberOk ? "This card number doesn't check out" : undefined}
        />

        <div className="grid grid-cols-[1fr_7.5rem] gap-3">
          <Field
            id="cc-exp"
            label="EXPIRY DATE"
            value={card.expiry}
            placeholder="MM / YY"
            accent={accent}
            focused={focus === "expiry"}
            valid={card.expiry.replace(/\D/g, "").length === 4 ? v.expiryOk : null}
            onChange={(expiry) => onChange({ expiry })}
            onFocus={() => onFocus("expiry")}
            onBlur={() => onFocus(null)}
            inputMode="numeric"
            autoComplete="cc-exp"
            mono
            hint={
              card.expiry.replace(/\D/g, "").length === 4 && !v.expiryOk
                ? "Card has expired"
                : undefined
            }
          />
          <Field
            id="cc-cvv"
            label="CVV"
            value={card.cvv}
            placeholder={brand === "amex" ? "••••" : "•••"}
            accent={accent}
            focused={focus === "cvv"}
            valid={card.cvv.length > 0 ? v.cvvOk : null}
            onChange={(cvv) => onChange({ cvv })}
            onFocus={() => onFocus("cvv")}
            onBlur={() => onFocus(null)}
            inputMode="numeric"
            autoComplete="cc-csc"
            type="password"
            mono
            onEnter={onSubmit}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.18em] text-white/25">
          {focus === "cvv" ? "Card flipped · security code on the back" : "Details are tokenised before leaving your device"}
        </p>
        <div className="flex items-center gap-1.5">
          {(["name", "number", "expiry", "cvv"] as const).map((k) => {
            const ok =
              k === "name" ? v.nameOk : k === "number" ? v.numberOk : k === "expiry" ? v.expiryOk : v.cvvOk;
            return (
              <span
                key={k}
                className="h-1 w-4 rounded-full transition-colors duration-500"
                style={{
                  background: ok ? `rgba(${ACCENTS[accent].rgb},0.9)` : "rgba(255,255,255,0.1)",
                  boxShadow: ok ? `0 0 8px rgba(${ACCENTS[accent].rgb},0.6)` : "none",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── premium field ─────────────────────────────────────── */

function Field({
  id,
  label,
  value,
  placeholder,
  accent,
  focused,
  valid,
  onChange,
  onFocus,
  onBlur,
  onEnter,
  inputMode,
  autoComplete,
  type = "text",
  mono,
  trailing,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  accent: Accent;
  focused: boolean;
  valid: boolean | null;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onEnter?: () => void;
  inputMode?: "numeric" | "text";
  autoComplete?: string;
  type?: string;
  mono?: boolean;
  trailing?: React.ReactNode;
  hint?: string;
}) {
  const rgb = ACCENTS[accent].rgb;
  const raised = focused || value.length > 0;
  const invalid = valid === false;

  return (
    <div>
      <div className="relative">
        <label
          htmlFor={id}
          className={`pointer-events-none absolute left-4 z-10 origin-left font-mono tracking-[0.2em] transition-all duration-300 ${
            raised ? "top-1.5 text-[9px] text-white/45" : "top-1/2 -translate-y-1/2 text-[11px] text-white/35"
          }`}
        >
          {label}
        </label>
        <div
          className="glass-soft relative flex items-center overflow-hidden rounded-2xl transition-all duration-500"
          style={{
            borderColor: invalid
              ? "rgba(224,106,106,0.5)"
              : focused || valid
                ? `rgba(${rgb},0.45)`
                : undefined,
            boxShadow:
              focused && !invalid
                ? `0 0 0 1px rgba(${rgb},0.25), 0 0 34px -12px rgba(${rgb},0.9)`
                : undefined,
          }}
        >
          {/* focus sweep */}
          <span
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left transition-transform duration-500"
            style={{
              background: `linear-gradient(to right, rgba(${rgb},0), rgba(${rgb},0.9), rgba(${rgb},0))`,
              transform: focused ? "scaleX(1)" : "scaleX(0)",
            }}
          />
          <input
            id={id}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onEnter) onEnter();
            }}
            placeholder={focused ? placeholder : ""}
            inputMode={inputMode}
            autoComplete={autoComplete}
            spellCheck={false}
            className={`w-full bg-transparent px-4 pb-2.5 pt-6 text-[13.5px] tracking-[0.08em] text-white outline-none placeholder:text-white/20 ${
              mono ? "font-mono" : "uppercase"
            }`}
          />
          <div className="flex items-center gap-2 pr-3">
            {trailing}
            <AnimatePresence>
              {valid === true && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.3, ease }}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-400/15 text-emerald-200"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none">
                    <motion.path
                      d="M6 12.5 10.5 17 18 7.5"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35, ease }}
                    />
                  </svg>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {hint && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 pl-1 text-[10.5px] tracking-[0.1em] text-[#e0a0a0]"
          >
            {hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function KindToggle({
  accent,
  value,
  onChange,
}: {
  accent: Accent;
  value: CardKind;
  onChange: (k: CardKind) => void;
}) {
  const rgb = ACCENTS[accent].rgb;
  const kinds: { id: CardKind; label: string }[] = [
    { id: "credit", label: "CREDIT" },
    { id: "debit", label: "DEBIT" },
  ];
  return (
    <div className="glass-soft inline-flex items-center gap-0.5 rounded-full p-0.5">
      {kinds.map((k) => {
        const active = k.id === value;
        return (
          <button
            key={k.id}
            type="button"
            onClick={() => onChange(k.id)}
            className={`relative rounded-full px-3 py-1 text-[9px] tracking-[0.22em] transition-colors ${
              active ? "text-black" : "text-white/40 hover:text-white/70"
            }`}
          >
            {active && (
              <motion.span
                layoutId="card-kind-pill"
                transition={{ duration: 0.4, ease }}
                className="absolute inset-0 rounded-full"
                style={{
                  background: `linear-gradient(135deg, rgba(${rgb},0.95), rgba(255,255,255,0.92))`,
                  boxShadow: `0 3px 14px -5px rgba(${rgb},0.9)`,
                }}
              />
            )}
            <span className="relative z-10">{k.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function BrandTag({ brand, accent }: { brand: CardBrand; accent: Accent }) {
  if (brand === "unknown") return null;
  const label =
    brand === "visa" ? "VISA" : brand === "mastercard" ? "MASTERCARD" : brand === "amex" ? "AMEX" : "RUPAY";
  return (
    <motion.span
      key={brand}
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-[0.18em]"
      style={{
        borderColor: `rgba(${ACCENTS[accent].rgb},0.35)`,
        color: ACCENTS[accent].soft,
        background: `rgba(${ACCENTS[accent].rgb},0.08)`,
      }}
    >
      {label}
    </motion.span>
  );
}
