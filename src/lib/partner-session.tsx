"use client";

/**
 * Client side of the restaurant session.
 *
 * The server owns the session; the browser only holds two cookies — an HttpOnly
 * token the page cannot read and a readable CSRF token it must attach to every
 * state-changing request. This module is the page's end of that deal:
 *
 *   - `partnerFetch` attaches `x-csrf-token` from the readable cookie on every
 *     call, so no page or code path can forget it, and treats a 401 as "the
 *     session is gone" so a page that loses its session mid-edit drops back to
 *     the sign-in gate instead of showing a dead editor.
 *   - `usePartnerSession` tells a page whether it is signed in, and holds the
 *     answer in one place so `/partner`, `/partner/menu` and
 *     `/partner/integrations` agree about it — the old code each read the owner
 *     key out of `localStorage` for itself.
 *   - `establishPartnerSession` is the owner key's one remaining use on this
 *     side: typed once, POSTed once, exchanged for a session. After that the key
 *     is not handled again here, which is the whole point of the change.
 *
 * The owner key is deliberately no longer written to `localStorage`. That store
 * existed to carry the key from signup to the console — a job the session cookie
 * now does better, since it lives server-side and can be revoked. Holding the key
 * on disk for "recovery" also recreated the exposure this phase removes: it was a
 * full-control credential sitting in web storage for any injected script to read.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, RefreshCw, Store } from "lucide-react";
import { cn } from "@/lib/domain";
import { RESTAURANT_CSRF_COOKIE, RESTAURANT_CSRF_HEADER } from "@/lib/restaurant-session-core";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

export type PartnerSessionState =
  | { status: "loading" }
  | { status: "signed-in"; restaurant: RestaurantDto }
  | { status: "signed-out" };

export type PartnerReply<T> =
  | ({ ok: true; error?: undefined } & T & { status?: number })
  | { ok: false; error: string; status?: number };

const loading: PartnerSessionState = { status: "loading" };
const signedOut: PartnerSessionState = { status: "signed-out" };

let cached: PartnerSessionState | null = null;
const listeners = new Set<() => void>();

function snapshot(): PartnerSessionState {
  return cached ?? loading;
}

function setState(next: PartnerSessionState): void {
  cached = next;
  for (const l of listeners) l();
}

function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${RESTAURANT_CSRF_COOKIE}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return "";
}

/**
 * Fetch a partner route with the session's CSRF token attached.
 *
 * State-changing partner routes demand `x-csrf-token`; a page that forgets to
 * send it gets a 403 that looks like a bug. Sending it on reads too is harmless
 * (the read routes ignore it), so this helper just always sends it and removes
 * the possibility of a wrong header on any single call site.
 */
export async function partnerFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<PartnerReply<T>> {
  const headers = new Headers(init.headers);
  headers.set(RESTAURANT_CSRF_HEADER, readCsrfToken());
  if (!headers.has("Content-Type") && init.body != null) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
    if (res.status === 401) setState(signedOut);
    const data = (await res.json().catch(() => null)) as (PartnerReply<T> & { error?: unknown }) | null;
    if (data && typeof data === "object" && data.ok === true) {
      return { ...data, ok: true as const, status: res.status } as PartnerReply<T>;
    }
    const error = data && typeof data.error === "string" ? data.error : "Something went wrong";
    return { ok: false, error, status: res.status };
  } catch {
    return { ok: false, error: "Network error", status: 0 };
  }
}

/** Ask the server who this browser is, once.
 * Shares the answer across every subscriber so reopening a tab does not re-ping. */
export async function refreshPartnerSession(): Promise<PartnerSessionState> {
  try {
    const res = await fetch("/api/partner/session", { credentials: "same-origin" });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      restaurant?: RestaurantDto;
    } | null;
    if (res.ok && data?.ok && data.restaurant) {
      setState({ status: "signed-in", restaurant: data.restaurant });
    } else {
      setState(signedOut);
    }
  } catch {
    setState(signedOut);
  }
  return snapshot();
}

/** Exchange an owner key for a session. This is the key's last step on this side. */
export async function establishPartnerSession(
  ownerKey: string,
): Promise<PartnerReply<{ restaurant: RestaurantDto }>> {
  const result = await partnerFetch<{ restaurant: RestaurantDto }>("/api/partner/session", {
    method: "POST",
    body: JSON.stringify({ ownerKey }),
  });
  // A subsequent request may already have knocked us to signed-out (401), but a
  // successful exchange always puts a live session back.
  if (result.ok) setState({ status: "signed-in", restaurant: result.restaurant });
  return result;
}

/** Sign this device out: revoke the server row AND clear the local cookies. */
export async function revokePartnerSession(): Promise<void> {
  await partnerFetch("/api/partner/session", { method: "DELETE" });
  setState(signedOut);
}

/** The current session, kept in sync across every mounting page. */
export function usePartnerSession(): PartnerSessionState {
  const [state, setStateHere] = useState<PartnerSessionState>(() => snapshot());
  useEffect(() => {
    const listener = () => setStateHere(snapshot());
    listeners.add(listener);
    if (cached === null) void refreshPartnerSession();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/**
 * The screen a signed-out partner sees on a console page.
 *
 * One owner-key input, POSTed to `/api/partner/session`. Replaces the old
 * behaviour of pasting the key into a per-page panel and having it re-sent on
 * every request; the exchange happens here exactly once.
 */
export function SignInGate({ title, subtitle }: { title: string; subtitle: string }) {
  const { toast } = useToast();
  const [ownerKey, setOwnerKey] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const key = ownerKey.trim();
    if (!key) return;
    setBusy(true);
    const d = await establishPartnerSession(key);
    setBusy(false);
    if (!d.ok) {
      toast(d.error, { kind: "error" });
      return;
    }
    setOwnerKey("");
    toast("Signed in", { sub: d.restaurant.name });
  };

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none";

  return (
    <section className="glass mt-6 rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
        <KeyRound className="size-4.5 text-ember-400" /> {title}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">{subtitle}</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value)}
          placeholder="Paste your owner key"
          className={cn(inputCls, "flex-1 font-mono font-bold")}
        />
        <button
          type="submit"
          disabled={busy || !ownerKey.trim()}
          className="press flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow transition-opacity disabled:opacity-60"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Store className="size-4" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-2.5 text-[11px] leading-relaxed text-cream-600">
        The owner key you received when connecting. This does not expose the key again — it
        exchanges it for a session once, and everything after that uses the session.
      </p>
    </section>
  );
}

/** Renders children only while a session is live, the gate otherwise. */
export function RequirePartnerSession({
  children,
  title = "Sign in to continue",
  subtitle = "This console is locked behind the owner key you received when connecting.",
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const session = usePartnerSession();
  if (session.status === "loading") {
    return (
      <p className="mt-6 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-xs text-cream-500">
        <RefreshCw className="size-3.5 animate-spin" /> Checking your session…
      </p>
    );
  }
  if (session.status === "signed-out") {
    return <SignInGate title={title} subtitle={subtitle} />;
  }
  return <>{children}</>;
}