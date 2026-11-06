import axe from "axe-core";
import { commands } from "vitest/browser";
import { beforeEach, expect } from "vitest";
import { host, mount } from "./test-helpers.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // ./vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
  }
}

/**
 * Starts every a11y test with the mouse cursor off the page, so nothing inherits a `:hover` that an
 * earlier test's click or hover left behind — the cursor belongs to the shared page, not to the test
 * that moved it, and it outlives the file that moved it.
 * This module is imported by the suites that run `expectNoA11yViolations`, so the hook covers exactly
 * the tests that scan.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  ${violation.helpUrl}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

// The reasons in axe's colour-contrast messages (`locales/_template.json`) counted as being about
// the colours themselves. axe 4.14.0 never sets `fgAlpha`.
const UNDECIDED_COLOUR_READINGS = new Set(["equalRatio", "fgAlpha", "colorParse"]);

function undecidedColourReadings(incomplete: axe.Result[]): string[] {
  return incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) =>
      result.nodes.flatMap((node) =>
        node.any
          .filter((check) =>
            UNDECIDED_COLOUR_READINGS.has(
              (check.data as { messageKey?: string } | null)?.messageKey ?? "",
            ),
          )
          .map(
            (check) =>
              `${result.id} [undecided]: ${check.message}\n  targets: ${node.target.join(" ")}`,
          ),
      ),
    );
}

/**
 * Runs the full default axe-core ruleset against `context` and fails the test (via a vitest
 * `expect`, with a readable message) if it finds any violations, or a colour-contrast check it left
 * undecided for a reason about the colours themselves (`equalRatio`, `fgAlpha`, `colorParse`).
 *
 * `context` is almost always the themed host `<div>` — the live `host` binding from
 * `test-helpers.ts` — rather than the mounted component itself, so axe also sees the theme root's
 * own attributes. axe-core traverses into open shadow roots automatically; `a11y-helpers.test.ts`
 * checks that this setup actually does so.
 *
 * No ruleset is narrowed here — every caller runs the same, full default set. If a rule ever needs
 * excluding, that is a decision to make (and justify) explicitly at the call site, not silently
 * inside this helper.
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}

/**
 * Mounts `html` (see `mount()` in test-helpers.ts) and, in addition, paints the host's own
 * background from `--wt-color-bg`, as a real deployment does. Without this, a component with no
 * background of its own (e.g. `wt-input`'s `<label>`) would be contrast-checked against the test
 * page's default white background regardless of theme.
 *
 * Pass `theme` to pin `data-theme="light"|"dark"` on the host (overriding
 * `prefers-color-scheme`); omit it to test whatever theme the environment currently resolves to.
 *
 * It also paints the page CANVAS (`<body>`/`<html>`) with the host's resolved theme background:
 * axe-core composites the background of any element it cannot trace back to `host` (e.g. one
 * pushed off-viewport, where `elementsFromPoint` returns nothing) against that canvas.
 * `<body>`/`<html>` are not themselves theme roots, so read the concrete colour off `host` rather
 * than passing the `var()`; `cleanup()` in test-helpers.ts resets it.
 */
export async function mountThemed(html: string, theme?: Theme): Promise<HTMLElement> {
  const el = await mount(html);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  const canvasBg = getComputedStyle(host).backgroundColor;
  document.body.style.background = canvasBg;
  document.documentElement.style.background = canvasBg;
  return el;
}
