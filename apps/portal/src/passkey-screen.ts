import {permissionActions} from './permission-actions.ts';
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
    <wt-button .disabled=${app.pending || app.passkeys.pending || !!app.passkeys.waiting} .loading=${app.passkeys.pending}
      @click=${() => {void app.signInWithPasskey();}}>${app.passkeys.pending ? c.wait : c.passkeySignIn}</wt-button>
  </div>`;
}

export function passkeyAccountScreen(app: PortalApp) {
  const c = app.copy;
  const message = app.passkeys.error ?? app.passkeys.notice;
  const check = app.passkeys.error === 'passkeyRegistrationRefused' || app.passkeys.error === 'passkeyRemovalRefused';
  const date = new Intl.DateTimeFormat(app.locale, {dateStyle: 'medium'});
  const dateTime = new Intl.DateTimeFormat(app.locale, {dateStyle: 'medium', timeStyle: 'short'});
  return html`<section class="passkeys" aria-labelledby="passkeys-heading">
    <h3 id="passkeys-heading">${c.passkeys}</h3>
    <p>${c.passkeyIntro}</p>
    ${message ? html`<p role=${app.passkeys.error ? 'alert' : 'status'}>${c[message]}</p>` : nothing}${permissionActions(app,app.passkeys.error)}
    ${check ? html`<wt-button .disabled=${app.passkeys.pending || !!app.passkeys.waiting}
      @click=${() => {void app.refreshPasskeys();}}>${c.passkeyRefresh}</wt-button>` : nothing}
    ${app.passkeys.listLoaded && !app.passkeys.passkeys.length ? html`<p>${c.passkeyNone}</p>` : nothing}
    ${app.passkeys.loaded && !app.passkeys.listLoaded && !check ? html`<wt-button .disabled=${app.passkeys.pending || !!app.passkeys.waiting}
      @click=${() => {void app.passkeys.load();}}>${c.retry}</wt-button>` : nothing}
    ${app.passkeys.passkeys.length ? html`<ul class="passkey-list">${app.passkeys.passkeys.map(passkey => html`<li>
      <span class="security-details"><span><span class="security-label">${c.passkeyCreated}</span> ${date.format(new Date(passkey.createdAt))}</span>
        <span><span class="security-label">${c.passkeyLastUsed}</span> ${passkey.lastUsedAt ? dateTime.format(new Date(passkey.lastUsedAt)) : c.passkeyNeverUsed}</span></span>
      <wt-button .disabled=${app.passkeys.pending || !!app.passkeys.waiting} @click=${() => {void app.removePasskey(passkey.id);}}>${c.passkeyRemove}</wt-button>
    </li>`)}</ul>` : nothing}
    ${app.passkeys.supported === false ? html`<p class="help" role="status">${c.passkeyUnsupported}</p>` : nothing}
    <wt-input name="passkeyPassword" .error=${app.passkeys.error === 'requiredPassword' ? c.requiredPassword : ''} .label=${c.passkeyCurrentPassword} .value=${app.passkeys.password} .type=${'password'}
      .autocomplete=${'current-password'} .disabled=${app.passkeys.pending || !!app.passkeys.waiting} .required=${true}
      @wt-change=${(event: CustomEvent<{value: string}>) => {
        app.passkeys.password = event.detail.value;
        if (app.passkeys.password && app.passkeys.error === 'requiredPassword') app.passkeys.error = undefined;
        app.draw();
      }}></wt-input>
    ${app.passkeys.supported === false ? nothing : html`<wt-form-actions>
      <wt-button .disabled=${app.passkeys.pending || !!app.passkeys.waiting || !app.passkeys.password} .loading=${app.passkeys.pending}
        @click=${() => {void app.addPasskey();}}>${app.passkeys.pending ? c.wait : c.passkeyAdd}</wt-button>
    </wt-form-actions>`}
  </section>`;
}
