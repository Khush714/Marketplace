import "server-only";
import { 
  buildCustomPosPayload, 
  computeCustomPosSignature, 
  CUSTOM_POS_HEADER_SIGNATURE, 
  CUSTOM_POS_HEADER_TIMESTAMP 
} from "./custom-pos-core";

export interface DispatchCustomPosInput {
  order: any;
  webhookUrl: string;
  signingSecret: string;
}

export async function dispatchCustomPosOrder(input: DispatchCustomPosInput) {
  const url = (input.webhookUrl || "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(`Custom POS webhook URL is invalid: ${url}`);
  }

  const payload = buildCustomPosPayload(input.order);
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = computeCustomPosSignature(rawBody, timestamp, input.signingSecret);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        [CUSTOM_POS_HEADER_TIMESTAMP]: timestamp,
        [CUSTOM_POS_HEADER_SIGNATURE]: signature,
      },
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      return { 
        ok: false, 
        error: body?.message || `Custom POS returned HTTP ${res.status}`,
        status: res.status 
      };
    }

    return { ok: true, posOrderId: body?.posOrderId || null };
  } catch (error: any) {
    return { ok: false, error: error?.message || "Custom POS unreachable" };
  }
}