export function UpiMark({ className = "h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 24" className={className} fill="none" aria-hidden>
      <path d="M2 2h5v11a5 5 0 0 0 10 0V2h5v11a10 10 0 0 1-20 0V2Z" fill="currentColor" />
      <path
        d="M26 2h9a7 7 0 0 1 0 14h-4v6h-5V2Zm5 4.5V11.5h3.4a2.5 2.5 0 0 0 0-5H31Z"
        fill="currentColor"
      />
      <path d="M46 2h5v20h-5V2Z" fill="currentColor" />
      <path d="M55 2 62 11.9 55 22V2Z" fill="currentColor" opacity="0.65" />
    </svg>
  );
}

export function LockMark({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" aria-hidden>
      <rect x="4" y="10" width="16" height="10" rx="2.5" strokeWidth="1.6" />
      <path d="M8 10V7.5a4 4 0 1 1 8 0V10" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

/** Abstract payment-app marks — geometric, on-brand-adjacent, not literal logos. */
export function AppMark({ id, className = "h-5 w-5" }: { id: string; className?: string }) {
  if (id === "gpay") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path
          d="M12 10.2v3.7h5.2a4.6 4.6 0 0 1-4.9 3.6 5.5 5.5 0 1 1 3.6-9.7l2.7-2.6A9.3 9.3 0 1 0 12 21.3c5.4 0 9-3.8 9-9.1 0-.7-.1-1.4-.2-2H12Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (id === "phonepe") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="currentColor" opacity="0.22" />
        <path
          d="M15.8 8.4h-2.1V7.2c0-.9-.6-1.5-1.5-1.5h-.9v1.4h.7c.3 0 .4.1.4.4v.9H8.2c-.5 0-.9.4-.9.9v4.8c0 1.9 1 3 2.7 3 .6 0 1.1-.1 1.7-.4v.9c0 .3.2.5.5.5h1.2c.3 0 .5-.2.5-.5v-6.6h1.9V8.4Zm-4.1 6.3c-.3.2-.7.3-1.1.3-.8 0-1.2-.4-1.2-1.3V9.9h2.3v4.8Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (id === "paytm") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" opacity="0.2" />
        <path
          d="M6.4 8.6h2.2c1.3 0 2.1.8 2.1 2s-.8 2-2.1 2h-.9v2.8H6.4V8.6Zm1.3 2.9h.8c.5 0 .8-.3.8-.8s-.3-.9-.8-.9h-.8v1.7ZM12 8.6h1.3v6.8H12V8.6Zm2.6 0h1.3l1 3.4 1-3.4h1.3l-1.8 5.4c-.3.9-.8 1.4-1.7 1.4h-.7v-1.2h.5c.4 0 .6-.2.7-.5l.1-.3-1.7-4.8Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="8.6" strokeWidth="1.4" opacity="0.6" />
      <circle cx="12" cy="12" r="3.2" strokeWidth="1.4" />
      <path d="M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2" strokeWidth="1.4" />
    </svg>
  );
}
