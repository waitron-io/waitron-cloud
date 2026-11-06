import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/** The look of a form's one message about a failed submission, for any shadow root that shows it. */
export const formMessageStyles = css`
  .form-message {
    display: block;
    width: 100%;
    max-width: var(--wt-field-max-width);
    margin: 0 0 var(--wt-space-2);
    color: var(--wt-color-danger);
    font-size: var(--wt-font-size-sm);
    text-align: start;
  }
`;

/** A form's one message about a failed submission, on its own line; nothing when it is empty.
 * Its shadow root must include `formMessageStyles`. */
export function formMessage(message: string) {
  return message === ""
    ? nothing
    : html`<p class="form-message" role="alert" data-error>${message}</p>`;
}

export type FormErrorEvent = CustomEvent<{ message: string }>;

@customElement("wt-form-actions")
export class WtFormActions extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
        width: 100%;
      }

      .actions {
        display: flex;
        align-items: center;
        width: 100%;
        gap: var(--wt-space-2);
      }

      .cancel {
        align-self: flex-end;
      }

      .primary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        margin-inline-start: auto;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The form's one message about a failed submission, shown on its own line above the actions. */
  @property() error = "";

  /** Off while a container shows `error` instead — `wt-dialog` does, above its footer's content. */
  @property({ attribute: false }) showError = true;

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has("error")) return;
    this.dispatchEvent(
      new CustomEvent("wt-form-error", {
        detail: { message: this.error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      ${this.showError ? formMessage(this.error) : nothing}
      <div class="actions" data-actions>
        <div class="cancel"><slot name="cancel"></slot></div>
        <div class="primary"><slot name="secondary"></slot><slot></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-form-actions": WtFormActions;
  }
  interface HTMLElementEventMap {
    "wt-form-error": FormErrorEvent;
  }
}
