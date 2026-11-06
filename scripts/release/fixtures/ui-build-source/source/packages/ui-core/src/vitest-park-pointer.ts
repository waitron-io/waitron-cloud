import type { BrowserCommand } from "vitest/node";

/**
 * The slice of Playwright's `Page` that `parkPointer` touches. Only the playwright provider's browser
 * command context carries a `page` (see `provider.getCommandsContext` in @vitest/browser-playwright),
 * so it is cast narrowly at the boundary rather than typed onto `BrowserCommandContext` itself.
 */
interface PlaywrightMousePage {
  mouse: { move(x: number, y: number): Promise<void> };
}

/**
 * Moves the real mouse cursor off every element, so nothing is left matching CSS `:hover`.
 *
 * The cursor position belongs to the PAGE, and every test file in a worker shares one page — so a
 * `userEvent` click or hover parks the cursor at those coordinates for every later test, in this
 * file and in every file that runs after it. Whatever then renders under those coordinates is
 * `:hover`ed with no test having asked for it.
 *
 * `userEvent.unhover()` cannot do this: @vitest/browser implements it as a hover of `html > body`,
 * which parks the cursor in the MIDDLE of the page, on top of whatever is mounted there. Negative
 * coordinates are outside the viewport, so no element can be under them.
 */
export const parkPointer: BrowserCommand<[]> = async (context) => {
  const { page } = context as unknown as { page: PlaywrightMousePage };
  await page.mouse.move(-1, -1);
};

/**
 * Ready-to-spread `commands` fragment. Every browser-mode vitest config whose tests run the
 * `parkPointer` hook — those that import `a11y-helpers.ts`, and the local `test-helpers.ts` copies
 * in apps/till and apps/dashboard that call `commands.parkPointer()` — spreads this into
 * `test.browser.commands`, so the `beforeEach(() => commands.parkPointer())` finds a registered
 * command instead of throwing `TypeError`. `scripts/park-pointer-registered.test.ts` guards that
 * every such package registers it.
 */
export const parkPointerCommands = { parkPointer };
