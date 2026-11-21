/**
 * Gendered profile avatar for signed-in customers.
 * The customer selects male/female; we render a clear emoji avatar.
 */

export type CustomerAvatar = "" | "male" | "female";

export const CUSTOMER_AVATAR_OPTIONS: ReadonlyArray<{
  key: Exclude<CustomerAvatar, "">;
  label: string;
  emoji: string;
}> = [
  { key: "female", label: "Female", emoji: "👩" },
  { key: "male", label: "Male", emoji: "👨" },
];

export function avatarEmojiFor(avatar: unknown): string {
  const v = String(avatar ?? "").trim().toLowerCase();
  if (v === "female") return "👩";
  if (v === "male") return "👨";
  return "🧑";
}

export function avatarLabelFor(avatar: unknown): string {
  const v = String(avatar ?? "").trim().toLowerCase();
  if (v === "female") return "Female avatar";
  if (v === "male") return "Male avatar";
  return "Choose avatar";
}
