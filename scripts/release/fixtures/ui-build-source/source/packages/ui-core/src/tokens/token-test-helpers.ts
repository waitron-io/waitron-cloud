import { applyTokens } from "./index.js";

/**
 * Test-only helpers shared by the suites in this directory.
 *
 * Deliberately NOT src/test-helpers.ts: these suites test `applyTokens` itself, so a
 * helper that depends on it (as src/test-helpers.ts's `mount()` does) would make the
 * tests circular. Keep this file free of anything beyond raw DOM + `applyTokens`.
 */

/** Reads a custom property's resolved value off `el`, trimmed. */
export function token(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * Creates a fresh `<div>`, optionally themed via `data-theme`, appends it to
 * `document.body`, and marks it as a theme root via `applyTokens`. Callers own
 * removing it — cleanup shape differs enough across the three suites (a single
 * `host` vs. an array of simultaneously-live roots) that it isn't factored in here.
 */
export function mountTokenRoot(theme?: "light" | "dark"): HTMLElement {
  const el = document.createElement("div");
  if (theme) el.setAttribute("data-theme", theme);
  document.body.appendChild(el);
  applyTokens(el);
  return el;
}
