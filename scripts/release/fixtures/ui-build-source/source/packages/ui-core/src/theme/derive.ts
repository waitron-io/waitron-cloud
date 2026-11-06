import {
  type Oklch,
  contrastRatio,
  fromOklch,
  luminanceRatio,
  relativeLuminance,
  toOklch,
} from "./colour.js";
import {
  type ContrastRule,
  type RuleResult,
  STATIONS,
  THEME_RULES,
  passes,
} from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import type { ThemeChoices } from "./theme.js";
import { type ThemeColour, THEME_COLOUR_TOKENS, colourToken, cornerRadii } from "./tokens.js";

export const PRIMARY = colourToken("primary");

/** A colour's shades, nearest first, with each one's relative luminance at the same index. */
export interface Shades {
  readonly colours: readonly string[];
  readonly luminances: readonly number[];
}

/**
 * Answers that repeat, within one call and between calls. Each is a pure function of its key and
 * the defaults the memo was made for, so dropping an entry only means working it out again.
 */
export interface Memo {
  readonly settles: Map<string, ModeResult>;
  readonly fixes: Map<string, string | null>;
  readonly walks: Map<string, string>;
  readonly paths: Map<string, Path>;
  readonly hovers: Map<string, string>;
  readonly brands: Map<string, BrandShades>;
  readonly tints: Map<string, Readonly<Record<string, string>>>;
  readonly pushes: Map<string, string>;
  readonly shades: Map<string, Shades>;
  readonly luminances: Map<string, number>;
}

const newMemo = (): Memo => ({
  settles: new Map(),
  fixes: new Map(),
  walks: new Map(),
  paths: new Map(),
  hovers: new Map(),
  brands: new Map(),
  tints: new Map(),
  pushes: new Map(),
  shades: new Map(),
  luminances: new Map(),
});

const KEPT_DEFAULTS = 1;
const KEPT_ENTRIES = 500;

/** Keyed by the defaults' content rather than the object, so a caller changing it in place gets a new memo. */
const memos = new Map<string, Memo>();

/**
 * Runs `work` with the memo for `defaults`. When a call ends, the memos of the calls that started
 * last are kept, each cut to its newest entries.
 */
export function withMemo<T>(defaults: WaitronDefaults, work: (memo: Memo) => T): T {
  const key = JSON.stringify(defaults);
  const memo = memos.get(key) ?? newMemo();
  memos.delete(key);
  memos.set(key, memo);
  try {
    return work(memo);
  } finally {
    for (const old of [...memos.keys()].slice(0, -KEPT_DEFAULTS)) memos.delete(old);
    for (const map of Object.values(memo) as Map<string, unknown>[]) {
      for (const old of [...map.keys()].slice(0, -KEPT_ENTRIES)) map.delete(old);
    }
  }
}

/** Not part of the package: lets each test work its answers out afresh. */
export function forgetRemembered(): void {
  memos.clear();
}

export function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let found = cache.get(key);
  if (found === undefined) {
    found = make();
    cache.set(key, found);
  }
  return found;
}

export const luminanceOf = (memo: Memo, hex: string): number =>
  remember(memo.luminances, hex, () => relativeLuminance(hex));

const contrastOf = (memo: Memo, a: string, b: string) =>
  luminanceRatio(luminanceOf(memo, a), luminanceOf(memo, b));

const STATION_FILLS = STATIONS.map(colourToken);

/** The tinted colours of each mode and the OKLCH lightness and chroma each is tinted toward. */
const TINT_TARGETS: Readonly<
  Record<Mode, Partial<Record<ThemeColour, readonly [number, number]>>>
> = {
  light: {
    bg: [0.974, 0.012],
    "surface-sunken": [0.885, 0.014],
    border: [0.885, 0.014],
    track: [0.845, 0.014],
    "field-fill": [0.955, 0.01],
    "field-fill-disabled": [0.975, 0.006],
  },
  dark: {
    bg: [0.17, 0.012],
    surface: [0.215, 0.014],
    "surface-raised": [0.255, 0.016],
    "surface-sunken": [0.17, 0.012],
    border: [0.33, 0.016],
    track: [0.33, 0.016],
    "field-fill": [0.27, 0.016],
    "field-fill-disabled": [0.235, 0.012],
  },
};

/** The grounds link text is worked out against, beside the lifted surface; the focus ring takes the first two. */
const BRAND_GROUNDS = ["bg", "surface", "surface-raised", "field-fill"].map(colourToken);
/** The brand fix also clears the number stepper's fill, on which the stepper paints its icon in the button colour. */
const BRAND_FIX_GROUNDS = [...BRAND_GROUNDS, colourToken("stepper-button")];

/**
 * One step of a lightness walk; `null` once the lightness is pinned at 0 or 1, since every later
 * step would repeat this colour. Only #000000 starts pinned, and it maps to itself (checked over
 * all 16.7M #rrggbb colours; receipt in the slice 1 PR).
 */
function stepped(L: number, dir: number, size: number): number | null {
  if (dir === 1 ? !(L < 1) : !(L > 0)) return null;
  return Math.min(1, Math.max(0, L + dir * size));
}

/** The colours a lightness walk passes through, worked out only as far as a walk has gone. */
export interface Path {
  readonly start: Oklch;
  readonly colours: string[];
  readonly luminances: number[];
  L: number;
  pinned: boolean;
}

/** Steps `from`'s lightness until `done` holds of a colour's luminance, the lightness is pinned, or `steps` run out. */
function walk(
  memo: Memo,
  from: string,
  dir: number,
  size: number,
  steps: number,
  done: (luminance: number) => boolean,
): string {
  const path = remember(memo.paths, JSON.stringify([from, dir, size]), () => {
    const start = toOklch(from);
    return {
      start,
      colours: [from],
      luminances: [luminanceOf(memo, from)],
      L: start.L,
      pinned: false,
    };
  });
  for (let i = 0; ; i++) {
    if (i >= steps || done(path.luminances[i]!)) return path.colours[i]!;
    if (i + 1 < path.colours.length) continue;
    const next = path.pinned ? null : stepped(path.L, dir, size);
    if (next === null) {
      path.pinned = true;
      return path.colours[i]!;
    }
    const colour = fromOklch({ ...path.start, L: next });
    const luminance = luminanceOf(memo, colour);
    path.L = next;
    path.colours.push(colour);
    path.luminances.push(luminance);
  }
}

/**
 * Walks `hex`'s lightness in 0.005 steps until it has `need` against every colour in `list`. No
 * #rrggbb walk takes more than 200 steps before its lightness is pinned (checked over all 16.7M
 * #rrggbb colours; receipt in the slice 1 PR), so this one needs no count.
 */
function until(
  memo: Memo,
  hex: string,
  dir: number,
  list: readonly string[],
  need: number,
): string {
  return remember(memo.walks, JSON.stringify([hex, dir, need, list]), () => {
    const grounds = list.map((ground) => luminanceOf(memo, ground));
    return walk(
      memo,
      hex,
      dir,
      0.005,
      Infinity,
      (own) => Math.min(...grounds.map((ground) => luminanceRatio(own, ground))) >= need,
    );
  });
}

/** The first lightness away from `on`, else toward it, in 0.02 steps that shows and keeps `on` readable. */
function hoverOf(memo: Memo, primary: string, on: string): string {
  return remember(memo.hovers, JSON.stringify([primary, on]), () => {
    const start = toOklch(primary);
    const away = relativeLuminance(on) > relativeLuminance(primary) ? -1 : +1;
    let hover = primary;
    search: for (const dir of [away, -away]) {
      for (let step = 1; step < 50; step++) {
        hover = fromOklch({ ...start, L: start.L + dir * 0.02 * step });
        if (contrastRatio(hover, primary) >= 1.2 && contrastRatio(hover, on) >= 4.5) {
          break search;
        }
      }
    }
    return hover;
  });
}

function brandFixShade(memo: Memo, brand: string, mode: Mode, grounds: readonly string[]): string {
  return until(memo, brand, mode === "dark" ? +1 : -1, grounds, 3);
}

/** The colours `deriveAt` takes from the brand colour alone. */
export interface BrandShades {
  readonly H: number;
  readonly C0: number;
  readonly lifted: string;
  readonly stepper: string;
  readonly ink: string;
  readonly disabled: string;
  readonly onDisabled: string;
}

const brandShades = (memo: Memo, mode: Mode, brand: string): BrandShades =>
  remember(memo.brands, JSON.stringify([mode, brand]), () => {
    const dark = mode === "dark";
    const { H, C: C0 } = toOklch(brand);
    return {
      H,
      C0,
      lifted: fromOklch({ L: dark ? 0.34 : 0.935, C: Math.min(C0, dark ? 0.04 : 0.035), H }),
      stepper: fromOklch({ L: dark ? 0.27 : 0.955, C: Math.min(C0, 0.035), H }),
      ink: dark ? fromOklch({ L: 0.16, C: Math.min(C0, 0.04), H }) : "#ffffff",
      disabled: fromOklch({ L: dark ? 0.31 : 0.8, C: Math.min(C0, dark ? 0.04 : 0.09), H }),
      onDisabled: dark ? fromOklch({ L: 0.72, C: 0.03, H }) : "#ffffff",
    };
  });

/** Waitron's tinted colours of `mode` moved `tintStrength` of the way toward the brand's hue. */
const tintsOf = (
  memo: Memo,
  defaults: WaitronDefaults,
  mode: Mode,
  brand: string,
  tintStrength: number,
): Readonly<Record<string, string>> =>
  remember(memo.tints, JSON.stringify([mode, brand, tintStrength]), () => {
    const { H, C0 } = brandShades(memo, mode, brand);
    const out: Record<string, string> = {};
    for (const [key, [L, C]] of Object.entries(TINT_TARGETS[mode]) as [
      ThemeColour,
      readonly [number, number],
    ][]) {
      const from = toOklch(defaults[mode][colourToken(key)]!);
      out[colourToken(key)] = fromOklch({
        L: from.L + (L - from.L) * tintStrength,
        C: from.C + (Math.min(C, C0) - from.C) * tintStrength,
        H,
      });
    }
    return Object.freeze(out);
  });

function deriveAt(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  tintStrength: number,
  fixed: Readonly<Record<string, string>>,
): Record<string, string> {
  const d = defaults[mode];
  const chosen = choices.brandColor;
  const brand = fixed[PRIMARY] ?? chosen ?? d[PRIMARY]!;
  const dark = mode === "dark";
  const out: Record<string, string> = {};
  const get = (token: string) => (out[token] ?? d[token])!;
  if (choices.background === "tinted" && tintStrength > 0) {
    Object.assign(out, tintsOf(memo, defaults, mode, brand, tintStrength));
  }
  Object.assign(out, fixed);
  if (chosen === null && !(PRIMARY in fixed)) return out;

  const shades = brandShades(memo, mode, brand);
  out[colourToken("surface-lifted")] = shades.lifted;
  out[colourToken("stepper-button")] = shades.stepper;
  Object.assign(out, fixed);
  const grounds = BRAND_GROUNDS.map(get);
  const primary =
    fixed[PRIMARY] ??
    (choices.brandFix[mode] === true
      ? brandFixShade(memo, brand, mode, BRAND_FIX_GROUNDS.map(get))
      : brand);
  const { ink } = shades;
  const onPrimary =
    fixed[colourToken("on-primary")] ??
    (contrastOf(memo, ink, primary) >= 4.5
      ? ink
      : contrastOf(memo, "#000000", primary) >= contrastOf(memo, "#ffffff", primary)
        ? "#000000"
        : "#ffffff");
  const lifted = get(colourToken("surface-lifted"));
  const primaryText = until(memo, brand, dark ? +1 : -1, [...grounds, lifted], 4.5);
  const hover = hoverOf(memo, primary, onPrimary);
  const stationFills = STATION_FILLS.map((token) => d[token]!);
  const focus = until(
    memo,
    primaryText,
    dark ? +1 : -1,
    [...grounds.slice(0, 2), lifted, ...stationFills],
    3,
  );
  Object.assign(out, {
    [PRIMARY]: primary,
    [colourToken("on-primary")]: onPrimary,
    [colourToken("primary-hover")]: hover,
    [colourToken("primary-text")]: primaryText,
    [colourToken("focus")]: focus,
    [colourToken("field-label-focus")]: primaryText,
    [colourToken("primary-disabled")]: shades.disabled,
    [colourToken("on-primary-disabled")]: shades.onDisabled,
  });
  Object.assign(out, fixed);
  return out;
}

export interface ModeResult {
  /** Every colour and radius token in THEME_TOKENS, Waitron's values wherever the derivation writes nothing. */
  readonly tokens: Record<string, string>;
  /** The rules still failing on the settled colours. */
  readonly failures: readonly RuleResult[];
  readonly tintStrength: number;
}

/** Each mode's rules with the tokens they name listed once, so each token's luminance is looked up once. */
const INDEXED = Object.fromEntries(
  (Object.keys(THEME_RULES) as Mode[]).map((mode) => {
    const named = [...new Set(THEME_RULES[mode].flatMap((rule) => [rule.a, rule.b]))];
    const rules = THEME_RULES[mode].map((rule) => ({
      rule,
      a: named.indexOf(rule.a),
      b: named.indexOf(rule.b),
    }));
    return [mode, { named, rules }];
  }),
) as Record<Mode, { named: string[]; rules: { rule: ContrastRule; a: number; b: number }[] }>;

/** The rules of `mode` that fail on `tokens`, Waitron's values filling the rest, in rule order. */
function failing(
  memo: Memo,
  defaults: WaitronDefaults,
  mode: Mode,
  tokens: Record<string, string>,
): RuleResult[] {
  const { named, rules } = INDEXED[mode];
  const luminances = named.map((token) =>
    luminanceOf(memo, (tokens[token] ?? defaults[mode][token])!),
  );
  const failed: RuleResult[] = [];
  for (const { rule, a, b } of rules) {
    const ratio = luminanceRatio(luminances[a]!, luminances[b]!);
    if (!passes(rule, ratio)) failed.push({ rule, ratio, pass: false });
  }
  return failed;
}

/** The tint strengths tried, by repeated subtraction: the last is 1.4e-16, not 0. */
const TINT_STRENGTHS = Array.from({ length: 10 }).reduce<number[]>(
  (list) => [...list, list[list.length - 1]! - 0.1],
  [1],
);

/** Moves `from` in lightness, away from `against` or toward it for an at-most rule, until the rule passes or 200 steps run out. */
function push(memo: Memo, rule: ContrastRule, from: string, against: string): string {
  return remember(memo.pushes, JSON.stringify([rule.kind, rule.need, from, against]), () => {
    const within = rule.kind === "at-most";
    const ground = luminanceOf(memo, against);
    const darker = ground > luminanceOf(memo, from);
    return walk(memo, from, within === darker ? +1 : -1, within ? 0.002 : 0.005, 200, (own) =>
      passes(rule, luminanceRatio(own, ground)),
    );
  });
}

/** `hand` holds theme colour tokens only. */
export function settleMode(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): ModeResult {
  return remember(memo.settles, settleKey(choices, mode, hand), () =>
    settleAfresh(memo, defaults, choices, mode, hand),
  );
}

/** Every choice settling `mode` reads; the defaults are the memo's. */
export const settleKey = (
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): string =>
  JSON.stringify([
    mode,
    choices.brandColor,
    choices.background,
    choices.corners,
    choices.brandFix[mode] === true,
    [...THEME_COLOUR_TOKENS].map((token) => hand[token] ?? null),
  ]);

function settleAfresh(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): ModeResult {
  const isHand = (token: string) => token in hand;
  const tinted = Object.keys(TINT_TARGETS[mode]).map(colourToken);
  const brandOwned = choices.brandColor !== null && !isHand(PRIMARY);
  const ownRule = ({ rule }: RuleResult) =>
    brandOwned && (rule.a === PRIMARY || rule.b === PRIMARY);
  const picked = (result: RuleResult) =>
    isHand(result.rule.a) || isHand(result.rule.b) || ownRule(result);
  const tintIn = (result: RuleResult) => {
    const { a, b } = result.rule;
    return (
      (tinted.includes(a) || tinted.includes(b)) && !isHand(a) && !isHand(b) && !ownRule(result)
    );
  };
  let strength = 1;
  if (choices.background === "tinted") {
    const found = TINT_STRENGTHS.find(
      (trial) =>
        !failing(memo, defaults, mode, deriveAt(memo, defaults, choices, mode, trial, hand)).some(
          tintIn,
        ),
    );
    strength = Math.round((found ?? 0) * 10) / 10;
  }
  const colourIn = (tokens: Record<string, string>, token: string) =>
    (tokens[token] ?? defaults[mode][token])!;
  const settled = (fixed: Readonly<Record<string, string>>) => {
    const written = deriveAt(memo, defaults, choices, mode, strength, fixed);
    return { written, fails: failing(memo, defaults, mode, written) };
  };
  const work: Record<string, string> = {};
  let current = settled({ ...hand });
  for (let round = 0; ; round++) {
    const { written, fails } = current;
    const failingNow = new Set(fails.map(({ rule }) => rule));
    // A move never newly fails a rule naming no colour the owner picked.
    const tried = (token: string, value: string) => {
      const next = settled({ ...work, [token]: value, ...hand });
      return next.fails.length < fails.length &&
        next.fails.every((result) => picked(result) || failingNow.has(result.rule))
        ? next
        : null;
    };
    let next: ReturnType<typeof settled> | null = null;
    for (const result of fails) {
      if (ownRule(result)) continue;
      const { rule } = result;
      for (const [token, other] of [
        [rule.a, rule.b],
        [rule.b, rule.a],
      ] as const) {
        if (!THEME_COLOUR_TOKENS.has(token) || isHand(token) || token === PRIMARY) continue;
        const against = colourIn(written, other);
        const value = push(memo, rule, colourIn(written, token), against);
        next = passes(rule, contrastRatio(value, against)) ? tried(token, value) : null;
        if (next !== null) {
          work[token] = value;
          break;
        }
      }
      if (next !== null) break;
    }
    // The 60th round's move is not settled.
    if (next === null || round === 59) break;
    current = next;
  }
  const { written, fails } = current;
  const tokens: Record<string, string> = {};
  for (const token of THEME_COLOUR_TOKENS) tokens[token] = colourIn(written, token);
  Object.assign(tokens, cornerRadii(choices.corners, defaults));
  return Object.freeze({
    tokens: Object.freeze(tokens),
    failures: Object.freeze(fails),
    tintStrength: strength,
  });
}
