"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/domain";

type ToastKind = "success" | "info" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  sub?: string;
}

interface ToastContextValue {
  toast: (title: string, opts?: { sub?: string; kind?: ToastKind }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-mint-400" />,
  info: <Info className="size-4 text-ember-400" />,
  error: <TriangleAlert className="size-4 text-chili-400" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (title: string, opts?: { sub?: string; kind?: ToastKind }) => {
      const id = idRef.current++;
      setToasts((t) => [...t.slice(-2), { id, title, sub: opts?.sub, kind: opts?.kind ?? "success" }]);
      window.setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 md:bottom-8"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "glass-strong pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3",
              "animate-pop-in",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/8">
              {ICONS[t.kind]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-cream-50">{t.title}</p>
              {t.sub && <p className="truncate text-xs text-cream-400">{t.sub}</p>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
