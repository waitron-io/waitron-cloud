import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-card")
export class WtCard extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .card {
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        padding: var(--wt-space-4);
      }

      :host([raised]) .card {
        background: var(--wt-color-surface-raised);
        box-shadow: var(--wt-shadow-1);
      }

      .header {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
      }

      /* Only content actually projected into the header slot gets the gap
         below it — an empty header (no "header" slot content) collapses to
         zero height instead of leaving a spurious margin before the body. */
      .header ::slotted(*) {
        margin-bottom: var(--wt-space-3);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) raised = false;

  override render() {
    return html`
      <div class="card">
        <div class="header"><slot name="header"></slot></div>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-card": WtCard;
  }
}
