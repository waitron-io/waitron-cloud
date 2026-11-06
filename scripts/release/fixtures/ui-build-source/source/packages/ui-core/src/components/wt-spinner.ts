import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtSpinnerSize = "sm" | "md" | "lg";

/**
 * An indeterminate progress indicator: a ring drawn in `currentColor` whose one solid arc rotates.
 * On its own it is a live `role="status"` region named by `label`, so assistive tech announces that
 * something is in progress. Inside a control that already carries the state (`wt-button loading`:
 * `aria-busy` plus its own localized label) it is `decorative` — hidden from assistive tech — so the
 * control is not announced twice, once in the caller's language and once in this element's default.
 * Under `prefers-reduced-motion` the ring stays still (the arc is still visible, so the state is
 * conveyed without motion). Sizes follow the font-size tokens exactly as `wt-icon` does, so a
 * spinner sits beside text or inside a button at the text's own size.
 */
@customElement("wt-spinner")
export class WtSpinner extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
        vertical-align: middle;
        /* Paint in the SURROUNDING text colour, not the base text token: inside a primary button
           the ring must be the on-primary colour, exactly like the label beside it. */
        color: inherit;
      }

      :host([size="sm"]) {
        width: var(--wt-font-size-sm);
        height: var(--wt-font-size-sm);
      }

      :host([size="lg"]) {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }

      .ring {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border: calc(var(--wt-space-1) / 2) solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: wt-spin 0.8s linear infinite;
      }

      @keyframes wt-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ring {
          animation: none;
        }
      }
    `,
  ];

  @property({ reflect: true }) size: WtSpinnerSize = "md";
  /** The accessible name of the status region — what a screen reader announces. */
  @property() label = "Loading";
  /** Purely visual: no status role, hidden from assistive tech (a host control, or a status text
   * beside it, carries the state). */
  @property({ type: Boolean, reflect: true }) decorative = false;

  override render() {
    return this.decorative
      ? html`<span class="ring" aria-hidden="true"></span>`
      : html`<span class="ring" role="status" aria-label=${this.label}></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-spinner": WtSpinner;
  }
}
