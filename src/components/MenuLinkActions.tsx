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
    <div className="flex flex-wrap gap-2">
      <a
        href={url}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-600"
      >
        OPEN MENU
      </a>

      <button
        type="button"
        onClick={copy}
        className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        {copied ? "COPIED" : "COPY MENU LINK"}
      </button>
    </div>
  );
}
