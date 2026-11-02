import { timingSafeEqual } from "node:crypto";

export function merchantPairingSecretMatches(
  provided: string,
  expected: string,
): boolean {
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    expectedBytes.length >= 32 &&
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function isMerchantBusinessId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isMerchantPairingPasskey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{24}$/.test(value);
}
