import { hexToRgb } from "./colour.js";
import { MODES, type Mode, type WaitronDefaults } from "./defaults.js";
import { type Memo, type ModeResult, settleMode, withMemo } from "./derive.js";
import {
  normaliseText,
  textTokens,
  textWarnings,
  type TextWarning,
  type ThemeText,
  withTextFixes,
} from "./text.js";
import { nextFix, warningsFor, warns } from "./warnings.js";
import {
  type Corners,
  type TextScale,
  type ThemeColour,
  THEME_COLOURS,
  handTokens,
} from "./tokens.js";

export const BACKGROUNDS = ["neutral", "tinted"] as const;

export type Background = (typeof BACKGROUNDS)[number];

/** Image library file names. */
export interface ThemeLogo {
  readonly light: string;
  readonly dark?: string;
}

export interface ThemeChoices {
  /** `null` is Waitron's own brand colour. */
  readonly brandColor: string | null;
  readonly brandFix: Readonly<Partial<Record<Mode, true>>>;
  readonly background: Background;
  readonly corners: Corners;
  readonly handSet: Readonly<Record<Mode, Readonly<Partial<Record<ThemeColour, string>>>>>;
  readonly logo: ThemeLogo | null;
  readonly textScale: TextScale;
  readonly text: ThemeText;
}

export const WAITRON_CHOICES: ThemeChoices = {
  brandColor: null,
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
  logo: null,
  textScale: 100,
  text: {},
};

export type WarningField = "brandColor" | `handSet.${Mode}.${ThemeColour}`;

export interface ColourWarning {
  readonly field: WarningField;
  readonly mode: Mode;
  /** Theme keys without the `--wt-color-` prefix. */
  readonly against: readonly string[];
  readonly fix: string | null;
  /** The hand-set keys that block every shade when `fix` is null; otherwise empty. */
  readonly blockedBy: readonly string[];
}

export type ThemeWarning = ColourWarning | TextWarning;

export interface DerivedTheme {
  /** Keys exactly `THEME_TOKENS`, in that order. */
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
  readonly warnings: readonly ThemeWarning[];
  /** `null` for Neutral; otherwise 0 to 1 in tenths. */
  readonly tintStrength: Readonly<Record<Mode, number>> | null;
}

function lowerHex(value: string): string {
  hexToRgb(value);
  return value.toLowerCase();
}

function normaliseHand(
  values: Readonly<Partial<Record<ThemeColour, string>>>,
): Partial<Record<ThemeColour, string>> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (!(THEME_COLOURS as readonly string[]).includes(key)) {
        throw new RangeError(`not a theme colour: ${key}`);
      }
      return [key, lowerHex(value)];
    }),
  );
}

export function normaliseChoices(choices: ThemeChoices): ThemeChoices {
  const handSet = {
    light: normaliseHand(choices.handSet.light),
    dark: normaliseHand(choices.handSet.dark),
  };
  const text = normaliseText(choices.text);
  const { brandColor } = choices;
  if (brandColor === null) return { ...choices, brandFix: {}, handSet, text };
  const brandFix = { ...choices.brandFix };
  for (const mode of MODES) if (handSet[mode].primary !== undefined) delete brandFix[mode];
  return { ...choices, brandColor: lowerHex(brandColor), brandFix, handSet, text };
}

export function deriveThemeFrom(defaults: WaitronDefaults, choices: ThemeChoices): DerivedTheme {
  const normalised = normaliseChoices(choices);
  return withMemo(defaults, (memo) => {
    const [light, dark] = MODES.map((mode) =>
      settleMode(memo, defaults, normalised, mode, handTokens(normalised.handSet[mode])),
    ) as [ModeResult, ModeResult];
    const text = textTokens(normalised.textScale, normalised.text, defaults);
    return {
      light: { ...light.tokens, ...text },
      dark: { ...dark.tokens, ...text },
      warnings: [
        ...warningsFor(memo, defaults, normalised, "light", light),
        ...warningsFor(memo, defaults, normalised, "dark", dark),
        ...textWarnings(normalised, defaults),
      ],
      tintStrength:
        normalised.background === "tinted"
          ? { light: light.tintStrength, dark: dark.tintStrength }
          : null,
    };
  });
}

/**
 * Takes fixes one at a time, per mode: of the first failing rule naming a warned colour with a fix,
 * the fix of the colour drawn on top if it has one, else of the other; then settles again. Then
 * each text size that warns takes its fix.
 */
export function fixAll(defaults: WaitronDefaults, choices: ThemeChoices): ThemeChoices {
  return withMemo(defaults, (memo) => fixAllIn(memo, defaults, choices));
}

function fixAllIn(memo: Memo, defaults: WaitronDefaults, choices: ThemeChoices): ThemeChoices {
  let current = normaliseChoices(choices);
  for (const mode of MODES) {
    for (let round = 0; round < 50; round++) {
      const settled = settleMode(memo, defaults, current, mode, handTokens(current.handSet[mode]));
      const next = nextFix(memo, defaults, current, mode, settled);
      if (next === null) break;
      current = normaliseChoices(
        next.colour === null
          ? { ...current, brandFix: { ...current.brandFix, [mode]: true } }
          : {
              ...current,
              handSet: {
                ...current.handSet,
                [mode]: { ...current.handSet[mode], [next.colour]: next.fix },
              },
            },
      );
    }
  }
  return withTextFixes(current, defaults);
}

/** Whether Fix and save is offered: Fix all leaves no warning. */
export function canFixAll(defaults: WaitronDefaults, choices: ThemeChoices): boolean {
  return withMemo(defaults, (memo) => {
    const fixed = fixAllIn(memo, defaults, choices);
    return (
      MODES.every(
        (mode) =>
          !warns(
            fixed,
            mode,
            settleMode(memo, defaults, fixed, mode, handTokens(fixed.handSet[mode])),
          ),
      ) && textWarnings(fixed, defaults).length === 0
    );
  });
}
