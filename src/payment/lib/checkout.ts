import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────
   Shared payment vocabulary
   ───────────────────────────────────────────────────────────── */

export type Channel = "upi" | "cash" | "card";

/* ── Card helpers ─────────────────────────────────────────── */

export type CardBrand = "visa" | "mastercard" | "rupay" | "amex" | "unknown";

export type CardField = "name" | "number" | "expiry" | "cvv" | null;

export type CardKind = "credit" | "debit";

export type CardDetails = { name: string; number: string; expiry: string; cvv: string };

export function detectBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(60|65|81|82|508)/.test(digits)) return "rupay";
  return "unknown";
}

export function luhn(digits: string) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function formatCardNumber(raw: string, brand: CardBrand) {
  const digits = raw.replace(/\D/g, "").slice(0, brand === "amex" ? 15 : 16);
  if (brand === "amex") {
    return digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join(" "),
    );
  }
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function formatExpiry(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)} / ${d.slice(2)}`;
}

export function validateCard(card: CardDetails) {
  const digits = card.number.replace(/\D/g, "");
  const brand = detectBrand(digits);
  const expectedLen = brand === "amex" ? 15 : 16;
  const numberOk = digits.length === expectedLen && luhn(digits);

  const exp = card.expiry.replace(/\D/g, "");
  let expiryOk = false;
  if (exp.length === 4) {
    const mm = Number(exp.slice(0, 2));
    const yy = Number(exp.slice(2));
    const now = new Date();
    const cy = now.getFullYear() % 100;
    const cm = now.getMonth() + 1;
    expiryOk = mm >= 1 && mm <= 12 && (yy > cy || (yy === cy && mm >= cm));
  }

  const cvvOk = card.cvv.length === (brand === "amex" ? 4 : 3);
  const nameOk = card.name.trim().length >= 2;

  return {
    brand,
    nameOk,
    numberOk,
    expiryOk,
    cvvOk,
    complete: nameOk && numberOk && expiryOk && cvvOk,
    numberTouched: digits.length > 0,
    numberFull: digits.length === expectedLen,
  };
}

export type Phase =
  | "idle"
  | "initiated"
  | "verifying"
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "cancelled";

export type Outcome = "auto" | "success" | "pending" | "failed";

/** UPI initiation path — only meaningful when channel === "upi". */
export type UpiMethod = "qr" | "app" | "upi-id";

export type Accent = "gold" | "emerald" | "fail" | "amber" | "copper";

export const ACCENTS: Record<Accent, { rgb: string; hex: string; soft: string }> = {
  gold: { rgb: "249,115,22", hex: "#ff9f45", soft: "#ffd79a" },
  copper: { rgb: "212,140,70", hex: "#d48c46", soft: "#f0c48a" },
  amber: { rgb: "245,180,60", hex: "#f5b43c", soft: "#ffe2a8" },
  emerald: { rgb: "16,185,129", hex: "#34d399", soft: "#a7f3d0" },
  fail: { rgb: "224,106,106", hex: "#e06a6a", soft: "#f3b8b8" },
};

export const PHASE_ACCENT: Record<Phase, Accent> = {
  idle: "gold",
  initiated: "gold",
  verifying: "amber",
  pending: "amber",
  success: "emerald",
  failed: "fail",
  expired: "fail",
  cancelled: "fail",
};

export const TERMINAL: Phase[] = ["success", "failed", "expired", "cancelled"];

let AMOUNT = 1234;

export type OrderLine = { label: string; value: number };

export const ORDER = {
  amount: AMOUNT,
  currency: "₹",
  payee: "CODEXR",
  payeeVpa: "codexr@ybl",
  merchantCity: "Bengaluru",
  orderNo: "1048",
  table: "12",
  items: [
    { label: "Aurora Console — Studio", value: 999 },
    { label: "Priority dispatch", value: 149 },
    { label: "GST (18%)", value: 86 },
  ],
};

/** Wires the animation to a real bill. Components read ORDER/AMOUNT at render time,
    so mutating these values updates every display without touching component logic. */
export function configureOrder(config: {
  amountCents: number;
  payee?: string;
  lines?: OrderLine[];
}) {
  AMOUNT = Math.max(0, Math.round(config.amountCents / 100));
  ORDER.amount = AMOUNT;
  if (config.payee) ORDER.payee = config.payee;
  if (config.lines && config.lines.length > 0) ORDER.items = config.lines;
}

/** Indian banknote denominations, largest first — used for change breakdown. */
export const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Quick-select tiles for the POS pad. */
export const CASH_SHORTCUTS = [100, 200, 500, 1000, 2000, 5000] as const;

export type NotePart = { value: number; count: number };

export function breakdown(amount: number): NotePart[] {
  let left = Math.max(0, Math.round(amount));
  const parts: NotePart[] = [];
  for (const d of DENOMINATIONS) {
    if (left < d) continue;
    const count = Math.floor(left / d);
    parts.push({ value: d, count });
    left -= count * d;
  }
  return parts;
}

export function formatINR(value: number, withDecimals = true) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  });
}

export function clock(total: number) {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function makeRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function buildUpiPayload(ref: string) {
  return `upi://pay?pa=${ORDER.payeeVpa}&pn=${ORDER.payee}&am=${AMOUNT}.00&cu=INR&tn=Order%20${ref}&tr=${ref}`;
}

const WINDOW_SECONDS = 8 * 60;

export type CashBalance =
  | { kind: "empty" }
  | { kind: "under"; remaining: number }
  | { kind: "exact" }
  | { kind: "over"; change: number };

export function cashBalance(received: number, due = ORDER.amount): CashBalance {
  if (received <= 0) return { kind: "empty" };
  if (received < due) return { kind: "under", remaining: due - received };
  if (received === due) return { kind: "exact" };
  return { kind: "over", change: received - due };
}

/* ─────────────────────────────────────────────────────────────
   Unified checkout hook
   ───────────────────────────────────────────────────────────── */

export function useCheckout(outcome: Outcome) {
  const [channel, setChannelState] = useState<Channel>("upi");
  const [phase, setPhase] = useState<Phase>("idle");
  const [upiMethod, setUpiMethod] = useState<UpiMethod | null>(null);
  const [appLabel, setAppLabel] = useState<string | null>(null);
  const [vpa, setVpa] = useState("");
  const [reference, setReference] = useState(makeRef);
  const [secondsLeft, setSecondsLeft] = useState(WINDOW_SECONDS);

  // cash
  const [received, setReceived] = useState(0);
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [notePulse, setNotePulse] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // settle snapshot — frozen at confirm so the result screen never drifts
  const [settledReceived, setSettledReceived] = useState(0);
  const [settledChange, setSettledChange] = useState(0);

  // card
  const [card, setCard] = useState<CardDetails>({ name: "", number: "", expiry: "", cvv: "" });
  const [cardFocus, setCardFocus] = useState<CardField>(null);
  const [cardKind, setCardKindState] = useState<CardKind>("credit");
  const setCardKind = useCallback(
    (kind: CardKind) => {
      if (phase !== "idle") return;
      setCardKindState(kind);
    },
    [phase],
  );
  const cardValidation = useMemo(() => validateCard(card), [card]);
  const canPayCard = channel === "card" && phase === "idle" && cardValidation.complete;

  const updateCard = useCallback((patch: Partial<CardDetails>) => {
    setCard((c) => {
      const next = { ...c, ...patch };
      if (patch.number !== undefined) {
        const brand = detectBrand(patch.number.replace(/\D/g, ""));
        next.number = formatCardNumber(patch.number, brand);
      }
      if (patch.expiry !== undefined) next.expiry = formatExpiry(patch.expiry);
      if (patch.cvv !== undefined) next.cvv = patch.cvv.replace(/\D/g, "").slice(0, 4);
      if (patch.name !== undefined) next.name = patch.name.toUpperCase().slice(0, 26);
      return next;
    });
  }, []);

  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // QR expiry window — UPI idle only
  useEffect(() => {
    if (channel !== "upi" || phase !== "idle") return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          setPhase("expired");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [channel, phase]);

  const balance = useMemo(() => cashBalance(received), [received]);
  const canConfirmCash =
    channel === "cash" && phase === "idle" && (balance.kind === "exact" || balance.kind === "over");

  const resolve = useCallback((): Exclude<Outcome, "auto"> => {
    if (outcome !== "auto") return outcome;
    const r = Math.random();
    if (r < 0.7) return "success";
    if (r < 0.9) return "pending";
    return "failed";
  }, [outcome]);

  const setChannel = useCallback(
    (next: Channel) => {
      if (phase !== "idle" && phase !== "expired" && phase !== "cancelled" && phase !== "failed") {
        return;
      }
      clearTimers();
      setChannelState(next);
      setPhase("idle");
      setUpiMethod(null);
      setAppLabel(null);
      setVpa("");
      setReceived(0);
      setLastNote(null);
      setDrawerOpen(false);
      setSettledReceived(0);
      setSettledChange(0);
      setCard({ name: "", number: "", expiry: "", cvv: "" });
      setCardFocus(null);
      setCardKindState("credit");
      if (next === "upi") setSecondsLeft(WINDOW_SECONDS);
    },
    [phase, clearTimers],
  );

  /* ── UPI start ── */
  const startUpi = useCallback(
    (nextMethod: UpiMethod, label?: string) => {
      if (channel !== "upi" || phase !== "idle") return;
      clearTimers();
      setUpiMethod(nextMethod);
      setAppLabel(label ?? null);
      setPhase("initiated");

      later(() => setPhase("verifying"), 1150);

      const result = resolve();
      later(
        () => {
          if (result === "failed") setPhase("failed");
          else if (result === "pending") {
            setPhase("pending");
            later(() => setPhase("success"), 3600);
          } else setPhase("success");
        },
        1150 + 2600,
      );
    },
    [channel, phase, clearTimers, later, resolve],
  );

  /* ── Card authorisation — same UPI-style timing, no "pending" branch ── */
  const startCard = useCallback(() => {
    if (!canPayCard) return;
    clearTimers();
    setCardFocus(null);
    setPhase("initiated");
    later(() => setPhase("verifying"), 900);
    const result = resolve();
    later(() => setPhase(result === "failed" ? "failed" : "success"), 900 + 2700);
  }, [canPayCard, clearTimers, later, resolve]);

  /* ── Cash pad ── */
  const addDenomination = useCallback(
    (value: number) => {
      if (channel !== "cash" || phase !== "idle") return;
      setReceived((r) => r + value);
      setLastNote(value);
      setNotePulse((n) => n + 1);
    },
    [channel, phase],
  );

  const setExact = useCallback(() => {
    if (channel !== "cash" || phase !== "idle") return;
    setReceived(ORDER.amount);
    setLastNote(null);
    setNotePulse((n) => n + 1);
  }, [channel, phase]);

  const setCashAmount = useCallback(
    (value: number) => {
      if (channel !== "cash" || phase !== "idle") return;
      setReceived(Math.max(0, Math.round(value)));
      setLastNote(null);
      setNotePulse((n) => n + 1);
    },
    [channel, phase],
  );

  const clearCash = useCallback(() => {
    if (channel !== "cash" || phase !== "idle") return;
    setReceived(0);
    setLastNote(null);
  }, [channel, phase]);

  /* ── Cash confirm — short, decisive ── */
  const confirmCash = useCallback(() => {
    if (!canConfirmCash) return;
    clearTimers();
    const bal = cashBalance(received);
    const change = bal.kind === "over" ? bal.change : 0;
    setSettledReceived(received);
    setSettledChange(change);
    setPhase("initiated");

    // 0.2s lock → 0.4s pulse → 0.7s check → 1.0s success → drawer
    later(() => setPhase("verifying"), 280);
    later(() => {
      setPhase("success");
      later(() => setDrawerOpen(true), 420);
    }, 900);
  }, [canConfirmCash, clearTimers, later, received]);

  const cancel = useCallback(() => {
    clearTimers();
    setPhase("cancelled");
    setDrawerOpen(false);
  }, [clearTimers]);

  const expire = useCallback(() => {
    if (channel !== "upi") return;
    clearTimers();
    setSecondsLeft(0);
    setPhase("expired");
  }, [channel, clearTimers]);

  const hardReset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setUpiMethod(null);
    setAppLabel(null);
    setVpa("");
    setReference(makeRef());
    setSecondsLeft(WINDOW_SECONDS);
    setReceived(0);
    setLastNote(null);
    setDrawerOpen(false);
    setSettledReceived(0);
    setSettledChange(0);
    setCard({ name: "", number: "", expiry: "", cvv: "" });
    setCardFocus(null);
    setCardKindState("credit");
  }, [clearTimers]);

  const reset = hardReset;

  const retry = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setDrawerOpen(false);
    if (channel === "upi") {
      setSecondsLeft((s) => (s <= 0 ? WINDOW_SECONDS : s));
    } else {
      // keep the tendered amount so the cashier can adjust and re-confirm
    }
  }, [clearTimers, channel]);

  // idle cash: accent warms toward copper; exact cash glows emerald early
  let accent: Accent = PHASE_ACCENT[phase];
  if (channel === "cash" && phase === "idle") {
    if (balance.kind === "exact") accent = "emerald";
    else if (balance.kind === "over") accent = "copper";
    else accent = "copper";
  } else if (channel === "cash" && (phase === "initiated" || phase === "verifying")) {
    accent = "copper";
  }

  const isTerminal = TERMINAL.includes(phase);
  const isLive = phase === "initiated" || phase === "verifying" || phase === "pending";

  return {
    channel,
    setChannel,
    phase,
    accent,
    isTerminal,
    isLive,
    // upi
    upiMethod,
    appLabel,
    vpa,
    setVpa,
    reference,
    secondsLeft,
    startUpi,
    expire,
    // cash
    received,
    balance,
    lastNote,
    notePulse,
    canConfirmCash,
    addDenomination,
    setExact,
    setCashAmount,
    clearCash,
    confirmCash,
    settledReceived,
    settledChange,
    drawerOpen,
    // card
    card,
    updateCard,
    cardFocus,
    setCardFocus,
    cardKind,
    setCardKind,
    cardValidation,
    canPayCard,
    startCard,
    // shared
    cancel,
    reset,
    retry,
  };
}

/** Smoothly counts a number up — used for the success amount reveal. */
export function useCountUp(target: number, run: boolean, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) {
      setValue(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);
  return value;
}

/** Animate a numeric display toward a target (cash received / change). */
export function useAnimatedNumber(target: number, duration = 420) {
  const [value, setValue] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
