"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CustomerAccount {
  id: number;
  phoneE164: string;
  name: string;
  avatar: "" | "male" | "female";
}

export type CustomerAccountStatus = "loading" | "signedOut" | "signedIn";

export type CustomerAuthIntent = "signin" | "signup";

interface AuthStartResult {
  ok: boolean;
  expiresAt?: string;
  devCode?: string;
  error?: string;
  code?: string;
}

interface AuthVerifyResult {
  ok: boolean;
  account?: CustomerAccount;
  expiresAt?: string;
  error?: string;
  code?: string;
}

interface CustomerAccountContextValue {
  status: CustomerAccountStatus;
  account: CustomerAccount | null;
  /** Re-read session from server (e.g. after external changes). */
  refresh: () => Promise<void>;
  /** Start OTP auth. Returns devCode in non-production when available. */
  startAuth: (phone: string, intent?: CustomerAuthIntent) => Promise<AuthStartResult>;
  /** Verify OTP and establish session. */
  verifyAuth: (input: { phone: string; code: string; name?: string; intent?: CustomerAuthIntent }) => Promise<AuthVerifyResult>;
  /** Optional Google Sign-In; the phone + OTP flow remains unchanged. */
  signInWithGoogle: (opts?: { returnTo?: string; mode?: "popup" | "redirect" }) => Promise<{ ok: boolean; error?: string }>;
  logout: (opts?: { all?: boolean }) => Promise<boolean>;
  /** JSON fetch with cookies; adds CSRF header for mutating account requests. */
  accountFetch: (path: string, init?: RequestInit & { mutating?: boolean }) => Promise<Response>;
}

const Ctx = createContext<CustomerAccountContextValue | null>(null);

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=") ?? "");
  }
  return "";
}

function readCsrfToken(): string {
  return readCookie("crave_customer_account_csrf");
}

const GOOGLE_NONCE_KEY = "crave.google.oauth.nonce";

/** Client-only nonce used to correlate the OAuth popup message with this tab. */
function createGoogleNonce(): string {
  const bytes = new Uint8Array(18);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readStoredGoogleNonce(fallback: string): string {
  try {
    return window.sessionStorage.getItem(GOOGLE_NONCE_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

export function CustomerAccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CustomerAccountStatus>("loading");
  const [account, setAccount] = useState<CustomerAccount | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/customer/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setAccount(null);
        setStatus("signedOut");
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; account?: CustomerAccount }
        | null;
      if (data?.ok && data.account) {
        const av = data.account.avatar === "male" || data.account.avatar === "female" ? data.account.avatar : "";
        setAccount({
          id: Number(data.account.id),
          phoneE164: String(data.account.phoneE164 ?? ""),
          name: String(data.account.name ?? ""),
          avatar: av,
        });
        setStatus("signedIn");
      } else {
        setAccount(null);
        setStatus("signedOut");
      }
    } catch {
      setAccount(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const signInWithGoogle = useCallback(
    async (opts?: { returnTo?: string; mode?: "popup" | "redirect" }): Promise<{ ok: boolean; error?: string }> => {
      if (typeof window === "undefined") {
        return { ok: false, error: "Google sign-in is only available in the browser." };
      }

      const mode = opts?.mode ?? "popup";
      const requestedReturnTo = opts?.returnTo;
      // Only allow internal paths to be carried through the OAuth round trip.
      const returnTo =
        requestedReturnTo && requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
          ? requestedReturnTo
          : window.location.pathname + window.location.search || "/";
      const nonce = createGoogleNonce();

      try {
        window.sessionStorage.setItem(GOOGLE_NONCE_KEY, nonce);
      } catch {
        // Storage may be unavailable; the in-memory nonce is still used below.
      }

      // Normal popups use mode=popup so the callback posts a message to the
      // opener. Explicit redirects and blocked popups use mode=redirect so the
      // callback sends the browser back to returnTo instead.
      const startUrl = (startMode: "popup" | "redirect") => {
        const params = new URLSearchParams({ mode: startMode, nonce, returnTo });
        return `/api/customer/auth/google/start?${params.toString()}`;
      };

      if (mode === "redirect") {
        // Full page load is required so the OAuth callback can set cookies.
        window.location.assign(startUrl("redirect"));
        return { ok: true };
      }

      return new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let settled = false;
        let messageReceived = false;
        let popup: Window | null = null;
        let interval: number | null = null;

        const cleanup = () => {
          window.removeEventListener("message", onMessage);
          if (interval !== null) {
            window.clearInterval(interval);
            interval = null;
          }
          try {
            window.sessionStorage.removeItem(GOOGLE_NONCE_KEY);
          } catch {
            // ignore storage failures
          }
        };

        const settle = (result: { ok: boolean; error?: string }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };

        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data as
            | { type?: string; nonce?: string; ok?: boolean; error?: string }
            | null;
          if (!data || data.type !== "customer-google-auth") return;
          if (data.nonce !== readStoredGoogleNonce(nonce)) return;

          // The callback closes its window right after posting. Stop treating
          // that as a cancellation while we finish refreshing the session.
          messageReceived = true;

          if (data.ok) {
            void (async () => {
              try {
                await refresh();
              } catch {
                // refresh() already falls back to signedOut; success stands.
              } finally {
                settle({ ok: true });
              }
            })();
            return;
          }

          settle({ ok: false, error: data.error ?? "Google sign-in failed." });
        };

        window.addEventListener("message", onMessage);

        const width = 480;
        const height = 640;
        const left = Math.max(0, Math.round((window.screen.width - width) / 2));
        const top = Math.max(0, Math.round((window.screen.height - height) / 2));
        popup = window.open(
          startUrl("popup"),
          "crave-google-auth",
          `noopener=false,width=${width},height=${height},left=${left},top=${top}`,
        );

        if (!popup) {
          // Popup blocked: switch to a redirect so the callback navigates back
          // to returnTo instead of rendering a popup-only completion page.
          // Navigating away clears this listener/interval.
          window.location.assign(startUrl("redirect"));
          return;
        }

        interval = window.setInterval(() => {
          if (!messageReceived && popup?.closed) {
            settle({ ok: false, error: "Google sign-in was cancelled." });
          }
        }, 500);
      });
    },
    [refresh],
  );

  const startAuth = useCallback(async (phone: string, intent?: CustomerAuthIntent): Promise<AuthStartResult> => {
    try {
      const res = await fetch("/api/customer/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone, intent }),
      });
      const data = (await res.json().catch(() => null)) as AuthStartResult | null;
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error ?? "Unable to start sign-in", code: data?.code };
      }
      return { ok: true, expiresAt: data.expiresAt, devCode: data.devCode };
    } catch {
      return { ok: false, error: "Unable to start sign-in" };
    }
  }, []);

  const verifyAuth = useCallback(
    async (input: { phone: string; code: string; name?: string; intent?: CustomerAuthIntent }): Promise<AuthVerifyResult> => {
      try {
        const res = await fetch("/api/customer/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            phone: input.phone,
            code: input.code,
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.intent ? { intent: input.intent } : {}),
          }),
        });
        const data = (await res.json().catch(() => null)) as AuthVerifyResult | null;
        if (!res.ok || !data?.ok || !data.account) {
          return { ok: false, error: data?.error ?? "Unable to verify code", code: data?.code };
        }
        const av = data.account.avatar === "male" || data.account.avatar === "female" ? data.account.avatar : "";
        const nextAccount = {
          id: Number(data.account.id),
          phoneE164: String(data.account.phoneE164 ?? ""),
          name: String(data.account.name ?? ""),
          avatar: av,
        } as CustomerAccount;
        setAccount(nextAccount);
        setStatus("signedIn");
        return { ok: true, account: nextAccount, expiresAt: data.expiresAt };
      } catch {
        return { ok: false, error: "Unable to verify code" };
      }
    },
    [],
  );

  const accountFetch = useCallback(
    async (path: string, init?: RequestInit & { mutating?: boolean }): Promise<Response> => {
      const headers = new Headers(init?.headers ?? undefined);
      if (init?.mutating) {
        const csrf = readCsrfToken();
        if (csrf) headers.set("x-csrf-token", csrf);
      }
      return fetch(path, {
        ...init,
        headers,
        credentials: init?.credentials ?? "same-origin",
      });
    },
    [],
  );

  const logout = useCallback(
    async (opts?: { all?: boolean }): Promise<boolean> => {
      try {
        const res = await accountFetch(`/api/customer/logout${opts?.all ? "?all=1" : ""}`, {
          method: "POST",
          mutating: true,
        });
        // Always drop local signed-in state; cookies are cleared server-side on success.
        if (res.ok) {
          setAccount(null);
          setStatus("signedOut");
          return true;
        }
        // If session was already gone, treat as signed out.
        if (res.status === 401 || res.status === 403) {
          setAccount(null);
          setStatus("signedOut");
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [accountFetch],
  );

  const value = useMemo<CustomerAccountContextValue>(
    () => ({ status, account, refresh, startAuth, verifyAuth, signInWithGoogle, logout, accountFetch }),
    [status, account, refresh, startAuth, verifyAuth, signInWithGoogle, logout, accountFetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomerAccount(): CustomerAccountContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCustomerAccount must be used within CustomerAccountProvider");
  return v;
}

/** Safe variant for components that may render outside the provider (should not happen). */
export function useCustomerAccountOptional(): CustomerAccountContextValue | null {
  return useContext(Ctx);
}
