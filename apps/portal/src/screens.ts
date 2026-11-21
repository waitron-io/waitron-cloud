import {accountBusinessesScreen} from './account-businesses-screen.ts';
import {ownerRecoveryScreen} from './owner-recovery-screen.ts';
import {ownerTransferScreen} from './owner-transfer-screen.ts';
import {cloudActionsScreen} from './cloud-actions-screen.ts';
import {accountActionProofScreen} from './account-action-proof-screen.ts';
import {billingScreen} from './billing-screen.ts';
import {rememberBrowserChoice,authenticatorAccountScreen,authenticatorLoginScreen,authenticatorCodesScreen} from './authenticator-screen.ts';
import {recoveryScreen} from './recovery-screen.ts';
import {installationScreen} from './installation-screen.ts';
import { pairingScreen } from './pairing-screen.ts';
import {passkeyAccountScreen,passkeySignInScreen} from './passkey-screen.ts';
import {accountSecurityScreen} from './account-security-screen.ts';
import { html, nothing } from 'lit';
import { submitOnEnter } from '@waitron-io/ui-core/submit-on-enter';
import '@waitron-io/ui-core/components/wt-card';
import '@waitron-io/ui-core/components/wt-input';
import '@waitron-io/ui-core/components/wt-button';
import '@waitron-io/ui-core/components/wt-form-actions';
import '@waitron-io/ui-core/components/wt-form-error-summary';
import '@waitron-io/ui-core/components/wt-spinner';
import type {PortalApp, Fields} from './app.ts';
import type { Copy, Locale } from './locale.ts';
// ISO 3166-1 alpha-2 codes; Intl also names regions that are not countries.
const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
export const accountPages = {
  '/account': 'account',
  '/account/venues': 'venues',
  '/account/remote-access': 'remoteAccess',
  '/account/billing': 'billing',
} as const;

export function screen(app: PortalApp) {
  const c = app.copy;
  const countryNames = new Intl.DisplayNames([app.locale], {type: 'region'});
  const countries = countryCodes.map(code => ({code, name: countryNames.of(code)!})).sort((a, b) => a.name.localeCompare(b.name, app.locale));
  const link = (path: string, label: string) => html`<a href=${path} @click=${(event: MouseEvent) => app.follow(event, path)}>${label}</a>`;
  const field = (key: keyof Fields, label: keyof Copy, type = 'text', autocomplete = '') => html`
    <wt-input name=${key} .label=${c[label]} .value=${app.fields[key]} .type=${type} .autocomplete=${autocomplete}
      .disabled=${app.pending||app.authenticator.pending} .required=${true} .error=${app.errors[key] ? c[app.errors[key]!] : ''}
      @wt-change=${(event: CustomEvent<{value: string}>) => {app.fields[key] = event.detail.value; delete app.errors[key]; app.draw();}}>
      ${key === 'password' ? html`<button type="button" slot="end" class="reveal" aria-label=${app.reveal ? c.hide : c.show}
        @click=${() => {app.readFields(); app.reveal = !app.reveal; app.draw();}}>${app.reveal ? c.hide : c.show}</button>` : nothing}
    </wt-input>`;
  const password = () => field('password', app.completion ? 'newPassword' : 'password', app.reveal ? 'text' : 'password', app.completion ? 'new-password' : 'current-password');
  const action = (label: string, fn = () => {void app.submit();}) => html`<wt-form-actions><wt-button variant="primary" id="submit" .disabled=${!!app.waiting || app.pending||app.authenticator.pending || (app.path === '/login' && app.passkeys.pending)}
    .loading=${app.pending} @click=${fn}>${app.pending ? c.wait : label}</wt-button></wt-form-actions>`;
  const retryLink = app.path === '/signup' ? '/signup' : '/forgot-password';
  const accountPage = app.accountPage;
  const state = app.session.state;
  const accountNav = accountPage && state.kind === 'authenticated' && !state.enrollmentRequired
    ? html`<nav class="account-nav" aria-label=${c.accountNav}><ul role="list">
      ${Object.entries(accountPages).filter(([, page]) => page !== 'billing' || state.billingTrialAvailable === true)
        .map(([path, page]) => html`<li><a href=${path} aria-current=${page === accountPage ? 'page' : nothing}
          @click=${(event: MouseEvent) => app.follow(event, path, true)}>${c[page === 'account' ? 'accountLink' : page]}</a></li>`)}
      </ul></nav>` : nothing;
  let content;
  const hasSetupMethod = app.setupPairing && (app.passkeys.passkeys.length > 0 || app.authenticator.status?.active);
  const enrollmentHelp = app.setupPairing ? (hasSetupMethod ? c.pairSetupSignInAgain : c.pairSetupEnroll) : c.enrollmentRequiredHelp;
  if (app.enrollmentPage) content = html`<p>${enrollmentHelp}</p>
    <section aria-labelledby="enrollment-security-heading"><h2 id="enrollment-security-heading">${c.accountSecurity}</h2>
      ${accountActionProofScreen(app)}${passkeyAccountScreen(app)}${authenticatorAccountScreen(app)}</section>
    <wt-form-actions>${hasSetupMethod ? link('/login', c.login) : nothing}<wt-button .disabled=${app.logoutDisabled}
      @click=${() => {void app.logout();}}>${c.signout}</wt-button></wt-form-actions>`;
  else if(app.path==='/operator/actions')content=cloudActionsScreen(app);
  else if (app.path === '/recover') content = recoveryScreen(app);
  else if (app.path === '/connect') content = pairingScreen(app);
  else if (app.path === '/login' && app.factorCodes.length) content = authenticatorCodesScreen(app);
  else if (app.path === '/login' && app.authenticator.challenge) content = authenticatorLoginScreen(app);
  else if (app.notice && !['signedOut', 'sessionExpired','factorChanged','factorRemoved','factorChangeUncertain'].includes(app.notice)) content = html`<p role="status">${c[app.notice]}</p>${link('/login', c.login)}`;
  else if (accountPage) {
    const signout = html`<wt-form-actions><wt-button .disabled=${app.logoutDisabled || app.diagnostics.pending}
      @click=${() => {void app.logout();}}>${c.signout}</wt-button></wt-form-actions>`;
    const accountContent = () => {
      switch (accountPage) {
        case 'account': return html`<p>${c.accountIntro}</p>${accountBusinessesScreen(app, countries, countryNames)}${accountSecurityScreen(app)}${ownerTransferScreen(app)}${signout}<p>${link('/forgot-password', c.forgot)}</p>`;
        case 'venues': return html`${installationScreen(app)}${signout}`;
        case 'remoteAccess': return html`${installationScreen(app, true)}${app.remote.installationId ? accountActionProofScreen(app, 2) : nothing}${signout}`;
        case 'billing': return html`${billingScreen(app)}${app.billing.venue?.paymentMethods ? accountActionProofScreen(app, 2) : nothing}${signout}`;
      }
    };
    content = state.kind === 'authenticated'
      ? accountContent()
      : html`<p role="status">${state.kind === 'unavailable' ? c.sessionUnavailable : c.checking}</p>
          ${state.kind === 'unavailable' ? html`<wt-button .disabled=${!!app.waiting} @click=${() => {void app.session.check();}}>${c.retry}</wt-button>` : html`<wt-spinner .label=${c.checking}></wt-spinner>`}`;
  } else if(app.path==='/reset-password'&&app.ownerRecovery.stage!=='idle')content=ownerRecoveryScreen(app);
  else if (app.link.invalid || (app.path === '/reset-password' && !app.link.token)) {
    content = html`<p>${app.link.invalid ? c.linkUnavailable : c.missingLink}</p><nav>${link(retryLink, c.requestLink)} ${link('/login', c.login)}</nav>`;
  } else if (app.requested) {
    content = html`<p role="status">${c.emailSent}</p>${app.setupPairing ? html`<p>${c.pairSetupEmail}</p>` : nothing}${action(c.resend)}
      <button class="text-button" type="button" ?disabled=${app.pending} @click=${() => {app.requested = false; app.error = undefined; app.draw(); app.focusHeading();}}>${c.changeEmail}</button>
      ${app.setupPairing ? html`<p>${link('/login', c.login)}</p>` : nothing}`;
  } else if (app.path === '/login') {
    content = html`${app.notice ? html`<p role="status">${c[app.notice]}</p>` : nothing}${app.passkeyFirst ? passkeySignInScreen(app) : nothing}${field('email', 'email', 'email', 'username webauthn')}${password()}
      ${app.passkeys.notice && app.passkeys.notice !== 'passkeyUnsupported' ? html`<p role="status">${c[app.passkeys.notice]}</p>` : nothing}
      ${action(c.login)}${app.passkeyFirst ? nothing : passkeySignInScreen(app)}<nav>${link('/forgot-password', c.forgot)}<span>${c.signupLink} ${link('/signup', c.signup)}</span></nav>`;
  } else if (app.path === '/signup' && app.link.token) {
    content = html`${password()}<p class="help">${c.passwordHelp}</p>
      <label class="disclosure"><input type="checkbox" name="receivingBusiness" .checked=${app.receivingBusiness} ?disabled=${app.pending}
        @change=${(event:Event)=>{app.readFields();app.receivingBusiness=(event.target as HTMLInputElement).checked;delete app.errors.legalBusinessName;delete app.errors.organisationName;app.error=undefined;app.draw();}}> ${c.receivingBusiness}</label>
      ${app.receivingBusiness?nothing:html`${field('legalBusinessName', 'legalName', 'text', 'organization')}
      <p class="help">${c.soleTrader}</p>
      <label class="disclosure"><input type="checkbox" .checked=${app.differentOrg} ?disabled=${app.pending}
        @change=${(event: Event) => {app.readFields(); app.differentOrg = (event.target as HTMLInputElement).checked; if (!app.differentOrg) delete app.errors.organisationName; app.draw();}}> ${c.differentOrg}</label>
      ${app.differentOrg ? field('organisationName', 'orgName') : nothing}<label class="business-choice" for="signup-country">${c.country}<select id="signup-country" name="countryCode" autocomplete="country" ?disabled=${app.pending}
        @change=${(event: Event) => {app.readFields(); app.countryCode = (event.target as HTMLSelectElement).value; app.refusedCountry = undefined; if(app.error === 'countryUnavailable')app.error = undefined; app.draw();}}>
        ${countries.map(country => html`<option value=${country.code} .selected=${country.code === app.countryCode}>${country.name}</option>`)}</select></label>`}${rememberBrowserChoice(app)}${action(c.create)}`;
  } else if (app.path === '/reset-password') content = html`${password()}<p class="help">${c.passwordHelp}</p>${action(c.savePassword)}<button type="button" class="text-button" ?disabled=${app.ownerRecovery.pending} @click=${()=>{void app.beginOwnerRecovery();}}>${c.ownerRecoveryLost}</button>`;
  else content = html`<p>${app.path === '/signup' ? c.emailIntro : c.resetIntro}</p>${field('email', 'email', 'email', 'email')}
    ${action(app.path === '/signup' ? c.continue : c.sendReset)}<p>${c.loginLink} ${link('/login', c.login)}</p>`;
  const errors = [...Object.values(app.errors).map(key => c[key!]), ...(app.error ? [app.error === 'countryUnavailable' ? c.countryUnavailable.replace('{country}', countryNames.of(app.refusedCountry!)!) : c[app.error]] : []), ...(app.path==='/login' && app.authenticator.error ? [c[app.authenticator.error]] : []), ...(app.path === '/login' && app.passkeys.error ? [c[app.passkeys.error]] : []), ...(app.path === '/connect' && app.pairing.error ? [c[app.pairing.error]] : [])];
  return html`<header><a class="brand" href="/" @click=${(event: MouseEvent) => app.follow(event, '/')}>Waitron <strong>Cloud</strong></a>
    <label class="language">${c.language}<select aria-label=${c.language} .value=${app.locale}
      @change=${(event: Event) => app.setLocale((event.target as HTMLSelectElement).value as Locale)}><option value="en">English</option><option value="es">Español</option></select></label></header>
    ${accountNav}<main><wt-card><h1 tabindex="-1">${app.title()}</h1>
      <form novalidate @submit=${(event: Event) => {event.preventDefault(); void app.submit();}}
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, app.root.querySelector('#submit'))}>
        <wt-form-error-summary tabindex="-1" .heading=${c.errors} .errors=${errors}></wt-form-error-summary>
        ${app.setupPairing && app.path === '/login' && !app.enrollmentPage && !app.authenticator.challenge && !app.factorCodes.length ? html`<p class="help">${c.pairSetupMethods}</p>` : nothing}
        ${content}
        ${app.setupPairing ? html`<button type="button" class="text-button" ?disabled=${app.pending || app.passkeys.pending || app.authenticator.pending}
          @click=${() => {void app.returnToSetup(true);}}>${c.pairSetupBack}</button>` : nothing}
        ${app.error === 'uncertain' || app.error === 'linkUnavailable' ? html`<nav>${link('/login', c.login)} ${link(retryLink, c.requestLink)}</nav>` : nothing}
        ${app.waiting ? html`<p class="help" role="status">${c.cooldown} ${app.waiting} ${app.waiting===1?c.second:c.seconds}</p>` : nothing}
      </form></wt-card></main>`;
}
