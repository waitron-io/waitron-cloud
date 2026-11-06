import type { DerivedTheme } from "./theme.js";
import { THEME_TOKENS } from "./tokens.js";

const COLOUR_VALUE = /^#[0-9a-f]{6}$/;
const PIXEL_VALUE = /^\d+px$/;
const WEIGHT_VALUE = /^[1-9]00$/;
// A comma-separated list of bare words or names in paired double quotes: no `;`, `{`, `}`, `\`,
// `<`, `'` or lone `"`, so a value cannot end its declaration or the next one.
const FAMILY = '(?:"[A-Za-z0-9 -]+"|[A-Za-z0-9-]+(?: [A-Za-z0-9-]+)*)';
const TYPEFACE_VALUE = new RegExp(`^${FAMILY}(?:, ${FAMILY})*$`);

function shapeOf(name: string): RegExp {
  if (name.startsWith("--wt-color-")) return COLOUR_VALUE;
  if (name === "--wt-font-family") return TYPEFACE_VALUE;
  if (name.startsWith("--wt-font-weight-")) return WEIGHT_VALUE;
  return PIXEL_VALUE;
}

// Refusing an extra key and a missing value accepts exactly THEME_TOKENS.
function declarations(version: Readonly<Record<string, string>>, indent: string): string {
  const extra = Object.keys(version).find((key) => !THEME_TOKENS.includes(key));
  if (extra !== undefined) throw new RangeError(`not a theme token: ${extra}`);
  return THEME_TOKENS.map((name) => {
    const value = version[name];
    if (value === undefined || !shapeOf(name).test(value))
      throw new RangeError(`not a derived value for ${name}`);
    return `${indent}${name}: ${value};\n`;
  }).join("");
}

export function themeSheet(theme: Pick<DerivedTheme, "light" | "dark">): string {
  const light = declarations(theme.light, "    ");
  const dark = declarations(theme.dark, "    ");
  const preferredDark = declarations(theme.dark, "      ");
  return (
    "@media screen {\n" +
    `  [data-wt-theme-root] {\n${light}  }\n` +
    "  @media (prefers-color-scheme: dark) {\n" +
    `    [data-wt-theme-root]:not([data-theme="light"]) {\n${preferredDark}    }\n` +
    "  }\n" +
    `  [data-wt-theme-root][data-theme="dark"] {\n${dark}  }\n` +
    "}\n"
  );
}
