import { applyTokens } from "./tokens/index.js";

/** The wrapper element of the most recent mount. Live binding — reassigned by mount(). */
export let host: HTMLElement;

const mounted: HTMLElement[] = [];

/**
 * Mounts `html` inside a fresh themed host and waits for the element to render.
 * Returns the first child — the component under test.
 */
export async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanup)`. */
export function cleanup(): void {
  for (const el of mounted.splice(0)) el.remove();
  // Reset the themed canvas that mountThemed() (a11y-helpers.ts) paints on <body>/<html>.
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

/**
 * Mounts `html` inside a *nested* shadow root — a plain wrapper `<div>`'s own `attachShadow`,
 * not `document`'s light DOM. This is what makes `composed: true` on a custom event observable
 * at all: dispatched directly in light DOM (what `mount()` above gives you), an event only ever
 * needs to *bubble* to reach an ancestor listener — `composed` never comes into play, so a
 * mutant flipping `composed: true` to `false` survives even a listener on `document`. Only once
 * the dispatch point sits inside a shadow root does reaching an ancestor *outside* that shadow
 * root require crossing the boundary, which is exactly what `composed` governs.
 *
 * Returns the mounted element (inside the shadow root) — event listeners for a composed-event
 * assertion should be attached to `document` or another node outside `wrapper`'s shadow root,
 * not to `wrapper` itself.
 */
export async function mountInShadowRoot(html: string): Promise<HTMLElement> {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  mounted.push(wrapper);
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.innerHTML = html;
  const el = shadow.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}
