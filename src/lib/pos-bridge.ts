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

export function posBaseUrl(): string {
  return (process.env.POS_BASE_URL || "").trim().replace(/\/+$/, "");
}

async function posPost<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T> {
  const base = posBaseUrl();
  if (!base) {
    throw new PosBridgeError("POS_BASE_URL is not configured", 503, "POS_UNREACHABLE");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
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