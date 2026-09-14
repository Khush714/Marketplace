"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HeartIcon } from "./ui/icons";

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
      className={`card-lift grid h-11 w-11 place-items-center rounded-full border backdrop-blur-md transition-colors disabled:opacity-60 ${
        saved
          ? "border-rose-500/30 bg-rose-500/20 text-rose-400"
          : "border-white/10 bg-ink-950/60 text-white/70 hover:text-rose-400"
      }`}
      aria-label={saved ? "Remove from saved" : "Save restaurant"}
      title={saved ? "Saved" : "Save for later"}
    >
      <HeartIcon
        className={saved ? "text-lg" : "text-lg"}
        style={saved ? { fill: "currentColor" } : undefined}
      />
    </button>
  );
}