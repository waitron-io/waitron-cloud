import {fiscalAllocationScreen} from './fiscal-allocation-screen.ts';
import {authenticatorLoginScreen,authenticatorCodesScreen} from './authenticator-screen.ts';
import {recoveryScreen} from './recovery-screen.ts';
import {installationScreen} from './installation-screen.ts';
import { pairingScreen } from './pairing-screen.ts';
import {passkeySignInScreen} from './passkey-screen.ts';
import {accountSecurityScreen} from './account-security-screen.ts';
import { html, nothing } from 'lit';
import { submitOnEnter } from '@waitron-io/ui-core/submit-on-enter';
import '@waitron-io/ui-core/components/wt-card';
import '@waitron-io/ui-core/components/wt-input';
import '@waitron-io/ui-core/components/wt-button';
import '@waitron-io/ui-core/components/wt-form-actions';
import '@waitron-io/ui-core/components/wt-form-error-summary';
import '@waitron-io/ui-core/components/wt-spinner';
import type { PortalApp, Fields } from './app.ts';
import type { Copy, Locale } from './locale.ts';
export function screen(app: PortalApp) {
  const c = app.copy;
  const link = (path: string, label: string) => html`<a href=${path} @click=${(event: MouseEvent) => app.follow(event, path)}>${label}</a>`;
  const field = (key: keyof Fields, label: keyof Copy, type = 'text', autocomplete = '') => html`
    <wt-input name=${key} .label=${c[label]} .value=${app.fields[key]} .type=${type} .autocomplete=${autocomplete}
      .disabled=${app.pending||app.authenticator.pending} .required=${true} .error=${app.errors[key] ? c[app.errors[key]!] : ''}
      @wt-change=${(event: CustomEvent<{value: string}>) => {app.fields[key] = event.detail.value;}}>
      ${key === 'password' ? html`<button type="button" slot="end" class="reveal" aria-label=${app.reveal ? c.hide : c.show}
        @click=${() => {app.readFields(); app.reveal = !app.reveal; app.draw();}}>${app.reveal ? c.hide : c.show}</button>` : nothing}
    </wt-input>`;
  const password = () => field('password', app.completion ? 'newPassword' : 'password', app.reveal ? 'text' : 'password', app.completion ? 'new-password' : 'current-password');
  const action = (label: string, fn = () => {void app.submit();}) => html`<wt-form-actions><wt-button variant="primary" id="submit" .disabled=${!!app.waiting || app.pending||app.authenticator.pending}
    .loading=${app.pending} @click=${fn}>${app.pending ? c.wait : label}</wt-button></wt-form-actions>`;
  const retryLink = app.path === '/signup' ? '/signup' : '/forgot-password';
  let content;
  if (app.path === '/fiscal-allocations') content = fiscalAllocationScreen(app);
  else if (app.path === '/recover') content = recoveryScreen(app);
  else if (app.path === '/connect') content = pairingScreen(app);
  else if (app.path === '/login' && app.factorCodes.length) content = authenticatorCodesScreen(app);
  else if (app.path === '/login' && app.authenticator.challenge) content = authenticatorLoginScreen(app);
  else if (app.notice && !['signedOut', 'sessionExpired','factorChanged','factorRemoved','factorChangeUncertain'].includes(app.notice)) content = html`<p role="status">${c[app.notice]}</p>${link('/login', c.login)}`;
  else if (app.path === '/' || app.path === '/account') {
    content = app.session.state.kind === 'authenticated'
      ? html`<p>${c.accountIntro}</p><p>${link('/fiscal-allocations',c.fiscalTitle)}</p>${accountSecurityScreen(app)}${installationScreen(app)}<wt-form-actions><wt-button .disabled=${app.logoutDisabled||app.diagnostics.pending} @click=${()=>{void app.logout();}}>${c.signout}</wt-button></wt-form-actions><p>${link('/forgot-password', c.forgot)}</p>`
      : html`<p role="status">${app.session.state.kind === 'unavailable' ? c.sessionUnavailable : c.checking}</p>
          ${app.session.state.kind === 'unavailable' ? html`<wt-button .disabled=${!!app.waiting} @click=${() => {void app.session.check();}}>${c.retry}</wt-button>` : html`<wt-spinner .label=${c.checking}></wt-spinner>`}`;
  } else if (app.link.invalid || (app.path === '/reset-password' && !app.link.token)) {
    content = html`<p>${app.link.invalid ? c.linkUnavailable : c.missingLink}</p><nav>${link(retryLink, c.requestLink)} ${link('/login', c.login)}</nav>`;
  } else if (app.requested) {
    content = html`<p role="status">${c.emailSent}</p>${action(c.resend)}
      <button class="text-button" type="button" ?disabled=${app.pending} @click=${() => {app.requested = false; app.error = undefined; app.draw(); app.focusHeading();}}>${c.changeEmail}</button>`;
  } else if (app.path === '/login') {
    content = html`${app.notice ? html`<p role="status">${c[app.notice]}</p>` : nothing}${field('email', 'email', 'email', 'username')}${password()}
      ${app.passkeys.notice && app.passkeys.notice !== 'passkeyUnsupported' ? html`<p role="status">${c[app.passkeys.notice]}</p>` : nothing}
      ${action(c.login)}${passkeySignInScreen(app)}<nav>${link('/forgot-password', c.forgot)}<span>${c.signupLink} ${link('/signup', c.signup)}</span></nav>`;
  } else if (app.path === '/signup' && app.link.token) {
    content = html`${password()}<p class="help">${c.passwordHelp}</p>${field('legalBusinessName', 'legalName', 'text', 'organization')}
      <p class="help">${c.soleTrader}</p>
      <label class="disclosure"><input type="checkbox" .checked=${app.differentOrg} ?disabled=${app.pending}
        @change=${(event: Event) => {app.readFields(); app.differentOrg = (event.target as HTMLInputElement).checked; app.draw();}}> ${c.differentOrg}</label>
      ${app.differentOrg ? field('organisationName', 'orgName') : nothing}<p>${c.country}: <strong>${c.spain}</strong></p>${action(c.create)}`;
  } else if (app.path === '/reset-password') content = html`${password()}<p class="help">${c.passwordHelp}</p>${action(c.savePassword)}`;
  else content = html`<p>${app.path === '/signup' ? c.emailIntro : c.resetIntro}</p>${field('email', 'email', 'email', 'email')}
    ${action(app.path === '/signup' ? c.continue : c.sendReset)}<p>${c.loginLink} ${link('/login', c.login)}</p>`;
  const errors = [...Object.values(app.errors).map(key => c[key!]), ...(app.error ? [c[app.error]] : []), ...(app.path==='/login' && app.authenticator.error ? [c[app.authenticator.error]] : []), ...(app.path === '/login' && app.passkeys.error ? [c[app.passkeys.error]] : []), ...(app.path === '/connect' && app.pairing.error ? [c[app.pairing.error]] : [])];
  return html`<header><a class="brand" href="/" @click=${(event: MouseEvent) => app.follow(event, '/')}>Waitron <strong>Cloud</strong></a>
    <label class="language">${c.language}<select aria-label=${c.language} .value=${app.locale}
      @change=${(event: Event) => app.setLocale((event.target as HTMLSelectElement).value as Locale)}><option value="en">English</option><option value="es">Español</option></select></label></header>
    <main><wt-card><h1 tabindex="-1">${app.title()}</h1>
      <form novalidate @submit=${(event: Event) => {event.preventDefault(); void app.submit();}}
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, app.root.querySelector('#submit'))}>
        <wt-form-error-summary tabindex="-1" .heading=${c.errors} .errors=${errors}></wt-form-error-summary>
        ${content}
        ${app.error === 'uncertain' || app.error === 'linkUnavailable' ? html`<nav>${link('/login', c.login)} ${link(retryLink, c.requestLink)}</nav>` : nothing}
        ${app.waiting ? html`<p class="help" role="status">${app.path==='/fiscal-allocations'?c.fiscalCooldown:c.cooldown} ${app.waiting} ${app.waiting===1?c.second:c.seconds}</p>` : nothing}
      </form></wt-card></main>`;
}
