import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtIconSize = "sm" | "md" | "lg";

const registry = new Map<string, string>();

/** Registers icon path data by name. Values are the `d` attribute of a 16x16 SVG path. */
export function registerIcons(icons: Record<string, string>): void {
  for (const [name, path] of Object.entries(icons)) {
    registry.set(name, path);
  }
}

@customElement("wt-icon")
export class WtIcon extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
      }

      :host([size="sm"]) {
        width: var(--wt-font-size-sm);
        height: var(--wt-font-size-sm);
      }

      :host([size="lg"]) {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }

      svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }
    `,
  ];

  @property({ reflect: true }) name = "";
  @property({ reflect: true }) size: WtIconSize = "md";

  override render() {
    const path = registry.get(this.name);
    if (!path) return nothing;
    return html`
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d=${path}></path>
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-icon": WtIcon;
  }
}
