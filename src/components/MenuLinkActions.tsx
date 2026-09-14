"use client";

import { useState } from "react";

export function MenuLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const isExternal = /^https?:\/\//.test(url);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <a
        href={url}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="rounded-2xl bg-ember-500 px-5 py-2.5 text-center text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
      >
        OPEN MENU
      </a>

      <button
        type="button"
        onClick={copy}
        className="rounded-2xl border border-white/10 bg-white/5 px-5 py-2.5 text-center text-sm font-semibold text-white/70 hover:bg-white/10"
      >
        {copied ? "COPIED" : "COPY MENU LINK"}
      </button>
    </div>
  );
}
