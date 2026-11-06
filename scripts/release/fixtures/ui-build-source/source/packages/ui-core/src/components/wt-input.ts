import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "../field-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import { formatDecimalInput, readDecimalInput } from "../decimal-input.js";

@customElement("wt-input")
export class WtInput extends LitElement {
  // Delegates .focus() on the host to the inner <input> — a POS constantly needs to
  // programmatically focus a specific field.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      .field.has-end .field-control {
        padding-inline-end: calc(var(--wt-tap-min) + var(--wt-space-3));
      }

      .field.has-end .field-label {
        inset-inline-end: calc(var(--wt-tap-min) + var(--wt-space-3));
      }

      .end {
        display: none;
        position: absolute;
        inset-block: 0;
        inset-inline-end: var(--wt-space-1);
        align-items: center;
      }

      .field.has-end .end {
        display: flex;
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property() type = "text";
  @property({ attribute: "decimal-locale" }) decimalLocale = "";
  @property() autocomplete = "";
  @property() placeholder = "";
  @property({ type: Number }) maxlength?: number;
  @property({ type: Number }) step?: number;
  @property() error = "";
  /** Shown as the placeholder unless one is given, and kept as the input's description because a
   * placeholder disappears once the field holds a value. */
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Shows a value that cannot be typed over, drawn as an editable field rather than a disabled one. */
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  /** Names the input by `label` without drawing it, and makes the field compact. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  @state() private hasEnd = false;

  // Unnamed legacy fields retain a generated id. Named fields use the semantic name for both native
  // attributes, so consumers never have to infer "email" from "wt-input-2". Each input owns its own
  // shadow root, so repeated names do not collide with another field's label association.
  private readonly generatedInputId = uniqueId("wt-input");
  private readonly errorId = uniqueId("wt-input-error");
  private readonly hintId = uniqueId("wt-input-hint");

  private onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value = this.decimalLocale ? readDecimalInput(input, this.decimalLocale) : input.value;
    if (this.decimalLocale) this.requestUpdate();
    dispatchWtChange(this, event, { value: this.value });
  }

  private onEndSlotChange(event: Event): void {
    this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
  }

  /** Selects the whole value, so typing replaces it. Does nothing before the first render. */
  select(): void {
    this.shadowRoot?.querySelector("input")?.select();
  }

  override render() {
    const hasError = this.error !== "";
    const hasHint = this.hint !== "";
    const describedBy = [...(hasHint ? [this.hintId] : []), ...(hasError ? [this.errorId] : [])];
    const inputId = this.name || this.generatedInputId;
    const labelState = fieldLabelState({
      value: this.value,
      hint: this.hint,
      placeholder: this.placeholder,
      type: this.type,
    });
    const showLabel = this.label !== "" && !this.hideLabel;
    return html`
      <div class="row">
        <div
          class=${this.hasEnd ? "field has-end" : "field"}
          part="field"
          data-label=${labelState}
          ?data-invalid=${this.invalid || hasError}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
        >
          ${showLabel ? fieldLabel(inputId, this.label, this.required) : nothing}
          <input
            class="field-control"
            id=${inputId}
            name=${this.name || nothing}
            .value=${this.decimalLocale ? live(formatDecimalInput(this.value, this.decimalLocale)) : this.value}
            type=${this.decimalLocale ? "text" : this.type}
            inputmode=${this.decimalLocale ? "decimal" : nothing}
            autocomplete=${this.autocomplete || nothing}
            placeholder=${this.placeholder || this.hint}
            maxlength=${this.maxlength ?? nothing}
            step=${this.step ?? nothing}
            aria-label=${this.hideLabel && this.label ? this.label : nothing}
            ?required=${this.required}
            ?disabled=${this.disabled}
            ?readonly=${this.readonly}
            aria-invalid=${this.invalid || hasError}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            @input=${this.onInput}
          />
          <slot class="end" name="end" @slotchange=${this.onEndSlotChange}></slot>
        </div>
        <slot name="help"></slot>
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-input": WtInput;
  }
}
