"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  Check,
  ChefHat,
  CreditCard,
  MessageCircle,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";
import { ensureInboxToken } from "@/lib/customer-notification-copy";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/domain";

type NotificationKind =
  | "order_placed"
  | "order_status"
  | "delivery"
  | "payment"
  | "feedback_reply";

type CustomerNotification = {
  id: number;
  orderId: number;
  orderCode: string;
  kind: NotificationKind | string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

type InboxResponse = {
  notifications: CustomerNotification[];
  unreadCount: number;
};

type NotificationsContextValue = InboxResponse & {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  markRead: (ids?: number[]) => Promise<void>;
  busy: boolean;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const POLL_MS = 15_000;

function notificationIcon(kind: string) {
  if (kind === "order_placed") return <ShoppingBag className="size-4 text-ember-300" />;
  if (kind === "order_status") return <ChefHat className="size-4 text-chili-300" />;
  if (kind === "delivery") return <Truck className="size-4 text-mint-400" />;
  if (kind === "payment") return <CreditCard className="size-4 text-ember-300" />;
  return <MessageCircle className="size-4 text-cream-300" />;
}

/**
 * Device-wide in-app inbox. The raw token lives only in this browser; every
 * request sends it in the query/body over HTTPS and the server stores/hashes only
 * its SHA-256. No account, push subscription or contact detail is involved.
 */
export function CustomerNotificationsProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  // Mint the device token during the client's first render, not in an effect:
  // it is browser-only state, and setting it in an effect caused a needless
  // hydration cascade. SSR keeps it null; the client initializer restores it.
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : ensureInboxToken(),
  );
  const [inbox, setInbox] = useState<InboxResponse>({ notifications: [], unreadCount: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const unreadRef = useRef(0);
  const seenRef = useRef(false);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const current = token;
    if (!current) return;
    const requestId = ++requestRef.current;
    try {
      const res = await fetch(`/api/notifications?token=${encodeURIComponent(current)}`, {
        cache: "no-store",
      });
      if (!res.ok || requestId !== requestRef.current) return;
      const data = (await res.json()) as InboxResponse;
      if (requestId !== requestRef.current) return;

      const previous = unreadRef.current;
      unreadRef.current = data.unreadCount;
      setInbox(data);

      // The first successful load is history, not a live event. Later increases
      // get the Zomato-style in-app toast; no web push, SMS or email is used.
      if (seenRef.current && data.unreadCount > previous) {
        const newest = data.notifications.find((n) => !n.readAt);
        if (newest) toast(newest.title, { sub: newest.body, kind: "info" });
      }
      seenRef.current = true;
    } catch {
      /* offline or a transient server error: the next poll retries */
    }
  }, [toast, token]);

  useEffect(() => {
    if (!token) return;
    // Deferred so the first fetch (and its state update) is not a synchronous
    // effect body update; React can settle the shell before the inbox loads.
    const initial = window.setTimeout(() => void refresh(), 0);

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void refresh();
    };
    const interval = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [token, refresh]);

  const open = useCallback(() => {
    setIsOpen(true);
    void refresh();
  }, [refresh]);
  const close = useCallback(() => setIsOpen(false), []);

  const markRead = useCallback(async (ids?: number[]) => {
    const current = token;
    if (!current) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { token: current, ids } : { token: current, all: true }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as InboxResponse;
      unreadRef.current = data.unreadCount;
      setInbox(data);
    } catch {
      /* keep the current inbox; the next poll recovers */
    } finally {
      setBusy(false);
    }
  }, [token]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ ...inbox, isOpen, open, close, markRead, busy }),
    [inbox, isOpen, open, close, markRead, busy],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationPanel />
    </NotificationsContext.Provider>
  );
}

export function useCustomerNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useCustomerNotifications must be used within CustomerNotificationsProvider");
  return ctx;
}

/** Header bell, with an unread badge driven by the token-scoped inbox. */
export function NotificationBell({ labelled = false }: { labelled?: boolean }) {
  const { unreadCount, isOpen, open } = useCustomerNotifications();
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Notifications, ${unreadCount} unread`}
      aria-expanded={isOpen}
      className={cn(
        "press relative grid place-items-center rounded-full glass text-cream-200 transition-colors hover:bg-white/10",
        labelled ? "h-10 gap-1.5 px-4" : "size-10",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Bell className="size-[18px]" />
        {labelled && <span className="text-sm font-semibold text-cream-50">Notifications</span>}
      </span>
      {unreadCount > 0 && (
        <span className="animate-scale-bump absolute -right-1 -top-1 grid min-w-[19px] place-items-center rounded-full bg-gradient-to-br from-ember-400 to-chili-600 px-1 py-0.5 text-[10px] font-bold text-white shadow-glow">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}

/** Modal inbox host. Rendered once by the provider, not per page. */
function NotificationPanel() {
  const { isOpen, close, notifications, unreadCount, markRead, busy } = useCustomerNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center p-0 md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close notifications"
        onClick={close}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-panel-title"
        className="animate-pop-in glass-strong relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl outline-none md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div>
            <h2 id="notification-panel-title" className="text-lg font-bold text-cream-50">Notifications</h2>
            <p className="mt-0.5 text-xs text-cream-400">
              {unreadCount > 0 ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}` : "You're all caught up"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void markRead()}
                className="press flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-cream-200 hover:bg-white/8 disabled:opacity-50"
              >
                <Check className="size-3.5" /> Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="Close notifications"
              className="press grid size-9 place-items-center rounded-full border border-white/10 text-cream-300 hover:bg-white/8"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/6 text-cream-400">
                <Bell className="size-5" />
              </span>
              <strong className="text-base font-bold text-cream-50">No updates yet</strong>
              <p className="max-w-xs text-xs leading-relaxed text-cream-500">
                Order updates, payment confirmations and replies from the kitchen will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/6">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={cn(
                    "flex gap-3 px-5 py-4 transition-colors",
                    !notification.readAt && "bg-white/[0.035]",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6">
                    {notificationIcon(notification.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-cream-50">{notification.title}</p>
                      <time className="shrink-0 text-[10px] text-cream-500" dateTime={notification.createdAt}>
                        {new Date(notification.createdAt).toLocaleString([], {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-cream-300">{notification.body}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cream-500">
                        Order {notification.orderCode}
                      </span>
                      {!notification.readAt && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void markRead([notification.id])}
                          className="press text-[11px] font-semibold text-ember-300 hover:text-ember-200 disabled:opacity-50"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-white/8 px-5 py-3 text-center text-[10px] text-cream-500">
          Private to this browser. No push notifications, email or SMS.
        </p>
      </div>
    </div>
  );
}
