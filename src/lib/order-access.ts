"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import { useProfile } from "@/lib/profile";

/**
 * Customer-side access to a single order.
 *
 * An order code on its own is not a credential: every read needs the signed
 * token minted at checkout (see lib/order-token), which lives in this browser's
 * profile. That is also why these pages are client components — the token is in
 * localStorage, not in the request, and the server must not be asked for an
 * order it cannot authenticate.
 */

export async function fetchPublicOrder(code: string, token: string): Promise<PublicOrder | null> {
  const res = await fetch(`/api/orders/${encodeURIComponent(code)}`, {
    headers: { "x-order-token": token },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { order?: PublicOrder } | null;
  return data?.order ?? null;
}

export type OrderAccess = "loading" | "ready" | "denied";

function deriveAccess(input: {
  hydrated: boolean;
  token: string | null;
  resultCode: string | null;
  order: PublicOrder | null;
  code: string;
}): OrderAccess {
  if (!input.hydrated) return "loading";
  if (!input.token) return "denied";
  if (input.resultCode !== input.code) return "loading";
  return input.order ? "ready" : "denied";
}

export function usePublicOrder(code: string) {
  const { orders, hydrated } = useProfile();
  const [result, setResult] = useState<{ code: string; order: PublicOrder | null } | null>(null);

  const token = orders.find((o) => o.code === code)?.token ?? null;

  useEffect(() => {
    if (!hydrated || !token) return;
    let cancelled = false;
    fetchPublicOrder(code, token)
      .then((found) => {
        if (!cancelled) setResult({ code, order: found });
      })
      .catch(() => {
        if (!cancelled) setResult({ code, order: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code, hydrated, token]);

  // Access is derived, not stored: "no token in this browser" and "still
  // fetching" are both knowable during render, so they need no setState and
  // cannot cascade an extra pass.
  const order = result && result.code === code ? result.order : null;
  const access = deriveAccess({ hydrated, token, resultCode: result?.code ?? null, order, code });

  /** Re-read the order (used by the tracking poller). */
  const refresh = useCallback(async () => {
    if (!token) return;
    const found = await fetchPublicOrder(code, token);
    if (found) setResult({ code, order: found });
  }, [code, token]);

  return { order, access, token, refresh };
}
