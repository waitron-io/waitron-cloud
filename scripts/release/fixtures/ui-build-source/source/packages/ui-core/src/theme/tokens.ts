import type { WaitronDefaults } from "./defaults.js";
import { drawnSize, type ThemeText } from "./text.js";

export const THEME_COLOURS = [
  "bg",
  "surface",
  "surface-raised",
  "surface-lifted",
  "surface-sunken",
  "track",
  "border",
  "text",
  "text-muted",
  "primary",
  "primary-hover",
  "on-primary",
  "primary-disabled",
  "on-primary-disabled",
  "primary-text",
  "focus",
  "field-fill",
  "field-line",
  "field-label-focus",
  "field-value",
  "field-fill-disabled",
  "stepper-button",
] as const;

export type ThemeColour = (typeof THEME_COLOURS)[number];

export const colourToken = (key: string): string => `--wt-color-${key}`;

/** A colour token's key: its name without the `--wt-color-` prefix. */
export const colourKey = (token: string): string => token.slice(colourToken("").length);

/** The theme's colour tokens, full names, in `THEME_COLOURS` order. */
export const THEME_COLOUR_TOKENS: ReadonlySet<string> = new Set(THEME_COLOURS.map(colourToken));

/** One mode's hand-set values, keyed by full token name. */
export const handTokens = (
  values: Readonly<Partial<Record<ThemeColour, string>>>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [colourToken(key), value]));

export const TEXT_SCALES = [100, 105, 110, 115, 120, 125, 130] as const;

export type TextScale = (typeof TEXT_SCALES)[number];

export const isTextScale = (value: unknown): value is TextScale =>
  (TEXT_SCALES as readonly unknown[]).includes(value);

export const THEME_RADII = ["--wt-radius-sm", "--wt-radius-md", "--wt-radius-lg"] as const;

export const THEME_FONT_SIZES = [
  "--wt-font-size-sm",
  "--wt-font-size-md",
  "--wt-font-size-lg",
  "--wt-font-size-xl",
] as const;

export const THEME_TEXT_TOKENS = [
  "--wt-font-family",
  "--wt-font-weight-normal",
  "--wt-font-weight-medium",
  "--wt-font-weight-bold",
] as const;

export const THEME_TOKENS: readonly string[] = [
  ...THEME_COLOUR_TOKENS,
  ...THEME_RADII,
  ...THEME_FONT_SIZES,
  ...THEME_TEXT_TOKENS,
];

export const BRAND_FAMILY: readonly ThemeColour[] = [
  "primary",
  "on-primary",
  "primary-hover",
  "primary-text",
  "focus",
  "field-label-focus",
  "primary-disabled",
  "on-primary-disabled",
  "surface-lifted",
  "stepper-button",
];

export const CORNER_CHOICES = ["square", "standard", "round"] as const;

export type Corners = (typeof CORNER_CHOICES)[number];

const FIXED_CORNERS = {
  square: ["0px", "2px", "4px"],
  round: ["8px", "14px", "24px"],
} as const;

export function cornerRadii(corners: Corners, defaults: WaitronDefaults): Record<string, string> {
  return Object.fromEntries(
    THEME_RADII.map((radius, index) => [
      radius,
      corners === "standard" ? defaults.structure[radius]! : FIXED_CORNERS[corners][index]!,
    ]),
  );
}

/**
 * The four sizes — each hand-set size, else the one in `defaults` — times `textScale`, rounded half
 * up to whole pixels.
 */
export function fontSizes(
  textScale: TextScale,
  defaults: WaitronDefaults,
  size?: ThemeText["size"],
): Record<string, string> {
  return Object.fromEntries(
    THEME_FONT_SIZES.map((name) => {
      const match = /^(\d+)px$/.exec(defaults.structure[name] ?? "");
      if (match === null) throw new RangeError(`not a whole-pixel size: ${name}`);
      const key = name.slice("--wt-font-size-".length) as keyof NonNullable<ThemeText["size"]>;
      return [name, `${drawnSize(size?.[key] ?? Number(match[1]), textScale)}px`];
    }),
  );
}
