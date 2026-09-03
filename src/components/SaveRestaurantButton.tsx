"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SaveRestaurantButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((m) => {
        setAuthed(m.authenticated);
        if (!m.authenticated) return;
        fetch("/api/me/saved")
          .then((r) => r.json())
          .then((d) => {
            const list: { slug: string }[] = d.saved ?? [];
            setSaved(list.some((r) => r.slug === slug));
          });
      })
      .catch(() => setAuthed(false));
  }, [slug]);

  if (authed === null) return null;

  async function toggle() {
    if (!authed) {
      router.push(`/login?return=/restaurants/${slug}`);
      return;
    }
    setBusy(true);
    if (saved) {
      await fetch(`/api/me/saved?slug=${slug}`, { method: "DELETE" });
    } else {
      await fetch("/api/me/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
    }
    setSaved((v) => !v);
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`grid h-9 w-9 place-items-center rounded-full text-lg shadow backdrop-blur transition disabled:opacity-60 ${
        saved
          ? "bg-rose-500 text-white hover:bg-rose-600"
          : "bg-white/90 text-slate-500 hover:text-rose-500"
      }`}
      aria-label={saved ? "Remove from saved" : "Save restaurant"}
      title={saved ? "Saved" : "Save for later"}
    >
      {saved ? "♥" : "♡"}
    </button>
  );
}
