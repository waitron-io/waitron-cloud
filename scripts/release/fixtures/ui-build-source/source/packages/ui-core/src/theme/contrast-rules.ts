import { contrastRatio } from "./colour.js";
import { MODES, type Mode } from "./defaults.js";
import { THEME_COLOUR_TOKENS, colourToken } from "./tokens.js";

export type RuleKind = "at-least" | "above" | "at-most";

export type ContrastGroupId =
  | "body-text"
  | "lifted-surface"
  | "sunken-surface"
  | "bar-track"
  | "field"
  | "primary-text"
  | "search-highlight"
  | "hover-text"
  | "hover-shows"
  | "disabled-fill"
  | "disabled-text"
  | "google-button"
  | "calendar-text"
  | "calendar-days"
  | "table-text"
  | "table-marks"
  | "calm-edge"
  | "calm-fill"
  | "ready-text"
  | "tab-tints"
  | "station-text"
  | "station-dots"
  | "station-focus"
  | "button-text"
  | "button-fill"
  | "stepper-icon"
  | "focus-ring";

/** `a` is the colour drawn on top, `b` the one under it; both are full token names. */
export interface ContrastRule {
  readonly group: ContrastGroupId;
  readonly a: string;
  readonly b: string;
  readonly kind: RuleKind;
  readonly need: number;
}

export interface ContrastGroup {
  readonly id: ContrastGroupId;
  readonly modes: readonly Mode[];
  readonly rules: readonly ContrastRule[];
}

export const STATIONS: readonly string[] = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
].map((colour) => `station-${colour}`);

const PALETTE = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
  "grey",
].map((colour) => `palette-${colour}`);

type Pair = readonly [a: string, b: string];

/** Each zone tab tint, with the bar drawn on it. */
const TAB_TINTS: readonly Pair[] = [
  ["tab-danger-tint", "danger"],
  ["tab-warning-tint", "warning"],
  ["tab-bill-tint", "table-bill"],
  ["tab-ready-tint", "success"],
  ["tab-seated-tint", "table-seated"],
];

const each = (as: readonly string[], bs: readonly string[]): Pair[] =>
  as.flatMap((a) => bs.map((b) => [a, b] as const));

function group(
  id: ContrastGroupId,
  modes: readonly Mode[],
  ...parts: readonly (readonly [kind: RuleKind, need: number, pairs: readonly Pair[]])[]
): ContrastGroup {
  return {
    id,
    modes,
    rules: parts.flatMap(([kind, need, pairs]) =>
      pairs.map(([a, b]) => ({ group: id, a: colourToken(a), b: colourToken(b), kind, need })),
    ),
  };
}

const onOwn = (fills: readonly string[]): Pair[] => fills.map((fill) => [`on-${fill}`, fill]);

export const CONTRAST_GROUPS: readonly ContrastGroup[] = [
  group("body-text", MODES, [
    "at-least",
    4.5,
    each(["text", "text-muted"], ["bg", "surface", "surface-raised"]),
  ]),
  group(
    "lifted-surface",
    MODES,
    ["above", 1.1, each(["surface-lifted"], ["bg", "surface", "surface-raised"])],
    ["at-least", 4.5, each(["text", "text-muted", "danger"], ["surface-lifted"])],
  ),
  group("sunken-surface", MODES, ["at-least", 4.5, [["text", "surface-sunken"]]]),
  group(
    "bar-track",
    MODES,
    ["at-least", 1.4, each(["track"], ["bg", "surface"])],
    ["at-least", 4.5, [["text", "track"]]],
  ),
  group(
    "field",
    MODES,
    [
      "at-least",
      3,
      [...each(["field-line"], ["field-fill", "surface", "bg"]), ["primary", "field-fill"]],
    ],
    [
      "at-least",
      4.5,
      [
        ...each(
          ["field-label-focus", "text-muted", "text", "danger", "field-value"],
          ["field-fill"],
        ),
        ["text-muted", "field-fill-disabled"],
      ],
    ],
  ),
  group("primary-text", MODES, [
    "at-least",
    4.5,
    each(["primary-text"], ["bg", "surface", "surface-raised", "surface-lifted"]),
  ]),
  group("search-highlight", MODES, [
    "at-least",
    4.5,
    each(["on-highlight", "text"], ["highlight"]),
  ]),
  group("hover-text", MODES, [
    "at-least",
    4.5,
    [
      ["on-primary", "primary-hover"],
      ["on-danger", "danger-hover"],
    ],
  ]),
  group("hover-shows", MODES, [
    "at-least",
    1.2,
    [
      ["primary-hover", "primary"],
      ["danger-hover", "danger"],
    ],
  ]),
  group(
    "disabled-fill",
    ["dark"],
    ["at-most", 1.5, each(["primary-disabled", "danger-disabled"], ["surface", "surface-raised"])],
  ),
  group(
    "disabled-text",
    ["dark"],
    ["at-least", 4.5, onOwn(["primary-disabled", "danger-disabled"])],
  ),
  group(
    "google-button",
    MODES,
    ["at-least", 4.5, [["google-button-text", "google-button-fill"]]],
    [
      "at-least",
      3,
      each(["google-button-line"], ["google-button-fill", "surface-raised", "surface", "bg"]),
    ],
  ),
  group("calendar-text", MODES, [
    "at-least",
    4.5,
    onOwn([...PALETTE, "day-standard", "day-closed"]),
  ]),
  group("calendar-days", MODES, ["at-least", 3, [["day-standard", "day-closed"]]]),
  group("table-text", MODES, [
    "at-least",
    4.5,
    onOwn(["free", "seated", "bill", "reserved", "calm"].map((fill) => `table-${fill}`)),
  ]),
  group("table-marks", MODES, ["at-least", 3, each(["danger", "warning"], ["surface"])]),
  group(
    "calm-edge",
    MODES,
    ["at-least", 2, [["table-calm-edge", "surface"]]],
    ["at-least", 1.4, [["table-calm-edge", "border"]]],
  ),
  group(
    "calm-fill",
    MODES,
    ["at-least", 4.5, onOwn(["table-calm"])],
    ["at-least", 3, [["field-line", "table-calm"]]],
  ),
  group("ready-text", MODES, ["at-least", 4.5, onOwn(["success"])]),
  group(
    "tab-tints",
    MODES,
    [
      "at-least",
      4.5,
      each(
        ["text"],
        TAB_TINTS.map(([tint]) => tint),
      ),
    ],
    ["at-least", 3, TAB_TINTS.map(([tint, bar]) => [bar, tint] as const)],
  ),
  group("station-text", MODES, [
    "at-least",
    4.5,
    STATIONS.flatMap((fill) =>
      ["text", "text-muted", "warning", "danger"].map((text) => [text, fill] as const),
    ),
  ]),
  group("station-dots", MODES, [
    "at-least",
    3,
    each(
      STATIONS.map((fill) => `${fill}-dot`),
      [...STATIONS, "surface"],
    ),
  ]),
  group("station-focus", MODES, ["at-least", 3, each(["focus"], [...STATIONS, "surface-lifted"])]),
  group("button-text", MODES, ["at-least", 4.5, [["on-primary", "primary"]]]),
  group("button-fill", MODES, [
    "at-least",
    3,
    each(["primary"], ["bg", "surface", "surface-raised"]),
  ]),
  group("stepper-icon", MODES, ["at-least", 3, [["primary", "stepper-button"]]]),
  group("focus-ring", MODES, ["at-least", 3, each(["focus"], ["bg", "surface"])]),
];

export function rulesIn(id: ContrastGroupId, mode: Mode): readonly ContrastRule[] {
  const found = CONTRAST_GROUPS.find((candidate) => candidate.id === id)!;
  return found.modes.includes(mode) ? found.rules : [];
}

export function allRules(mode: Mode): readonly ContrastRule[] {
  return CONTRAST_GROUPS.flatMap((candidate) => rulesIn(candidate.id, mode));
}

const themeRules = (mode: Mode) =>
  allRules(mode).filter(
    (rule) => THEME_COLOUR_TOKENS.has(rule.a) || THEME_COLOUR_TOKENS.has(rule.b),
  );

export const THEME_RULES: Readonly<Record<Mode, readonly ContrastRule[]>> = {
  light: themeRules("light"),
  dark: themeRules("dark"),
};

export function passes(rule: ContrastRule, ratio: number): boolean {
  if (rule.kind === "at-least") return ratio >= rule.need;
  if (rule.kind === "above") return ratio > rule.need;
  return ratio <= rule.need;
}

export interface RuleResult {
  readonly rule: ContrastRule;
  readonly ratio: number;
  readonly pass: boolean;
}

export function checkRules(
  rules: readonly ContrastRule[],
  colourOf: (token: string) => string,
): RuleResult[] {
  return rules.map((rule) => {
    const ratio = contrastRatio(colourOf(rule.a), colourOf(rule.b));
    return { rule, ratio, pass: passes(rule, ratio) };
  });
}

const NEEDS: Record<RuleKind, string> = {
  "at-least": "at least",
  above: "more than",
  "at-most": "at most",
};

export function failureLabels(results: readonly RuleResult[]): string[] {
  return results
    .filter((result) => !result.pass)
    .map(
      ({ rule, ratio }) =>
        `${rule.a} on ${rule.b}: ${ratio.toFixed(2)}, needs ${NEEDS[rule.kind]} ${rule.need}`,
    );
}
