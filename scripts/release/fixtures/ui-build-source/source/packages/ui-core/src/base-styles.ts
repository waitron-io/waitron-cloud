import { css } from "lit";

export const baseStyles = css`
  :host,
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  :host {
    font-family: var(--wt-font-family);
    font-size: var(--wt-font-size-md);
    color: var(--wt-color-text);
  }

  /* :where() keeps this at no specificity, so a component's own weight wins whatever its order. */
  :where(strong, b, h1, h2, h3, h4, h5, h6, th) {
    font-weight: var(--wt-font-weight-bold);
  }

  :host([hidden]) {
    display: none;
  }

  :focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;

/**
 * The disabled-state treatment shared by every primitive that dims its own interactive element
 * on `:disabled`/`[disabled]`. Interpolate it into the selector body, e.g.
 * `button:disabled { ${disabledStyles} }`, rather than re-spelling the declarations (and the
 * --wt-opacity-disabled token they read) in each component.
 *
 * wt-switch does NOT use this fragment: its opacity is on the host and its disabled cursor on
 * `.hit-area` and the input, because the native `<input>` is an invisible (`opacity: 0`) layer,
 * not the visible control — applying this fragment there would make that invisible input visible
 * whenever disabled. It reads `var(--wt-opacity-disabled)` directly for the host's opacity.
 * wt-number-stepper also leaves this fragment off its buttons: only the symbol fades, so its
 * disabled cursor is set separately.
 */
export const disabledStyles = css`
  opacity: var(--wt-opacity-disabled);
  cursor: not-allowed;
`;

/** Hides an element from sight while leaving it in the accessibility tree, so it can still name or
 * describe a control. Interpolate it into a selector body, as with {@link disabledStyles}.
 * `text-wrap`, not `white-space`: no-hardcoded-chrome.test.ts reads "white" in it as a colour. */
export const visuallyHiddenStyles = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  text-wrap: nowrap;
  border: 0;
`;
