import type { Mode, WaitronDefaults } from "./defaults.js";
import type { ThemeChoices } from "./theme.js";
import { fontSizes, type TextScale } from "./tokens.js";

export const TYPEFACES = ["system", "serif"] as const;

export type Typeface = (typeof TYPEFACES)[number];

export const TEXT_SIZE_KEYS = ["sm", "md", "lg", "xl"] as const;

export type TextSizeKey = (typeof TEXT_SIZE_KEYS)[number];

export const TEXT_WEIGHT_KEYS = ["normal", "medium", "bold"] as const;

export type TextWeightKey = (typeof TEXT_WEIGHT_KEYS)[number];

export const TEXT_WEIGHTS = [400, 500, 600, 700, 800] as const;

export type TextWeight = (typeof TEXT_WEIGHTS)[number];

export const TEXT_SIZE_MIN = 8;

export const TEXT_SIZE_MAX = 40;

/** Only what is set by hand; an absent part follows Waitron's own. */
export interface ThemeText {
  readonly family?: Typeface;
  readonly size?: Readonly<Partial<Record<TextSizeKey, number>>>;
  readonly weight?: Readonly<Partial<Record<TextWeightKey, TextWeight>>>;
}

export const isTextSize = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= TEXT_SIZE_MIN &&
  (value as number) <= TEXT_SIZE_MAX;

function inOrder<K extends string, V>(
  keys: readonly K[],
  values: Readonly<Partial<Record<K, V>>> | undefined,
): Partial<Record<K, V>> | undefined {
  if (values === undefined) return undefined;
  const entries = keys.flatMap((key) => (values[key] === undefined ? [] : [[key, values[key]]]));
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Partial<Record<K, V>>);
}

/** Drops empty parts and writes the keys in list order. */
export function normaliseText(text: ThemeText): ThemeText {
  const size = inOrder(TEXT_SIZE_KEYS, text.size);
  const weight = inOrder(TEXT_WEIGHT_KEYS, text.weight);
  return {
    ...(text.family === undefined ? {} : { family: text.family }),
    ...(size === undefined ? {} : { size }),
    ...(weight === undefined ? {} : { weight }),
  };
}

export function sameText(a: ThemeText, b: ThemeText): boolean {
  return JSON.stringify(normaliseText(a)) === JSON.stringify(normaliseText(b));
}

/** The one place a typeface choice becomes a CSS font stack. */
export function typefaceStack(family: Typeface, defaults: WaitronDefaults): string {
  switch (family) {
    case "system": {
      const own = defaults.structure["--wt-font-family"];
      if (own === undefined || own === "") {
        throw new RangeError("no default typeface: --wt-font-family");
      }
      return own;
    }
    case "serif":
      return 'ui-serif, Georgia, "Times New Roman", serif';
    default: {
      const unknown: never = family;
      throw new RangeError(`not a typeface: ${String(unknown)}`);
    }
  }
}

/** A size at 100% times `textScale`, rounded half up to whole pixels. */
export const drawnSize = (px: number, textScale: TextScale): number =>
  Math.floor((px * textScale + 50) / 100);

const WHOLE_HUNDRED = /^[1-9]00$/;

/** The four sizes, the typeface and the three weights, keyed by full token name. */
export function textTokens(
  textScale: TextScale,
  text: ThemeText,
  defaults: WaitronDefaults,
): Record<string, string> {
  const weights = TEXT_WEIGHT_KEYS.map((key) => {
    const name = `--wt-font-weight-${key}`;
    const fallback = defaults.structure[name] ?? "";
    if (!WHOLE_HUNDRED.test(fallback)) throw new RangeError(`not a whole-hundred weight: ${name}`);
    return [name, String(text.weight?.[key] ?? fallback)];
  });
  return {
    ...fontSizes(textScale, defaults, text.size),
    "--wt-font-family": typefaceStack(text.family ?? "system", defaults),
    ...Object.fromEntries(weights),
  };
}

/** The smallest drawn size a hand-set size may have without a warning. */
export const TEXT_FLOOR_PX = 12;

/** The tills are checked at Waitron's own sizes at the largest step. */
const CHECKED_SCALE: TextScale = 130;

export type TextSizeField = `text.size.${TextSizeKey}`;

export interface TextWarning {
  readonly field: TextSizeField;
  readonly mode: null;
  /** Always empty: the shape is a colour warning's. */
  readonly against: readonly string[];
  /** The smallest size from 8 that draws at least 12 px at the current step. */
  readonly fix: number;
  /** Always empty. */
  readonly blockedBy: readonly string[];
}

export interface TextNote {
  readonly key: TextSizeKey;
  readonly drawn: number;
  /** The largest size that draws within the limit at the current step. */
  readonly fix: number;
}

export const isTextWarning = (warning: { readonly mode: Mode | null }): warning is TextWarning =>
  warning.mode === null;

function ownSize(key: TextSizeKey, defaults: WaitronDefaults): number {
  const name = `--wt-font-size-${key}`;
  const match = /^(\d+)px$/.exec(defaults.structure[name] ?? "");
  if (match === null) throw new RangeError(`not a whole-pixel size: ${name}`);
  return Number(match[1]);
}

export function drawnTextSize(
  choices: Pick<ThemeChoices, "text" | "textScale">,
  key: TextSizeKey,
  defaults: WaitronDefaults,
): number {
  return drawnSize(choices.text.size?.[key] ?? ownSize(key, defaults), choices.textScale);
}

/** Waitron's own size at 130%. */
export const textLimit = (key: TextSizeKey, defaults: WaitronDefaults): number =>
  drawnSize(ownSize(key, defaults), CHECKED_SCALE);

export function textWarnings(
  choices: Pick<ThemeChoices, "text" | "textScale">,
  defaults: WaitronDefaults,
): TextWarning[] {
  return TEXT_SIZE_KEYS.flatMap((key) => {
    if (drawnTextSize(choices, key, defaults) >= TEXT_FLOOR_PX) return [];
    // Ends by 12: no step draws a size smaller than itself.
    let fix = TEXT_SIZE_MIN;
    while (drawnSize(fix, choices.textScale) < TEXT_FLOOR_PX) fix += 1;
    return [{ field: `text.size.${key}` as const, mode: null, against: [], fix, blockedBy: [] }];
  });
}

export function textNotes(
  choices: Pick<ThemeChoices, "text" | "textScale">,
  defaults: WaitronDefaults,
): TextNote[] {
  return TEXT_SIZE_KEYS.flatMap((key) => {
    // Waitron's own size never draws over its limit, so only a hand-set one is read.
    const set = choices.text.size?.[key];
    const limit = textLimit(key, defaults);
    if (set === undefined) return [];
    const drawn = drawnSize(set, choices.textScale);
    if (drawn <= limit) return [];
    let fix = set;
    while (drawnSize(fix, choices.textScale) > limit) fix -= 1;
    return [{ key, drawn, fix }];
  });
}

/** Sets each warned size to its fix; a size with only a note is left alone. */
export function withTextFixes(choices: ThemeChoices, defaults: WaitronDefaults): ThemeChoices {
  const warnings = textWarnings(choices, defaults);
  if (warnings.length === 0) return choices;
  const size = { ...choices.text.size };
  for (const warning of warnings) {
    size[warning.field.slice("text.size.".length) as TextSizeKey] = warning.fix;
  }
  return { ...choices, text: normaliseText({ ...choices.text, size }) };
}
