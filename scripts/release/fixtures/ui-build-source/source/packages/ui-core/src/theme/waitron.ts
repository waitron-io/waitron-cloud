import colorsCss from "../tokens/colors.css?raw";
import structureCss from "../tokens/structure.css?raw";
import { readDefaults, type WaitronDefaults } from "./defaults.js";
import { type DerivedTheme, deriveThemeFrom, type ThemeChoices } from "./theme.js";

export const WAITRON_DEFAULTS: WaitronDefaults = readDefaults(colorsCss, structureCss);

export function deriveTheme(choices: ThemeChoices): DerivedTheme {
  return deriveThemeFrom(WAITRON_DEFAULTS, choices);
}
