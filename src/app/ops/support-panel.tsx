"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, MessageCircle, RefreshCw, RotateCcw, Send } from "lucide-react";
import { cn } from "@/lib/domain";
import { useDocumentVisible } from "@/lib/order-access";
import { MAX_SUPPORT_MESSAGE_CHARS, type OpsSupportThreadDetail, type OpsSupportThreadDto, type SupportStatus } from "@/lib/support-core";
import { useToast } from "@/lib/toast";

type OpsCall = <T>(url: string, init?: RequestInit) => Promise<T>;
type Filter = SupportStatus | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "all", label: "All" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Platform support inbox. List and conversation are polled only while this tab
 * is visible, using the same `call` helper as every other ops panel so the token
 * stays in memory and never becomes part of a URL.
 */
export default function SupportPanel({ canAct, call }: { canAct: boolean; call: OpsCall }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [threads, setThreads] = useState<OpsSupportThreadDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsSupportThreadDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"reply" | "status" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const visible = useDocumentVisible();
  const historyRef = useRef<HTMLDivElement>(null);
  const detailIdRef = useRef<string | null>(null);
  const loading = canAct && !loaded;

  // The first thread is shown automatically, but keeping the explicit choice in
  // state means a refresh never moves the operator to a different conversation.
  const activeId = selectedId && threads.some((thread) => thread.id === selectedId)
    ? selectedId
    : (threads[0]?.id ?? null);

  const loadList = useCallback(async () => {
    if (!canAct) return;
    try {
      const data = await call<{ ok: boolean; threads: OpsSupportThreadDto[] }>(
        `/api/ops/support?status=${filter}`,
      );
      setThreads(data.threads);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load support threads");
    } finally {
      setLoaded(true);
    }
  }, [call, canAct, filter]);

  const loadDetail = useCallback(async (id: string) => {
    if (detailIdRef.current !== id) {
      detailIdRef.current = id;
      setDetail(null);
      setDraft("");
    }
    try {
      const data = await call<{ ok: boolean; thread: OpsSupportThreadDetail }>(
        `/api/ops/support/${encodeURIComponent(id)}`,
      );
      setDetail(data.thread);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this conversation");
    }
  }, [call]);

  // Deferred to a macrotask so the loaders' setState runs in a callback, not
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!canAct) return;
    const t = window.setTimeout(() => { void loadList(); }, 0);
    return () => window.clearTimeout(t);
  }, [canAct, loadList]);

  useEffect(() => {
    if (!canAct || !visible) return;
    const id = setInterval(() => { void loadList(); }, 8000);
    return () => clearInterval(id);
  }, [canAct, visible, loadList]);

  useEffect(() => {
    if (!activeId || !canAct) return;
    const t = window.setTimeout(() => { void loadDetail(activeId); }, 0);
    return () => window.clearTimeout(t);
  }, [activeId, canAct, loadDetail]);

  useEffect(() => {
    if (!activeId || !canAct || !visible) return;
    const id = setInterval(() => { void loadDetail(activeId); }, 6000);
    return () => clearInterval(id);
  }, [activeId, canAct, visible, loadDetail]);

  useEffect(() => {
    const node = historyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [detail?.messages.length]);

  function selectThread(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDraft("");
  }

  function changeFilter(next: Filter) {
    setFilter(next);
    setThreads([]);
    setSelectedId(null);
    setDetail(null);
    setDraft("");
    setLoaded(false);
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !activeId || busy) return;
    setBusy("reply");
    setError("");
    try {
      const data = await call<{ ok: boolean; thread: OpsSupportThreadDetail }>(
        `/api/ops/support/${encodeURIComponent(activeId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) },
      );
      setDetail(data.thread);
      setDraft("");
      toast("Support reply sent");
      void loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reply");
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(status: SupportStatus) {
    if (!activeId || busy) return;
    setBusy("status");
    setError("");
    try {
      const data = await call<{ ok: boolean; thread: OpsSupportThreadDetail }>(
        `/api/ops/support/${encodeURIComponent(activeId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
      );
      setDetail(data.thread);
      toast(status === "RESOLVED" ? "Thread resolved" : "Thread reopened");
      void loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the thread");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
            <MessageCircle className="size-4.5 text-ember-400" /> Support inbox
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            Order-aware customer conversations. A customer message reopens a resolved thread.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => changeFilter(option.value)}
              aria-pressed={filter === option.value}
              className={cn(
                "press rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === option.value
                  ? "bg-white/12 text-cream-50"
                  : "text-cream-500 hover:text-cream-200",
              )}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setLoaded(false); void loadList(); }}
            disabled={!canAct}
            aria-label="Refresh support threads"
            className="press grid size-7 place-items-center rounded-lg text-cream-500 transition-colors hover:text-cream-200 disabled:opacity-40"
          >
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
        </div>
      </div>

      {!canAct && (
        <p className="mt-4 rounded-xl border border-ember-500/25 bg-ember-500/8 px-3.5 py-2.5 text-xs text-ember-200">
          Paste the ops token above to read and reply to customer conversations.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      <div className="mt-4 grid min-h-80 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        <div className="space-y-2">
          {loading && !threads.length ? (
            <p className="flex items-center gap-2 px-1 py-6 text-xs text-cream-500">
              <LoaderCircle className="size-4 animate-spin" /> Loading threads…
            </p>
          ) : !threads.length ? (
            <p className="rounded-2xl bg-white/[0.04] px-3.5 py-6 text-center text-xs text-cream-500">
              {canAct ? "No conversations in this view yet." : "Waiting for an ops token."}
            </p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => selectThread(thread.id)}
                aria-current={activeId === thread.id ? "true" : undefined}
                className={cn(
                  "press w-full rounded-2xl border p-3 text-left transition-colors",
                  activeId === thread.id
                    ? "border-ember-400/40 bg-ember-500/10"
                    : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-cream-200">{thread.orderCode}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      thread.status === "resolved"
                        ? "bg-mint-400/15 text-mint-300"
                        : "bg-ember-400/15 text-ember-300",
                    )}
                  >
                    {thread.status}
                  </span>
                </span>
                <span className="mt-1.5 block truncate text-xs text-cream-300">{thread.preview}</span>
                <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-cream-600">
                  <span className="truncate">{thread.restaurantName}</span>
                  <span className="shrink-0">{when(thread.lastMessageAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          {!detail ? (
            <p className="flex h-full min-h-64 items-center justify-center text-center text-xs text-cream-600">
              {activeId ? "Loading conversation…" : "Select a conversation to read and reply."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-cream-100">{detail.orderCode}</p>
                  <p className="mt-0.5 truncate text-xs text-cream-500">
                    {detail.restaurantName} · {detail.customerName} · {detail.messageCount} messages
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void changeStatus(detail.status === "resolved" ? "OPEN" : "RESOLVED")}
                  disabled={busy === "status"}
                  className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
                >
                  {busy === "status" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : detail.status === "resolved" ? (
                    <RotateCcw className="size-3.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  {detail.status === "resolved" ? "Reopen" : "Resolve"}
                </button>
              </div>

              <div ref={historyRef} className="max-h-72 space-y-3 overflow-y-auto py-4 pr-1">
                {detail.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn("flex", message.author === "ops" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                        message.author === "ops"
                          ? "bg-ember-500/20 text-cream-100 ring-1 ring-ember-400/25"
                          : "bg-white/[0.06] text-cream-300 ring-1 ring-white/10",
                      )}
                    >
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-cream-500">
                        {message.author === "ops" ? "Ops" : "Customer"} · {when(message.createdAt)}
                      </span>
                      <span className="whitespace-pre-wrap break-words">{message.body}</span>
                    </div>
                  </div>
                ))}
              </div>

              {detail.status === "resolved" && (
                <p className="mb-3 rounded-xl bg-mint-400/10 px-3 py-2 text-[11px] text-mint-300">
                  Resolved. A new customer message will reopen it automatically.
                </p>
              )}

              <form onSubmit={reply} className="border-t border-white/10 pt-3">
                <textarea
                  rows={3}
                  maxLength={MAX_SUPPORT_MESSAGE_CHARS}
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setError(""); }}
                  placeholder="Reply to the customer…"
                  aria-label="Support reply"
                  className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3 text-xs text-cream-100 placeholder:text-cream-600 focus:border-ember-400/50 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] text-cream-600">
                    {draft.length}/{MAX_SUPPORT_MESSAGE_CHARS}
                  </span>
                  <button
                    type="submit"
                    disabled={!draft.trim() || busy === "reply"}
                    className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-3.5 py-2 text-xs font-bold text-white transition-opacity disabled:opacity-50"
                  >
                    {busy === "reply" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    {busy === "reply" ? "Sending…" : "Reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
