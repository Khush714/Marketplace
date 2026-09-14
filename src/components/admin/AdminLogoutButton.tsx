"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.push("/admin/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      className="rounded-full bg-ink-800 px-3 py-1.5 font-semibold text-white transition hover:bg-ink-700 disabled:opacity-60"
    >
      {busy ? "…" : "Log out"}
    </button>
  );
}
