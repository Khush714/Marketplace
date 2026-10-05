/**
 * POS Bridge — server-side client for the Restaurant AI POS connection bridge.
 *
 * The POS is the authority for connection codes. These two calls let the
 * Marketplace attest a POS-issued code (verify — non-consuming) and then
 * redeem it exactly once (claim). The POS resolves the tenant from the code
 * row (the trusted record), never from the request body.
 *
 * POS_BASE_URL is required (see .env.example). Only imported by route
 * handlers — never from client components.
 */

export interface PosBranchIdentity {
  id: string;
  name: string;
  city?: string | null;
  status: string;
  is_headquarter?: boolean | null;
}

export interface PosConnectionIdentity {
  provider: string;
  status: string;
  external_restaurant_id: string | null;
  restaurant: { id: number; name: string } | null;
  branch_id: string | null;
  external_outlet_id: string | null;
  branch: PosBranchIdentity | null;
  code_status?: string;
  expires_at?: string | null;
  /**
   * The shared webhook secret the Marketplace stores sealed for inbound
   * menu/order webhook verification. Never echoed back to clients.
   */
  webhook_secret?: string | null;
}

export class PosBridgeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    code: string,
    payload: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "PosBridgeError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/**
 * Hosts that can never be a real POS from a Vercel function. `POS_BASE_URL`
 * defaults to `http://localhost:5000` in .env.example because that is the
 * right value while BOTH services run on one developer machine — and it is a
 * silently dead value the moment the marketplace is deployed: DNS for
 * "localhost" resolves to the function's own container, the connection is
 * refused, and every bridge call 502s. That exact value shipped to production
 * once, as a `trycloudflare.com` quick tunnel whose hostname had already died,
 * and the failure was invisible in the Vercel logs because the fetch error was
 * swallowed (see logPosTransportFailure). A deployed marketplace must refuse
 * these rather than look configured.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function posBaseUrl(): string {
  return (process.env.POS_BASE_URL || "").trim().replace(/\/+$/, "");
}

/**
 * Why the last bridge call failed, for the ops console and the log line.
 * Never throws and never leaks credentials: only the host, and the transport
 * error's own name/message.
 */
export type PosTransportFailure = {
  reason: "not_configured" | "loopback_in_production" | "network" | "timeout" | "bad_status";
  detail: string;
  host: string | null;
  status?: number;
};

/**
 * A bridge call that never reached the POS, or reached it and got a non-JSON /
 * unexpected answer. The three bridge clients used to `catch {}` and rethrow a
 * bare "POS is unreachable", which threw away the only evidence that
 * distinguishes DNS failure, a refused connection, TLS rejection and a
 * timeout — the difference between "restart the tunnel" and "fix the DNS
 * record" took a manual lookup to establish. Every transport failure is logged
 * once, here, with the cause.
 */
export function logPosTransportFailure(failure: PosTransportFailure): void {
  console.error(
    JSON.stringify({
      event: "pos_bridge_transport_failure",
      ...failure,
    }),
  );
}

/** Classify a thrown fetch error (DNS, refused, reset, TLS, abort). */
export function describePosTransportError(err: unknown): { reason: PosTransportFailure["reason"]; detail: string } {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const name = e?.name ?? "";
  const causeCode = e?.cause?.code ?? "";
  const causeMessage = e?.cause?.message ?? e?.message ?? String(err);
  if (name === "AbortError" || name === "TimeoutError") {
    return { reason: "timeout", detail: "request aborted after the bridge timeout" };
  }
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return { reason: "network", detail: `DNS lookup failed (${causeCode})` };
  }
  // Keep the machine-readable code even when the message omits it (undici's TLS
  // failures arrive as a plain message with the code only on the cause), so the
  // log line names the failure mode rather than just repeating the text.
  return {
    reason: "network",
    detail: causeCode && !causeMessage.includes(causeCode) ? `${causeCode}: ${causeMessage}` : `${name || "fetch"}: ${causeMessage}`,
  };
}

/**
 * Probe whether the configured POS is actually reachable, for the ops console
 * and as a preflight. `GET /health` is the POS's own public readiness endpoint
 * (Backend/server.js) — it checks DB connectivity, so a 200 means more than "a
 * TCP port answered". Deliberately does NOT go through the connection-code
 * bridge: a code is a bearer credential and must not be burned to test the
 * transport.
 */
/**
 * Why POS_BASE_URL cannot work at all, independent of any single call, or null
 * when it is usable. One predicate for every bridge client: the four clients
 * (connection bridge, order ingest, payment push, cancellation) each carried
 * their own `if (!base)` check, so a guard added to only some of them would
 * leave the rest silently dead in production.
 */
export function posBaseUrlProblem(): { reason: PosTransportFailure["reason"]; detail: string; host: string | null } | null {
  const base = posBaseUrl();
  if (!base) {
    return { reason: "not_configured", detail: "POS_BASE_URL is not configured", host: null };
  }
  const host = safeHost(base);
  if (host && isLoopbackHost(host) && process.env.VERCEL_ENV === "production") {
    return {
      reason: "loopback_in_production",
      detail: "POS_BASE_URL points at loopback on a deployed function, which can never reach a POS",
      host,
    };
  }
  return null;
}

export async function probePosBridge(timeoutMs = 5000): Promise<{
  ok: boolean;
  baseUrl: string | null;
  host: string | null;
  configured: boolean;
  loopback: boolean;
  status: number | null;
  latencyMs: number | null;
  reason: PosTransportFailure["reason"] | null;
  detail: string | null;
}> {
  const base = posBaseUrl();
  const host = base ? safeHost(base) : null;
  const report = {
    baseUrl: base || null,
    host,
    configured: !!base,
    loopback: !!host && isLoopbackHost(host),
  };

  const problem = posBaseUrlProblem();
  if (problem) {
    return { ...report, ok: false, status: null, latencyMs: null, reason: problem.reason, detail: problem.detail };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      return { ...report, ok: true, status: res.status, latencyMs, reason: null, detail: null };
    }
    return { ...report, ok: false, status: res.status, latencyMs, reason: "bad_status", detail: `POS /health returned ${res.status}` };
  } catch (err) {
    const { reason, detail } = describePosTransportError(err);
    return { ...report, ok: false, status: null, latencyMs: Date.now() - started, reason, detail };
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(base: string): string | null {
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
}

/** Hostname of the configured POS, for logs. Never the URL — it may carry credentials. */
export function posHost(): string | null {
  return safeHost(posBaseUrl());
}

/**
 * The base URL every bridge client must use, or throw.
 *
 * Throws PosBridgeError; callers with their own error type wrap this so the
 * delivery journals keep classifying a misconfiguration as retryable.
 */
export function requirePosBaseUrl(): string {
  const problem = posBaseUrlProblem();
  if (problem) {
    logPosTransportFailure(problem);
    throw new PosBridgeError(
      problem.reason === "not_configured"
        ? "POS_BASE_URL is not configured"
        : "POS_BASE_URL points at localhost on a deployed function — set it to the public POS URL",
      503,
      "POS_UNREACHABLE",
    );
  }
  return posBaseUrl();
}

async function posPost<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T> {
  const base = requirePosBaseUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: safeHost(base) });
    throw new PosBridgeError("POS is unreachable", 502, "POS_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }

  const parsed = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  if (!res.ok || !parsed?.success) {
    throw new PosBridgeError(
      parsed?.error || `POS request failed (${res.status})`,
      res.status,
      parsed?.error || "POS_REQUEST_FAILED",
      (parsed as Record<string, unknown>) ?? null,
    );
  }
  return parsed.data as T;
}

/**
 * How the verify step should react to a POS attestation failure.
 *
 * `redeemed` is its own outcome rather than a 4xx because it is the one failure
 * that is not decidable at this layer. The POS verify endpoint returns a bare
 * `ALREADY_REDEEMED` with no bound identity — publishing one there would reopen
 * the code-enumeration oracle the owner-key gate on the route exists to close —
 * so "already claimed" and "already spent against a different POS restaurant"
 * are indistinguishable here. Only the claim endpoint carries the identity, and
 * only claim can accept a replay safely.
 *
 * Returning this as a fatal error is what stranded operators: every reconnect
 * using an already-claimed code rendered "already redeemed" with no control that
 * could reach the step able to resolve it.
 */
export type PosVerifyOutcome =
  | { kind: "redeemed"; message: string }
  | { kind: "fatal"; message: string; code: string; status: number };

export function classifyPosVerifyFailure(err: unknown): PosVerifyOutcome {
  if (!(err instanceof PosBridgeError)) {
    return { kind: "fatal", message: "Could not verify the code", code: "VERIFY_FAILED", status: 500 };
  }
  if (err.code === "ALREADY_REDEEMED") {
    return {
      kind: "redeemed",
      message:
        "This code has already been used. If it is the code you connected with before, continue to finish the reconnect — otherwise stop and issue a new one in the POS.",
    };
  }
  if (err.status === 401) {
    return { kind: "fatal", message: "Code is invalid or has expired", code: err.code, status: 401 };
  }
  if (err.status === 502 || err.status === 503) {
    return {
      kind: "fatal",
      message: "The POS is unreachable — try again",
      code: err.code,
      status: err.status,
    };
  }
  return { kind: "fatal", message: err.message, code: err.code, status: err.status };
}

/** Attest a connection code WITHOUT consuming it. */
export async function verifyPosConnection(code: string): Promise<PosConnectionIdentity> {
  return posPost<PosConnectionIdentity>("/integrations/marketplace/connection/verify", {
    connection_code: code,
  });
}

/** Redeem a connection code exactly once and return the connected identity. */
export async function claimPosConnection(code: string): Promise<PosConnectionIdentity> {
  return posPost<PosConnectionIdentity>("/integrations/marketplace/connection/claim", {
    connection_code: code,
  });
}