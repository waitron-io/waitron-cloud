const singleLineTypes = new Set([
  "text",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** Bind to a form boundary or its fields, with that form's explicit submit control.
 * The native input comes from the composed path because wt-input has its own shadow root.
 * Clicking the existing control preserves its validation and in-flight guards.
 */
export function submitOnEnter(event: KeyboardEvent, button: HTMLElement | null): void {
  if (
    event.key !== "Enter" ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const input = event.composedPath()[0];
  if (!(input instanceof HTMLInputElement) || input.disabled || !singleLineTypes.has(input.type))
    return;
  if (button === null || ("disabled" in button && button.disabled === true)) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}
