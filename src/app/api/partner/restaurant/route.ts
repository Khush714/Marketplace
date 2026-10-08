import { NextRequest } from "next/server";
import { readJsonBody } from "@/lib/abuse";
import { emitSecurityEvent } from "@/lib/security/security-events";
import {
  clearSessionCookies,
  cookieShouldBeSecure,
  guardRestaurantDeletion,
  requirePartnerSession,
} from "@/lib/security/restaurant-session";
import {
  consumeDeleteConfirmation,
  deleteRestaurantById,
  getRestaurantManageById,
  setRestaurantActiveById,
  updateRestaurantProfileById,
} from "@/db/queries";

export const dynamic = "force-dynamic";

/**
 * The partner's own listing, addressed by session.
 *
 * Note what is gone: no `ownerKey`, in the query string, the header or the body.
 * The restaurant is resolved from the `crave_restaurant_session` cookie and from
 * nothing else, which is what stops a credential leaking into an access log, a
 * proxy log or browser history. A caller cannot name a restaurant, so it cannot
 * reach one it does not own.
 *
 * ## What replaced the owner key's implicit CSRF protection
 *
 * These routes used to require an `x-owner-key` header, which meant a cross-origin
 * page could not make the browser replay the credential: a custom header forces a
 * CORS preflight, and a form on another origin cannot pass one. Cookies are
 * attached by the browser on their own, so moving here removes that protection
 * entirely. It is rebuilt explicitly and in two independent layers —
 *
 *   - `requirePartnerSession({ mutating: true })` checks `Sec-Fetch-Site`/`Origin`
 *     and requires a CSRF token bound to the session, on every write;
 *   - the cookie is `SameSite=Lax`, so a cross-site POST does not carry it at all.
 *
 * The second is a single browser heuristic and the first is a header an attacker
 * cannot forge into a request the browser makes on their behalf; together they are
 * why a hostile page cannot pause, re-profile or delete a listing.
 */

/** Load the listing this session controls. */
export async function GET(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;

  const restaurant = await getRestaurantManageById(auth.session.restaurantId);
  // Reachable if the listing was removed out from under a live session. A 404 is
  // the same answer an unauthenticated caller gets, so this cannot be used to probe
  // which listings exist.
  if (!restaurant) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true, restaurant });
}

/**
 * Two owner-scoped listing mutations, distinguished by the body:
 *   { active }                       -> pause / resume
 *   { profile: {...} }               -> edit name, tagline, cuisines,
 *                                       locality, imagery, pure-veg
 *
 * `restaurant_id` is never read from the request — the session supplies it — so a
 * caller cannot edit a listing it does not own. The profile edit exists because
 * onboarding is otherwise write-once: with only pause/resume available, a mistyped
 * name or an off-list cuisine tag could only be fixed by deleting the listing and
 * redeeming a new code.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  let body: {
    active?: unknown;
    profile?: {
      name?: unknown;
      tagline?: unknown;
      cuisines?: unknown;
      locality?: unknown;
      imageUrl?: unknown;
      heroUrl?: unknown;
      pureVeg?: unknown;
    };
  };
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    body = (parsed.body ?? {}) as typeof body;
  }

  if (body.profile && typeof body.profile === "object") {
    const p = body.profile;
    const result = await updateRestaurantProfileById(auth.session.restaurantId, {
      name: String(p.name ?? ""),
      tagline: String(p.tagline ?? ""),
      cuisines: p.cuisines as string[],
      locality: String(p.locality ?? ""),
      imageUrl: p.imageUrl == null ? undefined : String(p.imageUrl),
      heroUrl: p.heroUrl == null ? undefined : String(p.heroUrl),
      pureVeg: Boolean(p.pureVeg),
    });
    // "Restaurant not found" means the session outlived its listing, which is a 404
    // for the same reason an unauthenticated caller must not be able to probe.
    if (!result.ok) {
      const status = result.error === "Restaurant not found" ? 404 : 400;
      return Response.json(result, { status });
    }
    return Response.json(result);
  }

  const result = await setRestaurantActiveById(auth.session.restaurantId, Boolean(body?.active));
  if (!result.ok) {
    return Response.json(result, { status: result.error === "Restaurant not found" ? 404 : 400 });
  }
  return Response.json(result);
}

/**
 * Permanently delete the listing, its menu, its connection, its integration
 * sessions and its order history.
 *
 * ## Why this route has four gates and used to have one
 *
 * The old version took an owner key and a typed name. That is a strong guard
 * against an accident and a weak one against an attacker, because the name is not
 * a secret: it is the public listing name, present in the page title, in search
 * results and in the restaurant's own URL. So anyone who had the key — a leaked
 * screenshot, a stale localStorage entry, a shared till — only had to read the name
 * off the website to destroy the listing, the menu and the order history. The
 * typed name was doing no security work at all.
 *
 * Four independent things must now line up, and each covers a failure the others
 * do not:
 *
 *   1. **A live restaurant session** (`requirePartnerSession`). Bounded lifetime,
 *      revocable, and it is the only identity the tenant comes from.
 *   2. **CSRF**, on two levels — the cross-site refusal and a token bound to this
 *      session. A hostile page cannot obtain either, so it cannot delete
 *      anything even while a legitimate partner is signed in.
 *   3. **A rate limit** of three attempts an hour, keyed on the session rather
 *      than the address. This is what stops a brute force over the last unknown,
 *      and keying on the session is what stops a botnet from spreading attempts
 *      across addresses.
 *   4. **A server-issued single-use confirmation token**, from
 *      `POST /api/partner/restaurant/delete-intent`. Unguessable, bound to this
 *      one session, valid for ten minutes, and spent on the first attempt whether
 *      or not that attempt succeeds.
 *
 * ## Why the confirmation is spent before the name is checked
 *
 * The token is cleared first, then the name is compared. If the order were
 * reversed, a caller holding a valid token could keep submitting names until one
 * matched — the typed name would become an oracle, and the whole point of adding
 * the token is that a single stolen token buys exactly one attempt. Spending it
 * unconditionally means the answer to "was that the right name?" is only ever
 * returned once per token.
 *
 * The typed name is kept anyway, because it is genuinely good at what it was
 * always good at: making a person read what they are about to destroy. It is a
 * mistake-prevention control that also happens to be one more thing an attacker has
 * to get right exactly once.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const throttled = guardRestaurantDeletion(auth.session);
  if (throttled) return throttled;

  let confirmName: string;
  let deleteToken: string;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = (parsed.body ?? {}) as { confirmName?: unknown; deleteToken?: unknown };
    confirmName = String(body?.confirmName ?? "");
    deleteToken = String(body?.deleteToken ?? "").trim();
  }

  // Spent first, and on its own line so the ordering above cannot be undone by a
  // later edit. False covers "expired", "already spent" and "never issued"
  // identically: an attacker learns only that this attempt used up whatever
  // confirmation it had.
  const confirmed = await consumeDeleteConfirmation(auth.session.id, deleteToken);
  if (!confirmed) {
    // Phase 12: a refused irreversible attempt is security-relevant on its
    // own — repeated confirmation failures mean someone is spending spent or
    // never-issued tokens against a live session.
    emitSecurityEvent("restaurant_deleted", {
      restaurantId: auth.session.restaurantId,
      outcome: "failure",
      reason: "confirmation_required",
    });
    return Response.json(
      {
        ok: false,
        error: "This deletion confirmation has expired. Review the details and try again.",
        code: "DELETE_CONFIRMATION_REQUIRED",
      },
      { status: 403 },
    );
  }

  const result = await deleteRestaurantById(auth.session.restaurantId, confirmName);
  if (!result.ok) {
    const status = result.error === "Restaurant not found" ? 404 : 400;
    // Reasons are mapped rather than passed through verbatim so the event
    // stream stays enumerable; neither the typed name nor the token appears.
    emitSecurityEvent("restaurant_deleted", {
      restaurantId: auth.session.restaurantId,
      outcome: "failure",
      reason: result.error === "Restaurant not found" ? "not_found" : "confirm_mismatch",
    });
    return Response.json(result, { status });
  }

  // Phase 12: the irreversible one. Emitted only once the rows are actually
  // gone — this line is the audit record that a deletion happened, with the
  // public listing name for human correlation (the name is public; the
  // confirmation token that authorised it is not, and is never logged).
  emitSecurityEvent("restaurant_deleted", {
    restaurantId: auth.session.restaurantId,
    restaurantName: confirmName,
    outcome: "success",
  });

  // The rows are already gone by now (`restaurant_sessions` cascades with the
  // listing), so this cookie is a dead token. Clearing it anyway means the browser
  // does not keep presenting it, and the console's next load sees a clean signed-out
  // state rather than a cookie that fails with a confusing 404.
  const res = Response.json(result);
  clearSessionCookies(res, cookieShouldBeSecure(req));
  return res;
}
