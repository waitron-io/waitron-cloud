import {html, nothing} from 'lit';
import '@waitron-io/ui-core/components/wt-button';
import {passkeyAccountScreen} from './passkey-screen.ts';
import type {PortalApp} from './app.ts';

export function accountSecurityScreen(app: PortalApp) {
  const c = app.copy;
  const message = app.security.error ?? app.security.notice;
  const dateTime = new Intl.DateTimeFormat(app.locale, {dateStyle: 'medium', timeStyle: 'short'});
  return html`<section class="account-security" aria-labelledby="account-security-heading">
    <h2 id="account-security-heading">${c.accountSecurity}</h2>
    <p>${c.accountSecurityIntro}</p>
    <section class="sessions" aria-labelledby="sessions-heading">
      <h3 id="sessions-heading">${c.activeSessions}</h3>
      <p class="help">${c.sessionsIntro}</p>
      ${message ? html`<p role=${app.security.error ? 'alert' : 'status'}>${c[message]}</p>` : nothing}
      ${app.security.error && !app.security.loaded ? html`<wt-button .disabled=${app.security.pending}
        @click=${() => {void app.security.load();}}>${c.retry}</wt-button>` : nothing}
      <ul class="session-list">${app.security.sessions.map(session => html`<li>
        <div class="security-details">
          <strong>${session.current ? c.currentSession : c.otherSession}</strong>
          <span><span class="security-label">${c.sessionSignedIn}</span> ${dateTime.format(new Date(session.createdAt))}</span>
          <span><span class="security-label">${c.sessionLastUsed}</span> ${dateTime.format(new Date(session.lastUsedAt))}</span>
          <span><span class="security-label">${c.sessionExpires}</span> ${dateTime.format(new Date(session.expiresAt))}</span>
        </div>
        <wt-button .disabled=${app.security.pending || app.passkeys.pending}
          @click=${() => {void app.revokeSession(session.id);}}>${session.current ? c.sessionSignOut : c.sessionRevoke}</wt-button>
      </li>`)}</ul>
    </section>
    ${passkeyAccountScreen(app)}
  </section>`;
}
