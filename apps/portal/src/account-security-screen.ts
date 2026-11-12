import {accountActionProofScreen} from './account-action-proof-screen.ts';
import {authenticatorAccountScreen} from './authenticator-screen.ts';
import {html, nothing} from 'lit';
import '@waitron-io/ui-core/components/wt-button';
import {passkeyAccountScreen} from './passkey-screen.ts';
import type {PortalApp} from './app.ts';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';

export function accountSecurityScreen(app: PortalApp) {
  const c = app.copy;
  const message = app.security.error ?? app.security.notice;
  const dateTime = new Intl.DateTimeFormat(app.locale, {dateStyle: 'medium', timeStyle: 'short'});
  return html`<section class="account-security" aria-labelledby="account-security-heading">
    <h2 id="account-security-heading">${c.accountSecurity}</h2>
    <p>${c.accountSecurityIntro}</p>
    ${message ? html`<p role=${app.security.error ? 'alert' : 'status'}>${c[message]}</p>` : nothing}
    <section class="sessions" aria-labelledby="sessions-heading">
      <h3 id="sessions-heading">${c.activeSessions}</h3>
      <p class="help">${c.sessionsIntro}</p>
      ${app.security.error && !app.security.loaded ? html`<wt-button .disabled=${app.security.pending || !!app.security.waiting}
        @click=${() => {void app.security.load();}}>${c.retry}</wt-button>` : nothing}
      <ul class="session-list">${app.security.sessions.map(session => html`<li>
        <div class="security-details">
          <strong>${session.current ? c.currentSession : c.otherSession}</strong>
          <span><span class="security-label">${c.sessionSignedIn}</span> ${dateTime.format(new Date(session.createdAt))}</span>
          <span><span class="security-label">${c.sessionLastUsed}</span> ${dateTime.format(new Date(session.lastUsedAt))}</span>
          <span><span class="security-label">${c.sessionExpires}</span> ${dateTime.format(new Date(session.expiresAt))}</span>
        </div>
        <wt-button .disabled=${app.security.pending || !!app.security.waiting}
          @click=${() => {void app.revokeSession(session.id);}}>${session.current ? c.sessionSignOut : c.sessionRevoke}</wt-button>
      </li>`)}</ul>
    </section>
    ${accountActionProofScreen(app)}
    <section aria-labelledby="credentials-heading"><h3 id="credentials-heading">${c.credentialChanges}</h3>
      <p class="help">${c.credentialChangesHelp}</p>
      ${app.link.emailChangeToken ? html`<p>${c.emailChangeConfirm}</p><wt-button .disabled=${app.security.pending||!!app.security.waiting}
        @click=${()=>{void app.changeCredentials('verify');}}>${c.emailChangeVerify}</wt-button>`:nothing}
      <wt-input name="newAccountPassword" .type=${'password'} .autocomplete=${'new-password'} .label=${c.newPassword}
        .value=${app.security.newPassword} .disabled=${app.security.pending||!!app.security.waiting}
        @wt-change=${(e:CustomEvent<{value:string}>)=>{app.security.newPassword=e.detail.value;app.draw();}}
        @keydown=${(e:KeyboardEvent)=>submitOnEnter(e,app.root.querySelector('#change-password'))}></wt-input>
      <p class="help">${c.passwordHelp}</p><wt-button id="change-password" .disabled=${app.security.pending||!!app.security.waiting||!app.security.newPassword}
        @click=${()=>{void app.changeCredentials('password');}}>${c.savePassword}</wt-button>
      <wt-input name="newAccountEmail" .type=${'email'} .autocomplete=${'email'} .label=${c.newEmail}
        .value=${app.security.newEmail} .disabled=${app.security.pending||!!app.security.waiting}
        @wt-change=${(e:CustomEvent<{value:string}>)=>{app.security.newEmail=e.detail.value;app.draw();}}
        @keydown=${(e:KeyboardEvent)=>submitOnEnter(e,app.root.querySelector('#change-email'))}></wt-input>
      <wt-button id="change-email" .disabled=${app.security.pending||!!app.security.waiting||!app.security.newEmail}
        @click=${()=>{void app.changeCredentials('email');}}>${c.saveEmail}</wt-button>
    </section>
    ${passkeyAccountScreen(app)}${authenticatorAccountScreen(app)}
  </section>`;
}
