import { MODES, type Mode } from "./defaults.js";
import { BACKGROUNDS, normaliseChoices, type ThemeChoices, type ThemeLogo } from "./theme.js";
import { isTextSize, TEXT_SIZE_KEYS, TEXT_WEIGHT_KEYS, TEXT_WEIGHTS, TYPEFACES } from "./text.js";
import { CORNER_CHOICES, isTextScale, THEME_COLOURS } from "./tokens.js";

export const THEME_DOCUMENT_KEYS = [
  "brandColor",
  "brandFix",
  "background",
  "corners",
  "handSet",
  "logo",
  "textScale",
  "text",
] as const satisfies readonly (keyof ThemeChoices)[];

export type ThemeRefusalReason =
  | "not_object"
  | "unknown_key"
  | "missing"
  | "bad_value"
  | "unknown_colour"
  | "fix_without_brand"
  | "fix_with_hand_set"
  | "dark_without_light";

export type ThemeDocumentResult =
  | { readonly ok: true; readonly choices: ThemeChoices }
  | { readonly ok: false; readonly field: string; readonly reason: ThemeRefusalReason };

type Refusal = Extract<ThemeDocumentResult, { ok: false }>;
type Fields = Readonly<Record<string, unknown>>;

const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHex = (value: unknown): boolean => typeof value === "string" && HEX.test(value);

const isOneOf = (list: readonly unknown[], value: unknown): boolean => list.includes(value);

const refuse = (field: string, reason: ThemeRefusalReason): Refusal => ({
  ok: false,
  field,
  reason,
});

/** Names the known field holding an unknown key, never the key itself: the caller typed that. */
function unknownKey(
  fields: Fields,
  allowed: readonly string[],
  holder: string,
  reason: ThemeRefusalReason = "unknown_key",
): Refusal | null {
  return Object.keys(fields).every((name) => allowed.includes(name))
    ? null
    : refuse(holder, reason);
}

function checkBrandFix(value: unknown): Refusal | null {
  if (value === undefined) return refuse("brandFix", "missing");
  if (!isObject(value)) return refuse("brandFix", "bad_value");
  const unknown = unknownKey(value, MODES, "brandFix");
  if (unknown) return unknown;
  const bad = MODES.find((mode) => value[mode] !== undefined && value[mode] !== true);
  return bad === undefined ? null : refuse(`brandFix.${bad}`, "bad_value");
}

function checkHandSet(value: unknown): Refusal | null {
  if (value === undefined) return refuse("handSet", "missing");
  if (!isObject(value)) return refuse("handSet", "bad_value");
  const unknown = unknownKey(value, MODES, "handSet");
  if (unknown) return unknown;
  const absent = MODES.find((mode) => value[mode] === undefined);
  if (absent !== undefined) return refuse(`handSet.${absent}`, "missing");
  const notObject = MODES.find((mode) => !isObject(value[mode]));
  if (notObject !== undefined) return refuse(`handSet.${notObject}`, "bad_value");
  for (const mode of MODES) {
    const colours = unknownKey(
      value[mode] as Fields,
      THEME_COLOURS,
      `handSet.${mode}`,
      "unknown_colour",
    );
    if (colours) return colours;
  }
  for (const mode of MODES) {
    const entry = Object.entries(value[mode] as Fields).find(([, hex]) => !isHex(hex));
    if (entry) return refuse(`handSet.${mode}.${entry[0]}`, "bad_value");
  }
  return null;
}

function checkFixes(input: Fields): Refusal | null {
  const brandFix = input.brandFix as Partial<Record<Mode, true>>;
  const handSet = input.handSet as Record<Mode, Fields>;
  for (const mode of MODES) {
    if (brandFix[mode] !== true) continue;
    if (input.brandColor === null) return refuse(`brandFix.${mode}`, "fix_without_brand");
    if (handSet[mode].primary !== undefined) return refuse(`brandFix.${mode}`, "fix_with_hand_set");
  }
  return null;
}

function checkLogo(value: unknown): Refusal | null {
  if (value === null) return null;
  if (!isObject(value)) return refuse("logo", "bad_value");
  const unknown = unknownKey(value, ["light", "dark"], "logo");
  if (unknown) return unknown;
  if (!Object.hasOwn(value, "light")) {
    return Object.hasOwn(value, "dark")
      ? refuse("logo.dark", "dark_without_light")
      : refuse("logo.light", "missing");
  }
  if (typeof value.light !== "string") return refuse("logo.light", "bad_value");
  if (Object.hasOwn(value, "dark") && typeof value.dark !== "string") {
    return refuse("logo.dark", "bad_value");
  }
  return null;
}

function checkParts(
  value: unknown,
  holder: string,
  keys: readonly string[],
  allowed: (part: unknown) => boolean,
): Refusal | null {
  if (value === undefined) return null;
  if (!isObject(value)) return refuse(holder, "bad_value");
  const unknown = unknownKey(value, keys, holder);
  if (unknown) return unknown;
  const bad = keys.find((key) => value[key] !== undefined && !allowed(value[key]));
  return bad === undefined ? null : refuse(`${holder}.${bad}`, "bad_value");
}

function checkText(value: unknown): Refusal | null {
  if (value === undefined) return null;
  if (!isObject(value)) return refuse("text", "bad_value");
  return (
    unknownKey(value, ["family", "size", "weight"], "text") ??
    (value.family !== undefined && !isOneOf(TYPEFACES, value.family)
      ? refuse("text.family", "bad_value")
      : null) ??
    checkParts(value.size, "text.size", TEXT_SIZE_KEYS, isTextSize) ??
    checkParts(value.weight, "text.weight", TEXT_WEIGHT_KEYS, (weight) =>
      isOneOf(TEXT_WEIGHTS, weight),
    )
  );
}

/** Checks a theme document sent or stored, answering its first refusal in a fixed order. */
export function readThemeDocument(input: unknown): ThemeDocumentResult {
  if (!isObject(input)) return refuse("theme", "not_object");
  const logo = input.logo === undefined ? null : input.logo;
  const refusal =
    unknownKey(input, THEME_DOCUMENT_KEYS, "theme") ??
    (input.brandColor === undefined
      ? refuse("brandColor", "missing")
      : input.brandColor !== null && !isHex(input.brandColor)
        ? refuse("brandColor", "bad_value")
        : null) ??
    checkBrandFix(input.brandFix) ??
    (input.background === undefined
      ? refuse("background", "missing")
      : !isOneOf(BACKGROUNDS, input.background)
        ? refuse("background", "bad_value")
        : null) ??
    (input.corners === undefined
      ? refuse("corners", "missing")
      : !isOneOf(CORNER_CHOICES, input.corners)
        ? refuse("corners", "bad_value")
        : null) ??
    checkHandSet(input.handSet) ??
    checkFixes(input) ??
    checkLogo(logo) ??
    (input.textScale !== undefined && !isTextScale(input.textScale)
      ? refuse("textScale", "bad_value")
      : null) ??
    checkText(input.text);
  if (refusal) return refusal;
  const own = logo as ThemeLogo | null;
  const answered: ThemeLogo | null =
    own === null
      ? null
      : Object.hasOwn(own, "dark")
        ? { light: own.light, dark: own.dark }
        : { light: own.light };
  return {
    ok: true,
    choices: normaliseChoices({
      ...input,
      logo: answered,
      textScale: input.textScale ?? 100,
      text: input.text ?? {},
    } as unknown as ThemeChoices),
  };
}
