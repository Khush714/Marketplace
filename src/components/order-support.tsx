"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChevronDown, LoaderCircle, MessageCircle, Send } from "lucide-react";
import { cn } from "@/lib/domain";
import { useDocumentVisible } from "@/lib/order-access";
import { MAX_SUPPORT_MESSAGE_CHARS, type SupportThreadDto } from "@/lib/support-core";

/**
 * Order-aware customer support. This only renders for the browser that placed
 * the order, because the thread API is gated by the same HMAC order token as the
 * order itself — a shared tracking link stays read-only and never sees chat.
 */
export function OrderSupport({ code, token }: { code: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<SupportThreadDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const visible = useDocumentVisible();
  const historyRef = useRef<HTMLDivElement>(null);
  const loading = open && !loaded;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(code)}/support`, {
        headers: { "x-order-token": token },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("We couldn't load your conversation. Please try again.");
      const data = (await res.json()) as { ok: boolean; thread: SupportThreadDto | null };
      setThread(data.thread);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load your conversation.");
    } finally {
      setLoaded(true);
    }
  }, [code, token]);

  // Deferred to a macrotask so load()'s setState runs in a callback, not
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, load]);

  // Poll only while the panel is open and the tab is visible; ops replies show
  // up within one interval without turning a closed panel into background work.
  useEffect(() => {
    if (!open || !visible) return;
    const id = setInterval(() => { void load(); }, 6000);
    return () => clearInterval(id);
  }, [open, visible, load]);

  useEffect(() => {
    const node = historyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread?.messages.length]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoaded(false);
      setError("");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(code)}/support`, {
        method: "POST",
        headers: { "x-order-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean; thread?: SupportThreadDto; error?: string;
      } | null;
      if (!res.ok || !data?.ok || !data.thread) {
        throw new Error(data?.error ?? "We couldn't send your message. Please try again.");
      }
      setThread(data.thread);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send your message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ember-400/15 text-ember-300 ring-1 ring-ember-400/25">
            <MessageCircle className="size-4.5" />
          </span>
          <span>
            <span className="block font-display text-base font-bold text-cream-50">
              Need help with this order?
            </span>
            <span className="block text-xs text-cream-500">
              Chat with our support team about {code}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {thread && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                thread.status === "resolved"
                  ? "bg-mint-400/15 text-mint-300"
                  : "bg-ember-400/15 text-ember-300",
              )}
            >
              {thread.status}
            </span>
          )}
          <ChevronDown className={cn("size-4 text-cream-500 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="animate-pop-in mt-4 border-t border-white/10 pt-4">
          {loading && !thread ? (
            <p className="flex items-center gap-2 py-6 text-sm text-cream-500">
              <LoaderCircle className="size-4 animate-spin" /> Loading your conversation…
            </p>
          ) : (
            <>
              <div ref={historyRef} className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {!thread?.messages.length ? (
                  <p className="rounded-2xl bg-white/[0.04] px-3.5 py-4 text-center text-xs leading-relaxed text-cream-500">
                    Tell us what went wrong — a missing item, a late delivery, a payment question —
                    and our team will reply here.
                  </p>
                ) : (
                  thread.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn("flex", message.author === "customer" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                          message.author === "customer"
                            ? "bg-ember-500/20 text-cream-100 ring-1 ring-ember-400/25"
                            : "bg-white/[0.06] text-cream-300 ring-1 ring-white/10",
                        )}
                      >
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-cream-500">
                          {message.author === "customer" ? "You" : "Support"}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{message.body}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {thread?.status === "resolved" && (
                <p className="mt-3 rounded-xl bg-mint-400/10 px-3.5 py-2.5 text-xs text-mint-300">
                  This conversation is marked resolved. Sending another message reopens it.
                </p>
              )}

              {error && (
                <p role="alert" className="mt-3 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
                  {error}
                </p>
              )}

              <form onSubmit={send} className="mt-4">
                <label htmlFor="support-message" className="block text-xs font-semibold text-cream-300">
                  Your message
                </label>
                <textarea
                  id="support-message"
                  rows={3}
                  maxLength={MAX_SUPPORT_MESSAGE_CHARS}
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setError(""); }}
                  placeholder="Describe the issue and we'll take it from here."
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-cream-100 placeholder:text-cream-600 focus:border-ember-400/50 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-cream-600">
                    {draft.length}/{MAX_SUPPORT_MESSAGE_CHARS}
                  </span>
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-50"
                  >
                    {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Read-only counterpart for a shared `/order/track/<token>` link. That token
 * grants tracking, not the HMAC order token the thread API requires, so chat
 * cannot work on another device. Hand the customer to /contact with the order
 * code instead — a plain identifier, and the only thing support needs to find
 * the order — and let that page prefill the support mail.
 */
export function OrderSupportFallback({ code }: { code: string }) {
  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ember-400/15 text-ember-300 ring-1 ring-ember-400/25">
          <MessageCircle className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-cream-50">
            Need help with this order?
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-cream-400">
            You&rsquo;re viewing a shared tracking link, so the in-app chat isn&rsquo;t
            available here. Contact our support team with this order code and
            we&rsquo;ll help.
          </p>
          <p className="mt-2 font-mono text-sm font-bold uppercase tracking-wide text-cream-200">
            {code}
          </p>
          <Link
            href={`/contact?order=${encodeURIComponent(code)}`}
            className="press mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-100 transition-colors hover:bg-white/12"
          >
            Contact support <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
