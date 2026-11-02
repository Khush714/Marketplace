export const INTEGRATION_ONE_TIME_PASSKEY_TTL_MS = 10 * 60 * 1000;

export function integrationOneTimePasskeyIsLive(
  expiresAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  return expiresAt instanceof Date && expiresAt.getTime() > now;
}
