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
    () => ({ status, account, refresh, startAuth, verifyAuth, logout, accountFetch }),
    [status, account, refresh, startAuth, verifyAuth, logout, accountFetch],
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
