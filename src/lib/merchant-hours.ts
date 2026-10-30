/** India Standard Time business-hour checks shared by checkout and listing UI. */
export function isWithinMerchantHours(
  enabled: boolean,
  opensAt: string,
  closesAt: string,
  now: Date = new Date(),
): boolean {
  if (!enabled) return true;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt) || opensAt === closesAt) {
    return false;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  if (opensAt < closesAt) return parts >= opensAt && parts < closesAt;
  return parts >= opensAt || parts < closesAt;
}
