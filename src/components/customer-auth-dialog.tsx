"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Smartphone,
  X,
} from "lucide-react";
import { useCustomerAccount } from "@/lib/customer-account";
import { useProfileIdentity, useProfileOrders } from "@/lib/profile";
import { cn } from "@/lib/domain";

const ease = [0.22, 1, 0.36, 1] as const;

type Step = "phone" | "code";
type AuthIntent = "signin" | "signup";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after successful sign-in/verification. */
  onSignedIn?: () => void;
  title?: string;
  message?: string;
  /** Initial mode. Defaults to sign-in. */
  initialIntent?: AuthIntent;
}

/**
 * Beautiful sign-in / sign-up popup. Uses phone OTP via the existing customer
 * account flow; creates an account automatically on first verification.
 * Guest checkout remains available elsewhere - this dialog is only shown when
 * a flow explicitly requires an account.
 */
export function CustomerAuthDialog({
  open,
  onClose,
  onSignedIn,
  title,
  message,
  initialIntent = "signin",
}: Props) {
  const account = useCustomerAccount();
  const identity = useProfileIdentity();
  const { clearOrders } = useProfileOrders();
  const [intent, setIntent] = useState<AuthIntent>(initialIntent);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Prefill/reset when opened.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional dialog reset on open
    setIntent(initialIntent);
    setStep("phone");
    setCode("");
    setError(null);
    setDevCode(null);
    setResendIn(0);
    setBusy(false);
    if (!phone && identity.phone) {
      const digits = identity.phone.replace(/\D/g, "");
      setPhone(digits.length === 10 ? `+91 ${digits}` : identity.phone);
    }
    if (initialIntent === "signup") {
      setName("");
    } else if (!name && identity.name) {
      setName(identity.name);
    }
    const t = window.setTimeout(() => phoneRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIntent]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (step === "code") {
      const t = window.setTimeout(() => codeRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [step]);

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setDevCode(null);
    const res = await account.startAuth(phone, intent);
    setBusy(false);
    if (!res.ok) {
      if (res.code === "ALREADY_REGISTERED") {
        setIntent("signin");
        setStep("phone");
        setError("This phone number is already registered. Please sign in.");
        return;
      }
      if (res.code === "ACCOUNT_NOT_FOUND") {
        setIntent("signup");
        setStep("phone");
        setError("No account found for this number. Please create an account.");
        return;
      }
      setError(res.error ?? "Unable to start sign-in");
      return;
    }
    if (res.devCode) setDevCode(res.devCode);
    setCode("");
    setStep("code");
    setResendIn(30);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await account.verifyAuth({ phone, code, name, intent });
    setBusy(false);
    if (!res.ok) {
      if (res.code === "ALREADY_REGISTERED") {
        setIntent("signin");
        setStep("phone");
        setCode("");
        setDevCode(null);
        setError("This phone number is already registered. Please sign in.");
        return;
      }
      if (res.code === "ACCOUNT_NOT_FOUND") {
        setIntent("signup");
        setStep("phone");
        setCode("");
        setDevCode(null);
        setError("No account found for this number. Please create an account.");
        return;
      }
      setError(res.error ?? "Unable to verify code");
      return;
    }
    // Shared-device privacy: clear previous device-local data before entering
    // a different account session.
    clearOrders();
    identity.resetIdentity();
    onSignedIn?.();
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Sign in or create account">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
            onClick={() => !busy && onClose()}
          />

          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease }}
            className="relative w-full max-w-lg overflow-hidden rounded-t-[28px] border border-white/10 bg-[#141210]/95 shadow-2xl backdrop-blur-xl sm:rounded-[28px]"
          >
            <div className="relative overflow-hidden border-b border-white/8 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(255,158,67,0.22),transparent_55%),radial-gradient(100%_120%_at_100%_0%,rgba(255,90,60,0.16),transparent_55%)] px-5 pb-5 pt-5 sm:px-6">
              <button
                type="button"
                onClick={() => !busy && onClose()}
                aria-label="Close"
                className="press absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-white/10 bg-black/20 text-cream-400 transition-colors hover:text-cream-50"
              >
                <X className="size-4" />
              </button>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-ember-400/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ember-300">
                <Sparkles className="size-3.5" /> Quick & secure
              </p>
              <h2 className="mt-3 pr-10 font-display text-2xl font-bold tracking-tight text-cream-50">
                {intent === "signup" ? "Create your account" : (title ?? "Welcome back")}
              </h2>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-cream-400">
                {intent === "signup"
                  ? "Create an account with your phone number. If you're already registered, we'll ask you to sign in."
                  : (message ?? "Sign in with your phone number to continue. Your account and order history are safely preserved.")}
              </p>

              <div className="mt-4 flex items-center gap-2 text-xs text-cream-400">
                <span className={cn("grid size-6 place-items-center rounded-full text-[11px] font-bold", step === "phone" ? "bg-ember-400 text-coal" : "bg-mint-500/15 text-mint-400")}>1</span>
                <span className={step === "phone" ? "text-cream-200" : "text-mint-400"}>Phone</span>
                <ArrowRight className="size-3.5 text-cream-600" />
                <span className={cn("grid size-6 place-items-center rounded-full text-[11px] font-bold", step === "code" ? "bg-ember-400 text-coal" : "bg-white/10 text-cream-500")}>2</span>
                <span className={step === "code" ? "text-cream-200" : "text-cream-500"}>Verify</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-black/25 p-1">
                <button
                  type="button"
                  onClick={() => {
                    if (busy || intent === "signin") return;
                    setIntent("signin");
                    setError(null);
                    setStep("phone");
                    setCode("");
                    setDevCode(null);
                    setResendIn(0);
                    if (!name && identity.name) setName(identity.name);
                  }}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-all",
                    intent === "signin" ? "bg-white/12 text-cream-50 shadow-sm" : "text-cream-400 hover:text-cream-200",
                  )}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (busy || intent === "signup") return;
                    setIntent("signup");
                    setError(null);
                    setStep("phone");
                    setCode("");
                    setDevCode(null);
                    setResendIn(0);
                    setName("");
                  }}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-all",
                    intent === "signup" ? "bg-white/12 text-cream-50 shadow-sm" : "text-cream-400 hover:text-cream-200",
                  )}
                >
                  Create account
                </button>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              <AnimatePresence mode="wait" initial={false}>
                {step === "phone" ? (
                  <motion.form
                    key="phone"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: 0.2, ease }}
                    onSubmit={start}
                    className="space-y-4"
                  >
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <Feature icon={Smartphone} title="One-time code" text="Fast phone verification." />
                      <Feature icon={ShieldCheck} title="Secure" text="Hashed, never logged." />
                      <Feature icon={Sparkles} title={intent === "signup" ? "Create account" : "Welcome back"} text={intent === "signup" ? "New to Crave." : "Sign in securely."} />
                    </div>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-cream-500">Mobile number</span>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-cream-500" />
                        <input
                          ref={phoneRef}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                          inputMode="tel"
                          autoComplete="tel"
                          className="w-full rounded-2xl border border-white/10 bg-black/30 py-3.5 pl-11 pr-4 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none focus:ring-2 focus:ring-ember-400/15"
                        />
                      </div>
                    </label>

                    {error && <ErrorBox message={error} />}

                    <button
                      type="submit"
                      disabled={busy || !phone.trim()}
                      className="press inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-3.5 text-sm font-bold text-white shadow-glow disabled:opacity-50"
                    >
                      {busy ? <LoaderCircle className="size-4 animate-spin-slow" /> : <ArrowRight className="size-4" />}
                      {busy ? "Sending code…" : "Continue"}
                    </button>
                    <p className="text-center text-xs text-cream-500">
                      {intent === "signup"
                        ? "Already registered? Switch to Sign in above."
                        : "New here? Switch to Create account above."}
                    </p>
                  </motion.form>
                ) : (
                  <motion.form
                    key="code"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.2, ease }}
                    onSubmit={verify}
                    className="space-y-4"
                  >
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm font-semibold text-cream-100">
                        Code sent to <span className="text-ember-300">{phone.trim() || "your number"}</span>
                      </p>
                      <p className="mt-1 text-xs text-cream-500">
                        {intent === "signup"
                          ? "Enter the code and your name to create your account."
                          : "Enter the code to sign in to your account."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-cream-500">Verification code</span>
                        <input
                          ref={codeRef}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                          placeholder="Enter code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-center font-mono text-lg font-bold tracking-[0.35em] text-cream-50 placeholder:tracking-normal placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none focus:ring-2 focus:ring-ember-400/15"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-cream-500">
                          Your name{" "}
                          {intent === "signup" ? (
                            <span className="font-medium normal-case tracking-normal text-chili-400">(required)</span>
                          ) : (
                            <span className="font-medium normal-case tracking-normal text-cream-600">(optional)</span>
                          )}
                        </span>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="How should we call you?"
                          autoComplete="name"
                          required={intent === "signup"}
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none focus:ring-2 focus:ring-ember-400/15"
                        />
                      </label>
                    </div>

                    {devCode && (
                      <div className="rounded-2xl border border-ember-400/25 bg-ember-500/10 px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ember-300">Verification code (on-screen test mode)</p>
                        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-cream-50">{devCode}</p>
                      </div>
                    )}

                    {error && <ErrorBox message={error} />}

                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <button
                        type="submit"
                        disabled={busy || code.trim().length < 4 || (intent === "signup" && !name.trim())}
                        className="press inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-3.5 text-sm font-bold text-white shadow-glow disabled:opacity-50"
                      >
                        {busy ? <LoaderCircle className="size-4 animate-spin-slow" /> : <Check className="size-4" />}
                        {busy ? "Verifying…" : "Verify & continue"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void start()}
                        disabled={busy || resendIn > 0}
                        className="press inline-flex items-center justify-center gap-2 rounded-2xl bg-white/8 px-5 py-3.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
                      >
                        <RefreshCw className={cn("size-4", busy && "animate-spin-slow")} />
                        {resendIn > 0 ? `Resend ${resendIn}s` : "Resend"}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setStep("phone");
                        setCode("");
                        setDevCode(null);
                        setError(null);
                        setResendIn(0);
                      }}
                      className="w-full text-center text-xs font-medium text-cream-500 transition-colors hover:text-cream-200"
                    >
                      Change number
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <Icon className="size-4 text-ember-400" />
      <p className="mt-1.5 text-xs font-semibold text-cream-100">{title}</p>
      <p className="text-[11px] leading-snug text-cream-500">{text}</p>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <p className="rounded-xl border border-chili-500/20 bg-chili-500/10 px-3 py-2 text-sm text-chili-300">{message}</p>;
}
