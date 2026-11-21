/**
 * Client-safe constants for the restaurant/partner session.
 * Kept separate from `restaurant-session-core.ts` so client bundles can read
 * cookie/header names without pulling in Node-only crypto dependencies.
 */

/** Cookie carrying the session token. HttpOnly, so script cannot read it. */
export const RESTAURANT_SESSION_COOKIE = "crave_restaurant_session";

/**
 * Cookie carrying the paired CSRF token. Deliberately NOT HttpOnly so client
 * code can read and attach it as a request header.
 */
export const RESTAURANT_CSRF_COOKIE = "crave_restaurant_csrf";

/** Header carrying the paired CSRF token on state-changing partner requests. */
export const RESTAURANT_CSRF_HEADER = "x-csrf-token";
