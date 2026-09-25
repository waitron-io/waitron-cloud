import {html, nothing} from 'lit';
import '@waitron-io/ui-core/components/wt-input';
import '@waitron-io/ui-core/components/wt-button';
import '@waitron-io/ui-core/components/wt-form-actions';
import type {PortalApp} from './app.ts';

export function passkeySignInScreen(app: PortalApp) {
  const c = app.copy;
  return html`<div class="passkey-signin">
    <p class="separator"><span>${c.passkeys}</span></p>
    ${app.passkeys.supported === false ? html`<p class="help" role="status">${c.passkeyUnsupported}</p>` : nothing}
    <wt-button .disabled=${app.pending || app.passkeys.pending} .loading=${app.passkeys.pending}
      @click=${() => {void app.signInWithPasskey();}}>${app.passkeys.pending ? c.wait : c.passkeySignIn}</wt-button>
  </div>`;
}

export function passkeyAccountScreen(app: PortalApp) {
  const c = app.copy;
  const message = app.passkeys.error ?? app.passkeys.notice;
  const date = new Intl.DateTimeFormat(app.locale, {dateStyle: 'medium'});
  return html`<section class="passkeys" aria-labelledby="passkeys-heading">
    <h2 id="passkeys-heading">${c.passkeys}</h2>
    <p>${c.passkeyIntro}</p>
    ${message ? html`<p role=${app.passkeys.error ? 'alert' : 'status'}>${c[message]}</p>` : nothing}
    ${app.passkeys.loaded && !app.passkeys.passkeys.length ? html`<p>${c.passkeyNone}</p>` : nothing}
    ${app.passkeys.passkeys.length ? html`<ul class="passkey-list">${app.passkeys.passkeys.map(passkey => html`<li>
      <span>${c.passkeyCreated} ${date.format(new Date(passkey.createdAt))}</span>
      <wt-button .disabled=${app.passkeys.pending} @click=${() => {void app.removePasskey(passkey.id);}}>${c.passkeyRemove}</wt-button>
    </li>`)}</ul>` : nothing}
    ${app.passkeys.supported === false ? html`<p class="help" role="status">${c.passkeyUnsupported}</p>` : html`
      <wt-input name="passkeyPassword" .label=${c.passkeyCurrentPassword} .value=${app.passkeys.password} .type=${'password'}
        .autocomplete=${'current-password'} .disabled=${app.passkeys.pending} .required=${true}
        @wt-change=${(event: CustomEvent<{value: string}>) => {app.passkeys.password = event.detail.value;}}></wt-input>
      <wt-form-actions><wt-button .disabled=${app.passkeys.pending || !app.passkeys.password} .loading=${app.passkeys.pending}
        @click=${() => {void app.addPasskey();}}>${app.passkeys.pending ? c.wait : c.passkeyAdd}</wt-button></wt-form-actions>`}
  </section>`;
}
