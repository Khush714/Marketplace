/**
 * Client-side store for the restaurant owner key.
 *
 * ## Why this is NOT sessionStorage any more
 *
 * The key was originally kept in `sessionStorage` "for the length of the browser
 * tab". That is correct as far as it goes — the key is a bearer secret shown
 * exactly once and not recoverable — but it made an ordinary user action
 * destructive: closing the tab destroyed /partner, /partner/menu AND
 * /partner/integrations, and because there is no self-service recovery path
 * (see the rotate route), that turned one accidental tab close into an
 * operator ticket.
 *
 * The XSS argument against web storage does not actually distinguish the two:
 * `sessionStorage` is readable by any script injected into the page for the
 * life of the tab, so the marginal exposure added by `localStorage` is only
 * "after this tab is closed", which is exactly the durability being bought.
 *
 * So: `localStorage`, with an explicit "forget this device" control and a
 * visible warning on the partner pages. A restaurant is a long-lived business
 * account on a shared or managed device far more often than a customer is, and
 * losing the console to a stray tab close was the worse failure.
 */
const STORAGE_KEY = "crave.ownerKey";

function safeLocal(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Private mode / blocked storage: the page keeps an in-memory copy instead.
    return null;
  }
}

export function readStoredOwnerKey(): string {
  const store = safeLocal();
  if (!store) return "";
  try {
    // Migrate a key left behind by the sessionStorage era so an in-flight
    // upgrade does not lock a restaurant out of its own console.
    const current = store.getItem(STORAGE_KEY);
    if (current) return current;
    let legacy = "";
    try {
      legacy = window.sessionStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      legacy = "";
    }
    if (legacy) store.setItem(STORAGE_KEY, legacy);
    return legacy;
  } catch {
    return "";
  }
}

export function storeOwnerKey(key: string): void {
  const store = safeLocal();
  if (!store) return;
  try {
    const value = key.trim();
    if (value) store.setItem(STORAGE_KEY, value);
    else store.removeItem(STORAGE_KEY);
    // Keep the tab-scoped copy in sync so nothing reads a stale key after a
    // rotation, and clear it on sign-out so it cannot be resurrected.
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal: localStorage is the durable copy.
    }
  } catch {
    // Non-fatal: the in-memory copy in the page still works.
  }
}

/** Drop the key from this device — used by "forget this device" / sign out. */
export function forgetOwnerKey(): void {
  storeOwnerKey("");
}