/**
 * The owner key is shown exactly once and cannot be recovered, so we keep it in
 * `sessionStorage` for the length of the browser tab. That makes moving between
 * /partner and /partner/menu painless without ever persisting the key to disk
 * or putting it in a URL.
 */
const STORAGE_KEY = "crave.ownerKey";

export function readStoredOwnerKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Private mode / blocked storage: the key just has to be pasted again.
    return "";
  }
}

export function storeOwnerKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const value = key.trim();
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal: the in-memory copy in the page still works.
  }
}
