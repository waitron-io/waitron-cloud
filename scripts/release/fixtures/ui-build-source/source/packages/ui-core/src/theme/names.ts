export const THEME_NAME_MAX_LENGTH = 60;

export const BUILT_IN_THEME_NAME = "Waitron";

export const themeNameKey = (name: string): string =>
  name.normalize("NFC").trim().toLowerCase().normalize("NFC");

export type ThemeNameRefusal = "empty" | "too_long" | "reserved";

export type ThemeNameResult =
  | { readonly ok: true; readonly name: string; readonly key: string }
  | { readonly ok: false; readonly reason: ThemeNameRefusal };

/** The length is counted in code points of the NFC form, so an emoji or an accent counts once. */
export function checkThemeName(name: string): ThemeNameResult {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if ([...trimmed.normalize("NFC")].length > THEME_NAME_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  const key = themeNameKey(trimmed);
  if (key === themeNameKey(BUILT_IN_THEME_NAME)) return { ok: false, reason: "reserved" };
  return { ok: true, name: trimmed, key };
}
