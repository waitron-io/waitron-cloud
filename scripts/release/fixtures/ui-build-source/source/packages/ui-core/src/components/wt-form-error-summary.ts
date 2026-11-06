import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

@customElement("wt-form-error-summary")
export class WtFormErrorSummary extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .summary {
        margin-bottom: var(--wt-space-4);
        padding: var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-danger);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }

      .heading {
        margin: 0;
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      ul {
        margin: var(--wt-space-2) 0 0;
        padding-inline-start: var(--wt-space-5);
      }
    `,
  ];

  @property() heading = "";
  @property({ attribute: false }) errors: readonly string[] = [];

  private readonly headingId = uniqueId("wt-form-error-heading");

  override render() {
    if (this.errors.length === 0) return nothing;
    return html`
      <section class="summary" role="alert" aria-labelledby=${this.headingId}>
        <p id=${this.headingId} class="heading" data-heading>${this.heading}</p>
        <ul>
          ${this.errors.map((error) => html`<li>${error}</li>`)}
        </ul>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-form-error-summary": WtFormErrorSummary;
  }
}
