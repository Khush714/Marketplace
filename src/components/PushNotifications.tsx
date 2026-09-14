"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PHASE 24 — Web Push opt-in banner.
 *
 * When a signed-in customer has not decided on browser notification
 * permission, show a dismissible prompt. On enable: subscribe to the VAPID
 * endpoint and register the PushSubscription server-side so the outbox worker
 * can deliver order updates as push notifications.
 *
 * If permission is already granted, silently keep the server subscription in
 * sync (re-subscribes are idempotent via endpoint upsert).
 */
export function PushNotifications() {
  const [showBanner, setShowBanner] = useState(false);
  const [state, setState] = useState<"idle" | "enabling">("idle");
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const syncDone = useRef(false);

  const check = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (typeof Notification === "undefined") return;

    let key: string | null = null;
    try {
      const res = await fetch("/api/push/vapid");
      if (res.ok) key = (await res.json()).publicKey ?? null;
    } catch {
      /* offline — try again next time */
    }

    // Only signed-in customers can receive push.
    let authenticated = false;
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) authenticated = (await res.json()).authenticated === true;
    } catch {
      /* offline */
    }
    if (!authenticated) return;

    let registration: ServiceWorkerRegistration | undefined;
    try {
      registration = await navigator.serviceWorker.getRegistration("/");
    } catch {
      return;
    }
    if (!registration) return;

    if (Notification.permission === "granted") {
      if (syncDone.current) return;
      syncDone.current = true;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        if (!key) return;
        try {
          const fresh = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(key),
          });
          await registerWithServer(fresh);
          setEnabled(true);
        } catch {
          /* stale key or blocked */
        }
        return;
      }
      try {
        await registerWithServer(sub);
        setEnabled(true);
      } catch {
        /* non-fatal — retry next focus */
      }
      return;
    }

    // Ask only once per session and only when we could actually subscribe.
    if (Notification.permission === "default" && key) {
      setShowBanner(true);
    }
  }, []);

  useEffect(() => {
    // Defer past the render commit so the permission check (which may set
    // banner state) never runs synchronously inside the effect.
    const t = window.setTimeout(check, 0);
    const onWake = () => check();
    window.addEventListener("focus", onWake);
    window.addEventListener("tablz:auth", onWake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("tablz:auth", onWake);
    };
  }, [check]);

  const enable = useCallback(async () => {
    setError(null);
    setState("enabling");
    try {
      if (typeof Notification === "undefined") throw new Error("Unsupported browser");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError("Permission was not granted.");
        setState("idle");
        return;
      }
      const res = await fetch("/api/push/vapid");
      const key = res.ok ? (await res.json()).publicKey : null;
      if (!key) throw new Error("Web Push is not configured yet.");
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(key),
      });
      await registerWithServer(sub);
      setEnabled(true);
      setShowBanner(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setState("idle");
    }
  }, []);

  const dismiss = useCallback(() => setShowBanner(false), []);

  if (enabled) return null;
  if (!showBanner) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 px-4 md:bottom-6 md:px-6">
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-lg backdrop-blur">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ember-500/15 text-xl">
          🔔
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">
            Get order updates instantly
          </p>
          <p className="mt-0.5 text-xs text-white/45">
            Allow notifications so you never miss when your food is ready.
          </p>
          {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={enable}
              disabled={state === "enabling"}
              className="w-full rounded-2xl bg-ember-500 px-4 py-1.5 text-xs font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60 sm:w-auto"
            >
              {state === "enabling" ? "Enabling…" : "Enable notifications"}
            </button>
            <button
              onClick={dismiss}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 sm:w-auto"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function registerWithServer(sub: PushSubscription): Promise<void> {
  const payload = {
    endpoint: sub.endpoint,
    keys: sub.toJSON() as { p256dh: string; auth: string },
    label: deviceLabel(),
  };
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("tablz:auth"));
    throw new Error("Sign in required to enable notifications.");
  }
  if (!res.ok) throw new Error("Failed to save subscription.");
}

function deviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "browser";
}

/** VAPID keys (base64url) must be converted to a Uint8Array for subscribe(). */
function urlB64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
