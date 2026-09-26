import {RecoveryController} from './recovery-controller.ts';
import {RemoteController} from './remote-controller.ts';
import {AlertController} from './alert-controller.ts';
import {BackupController} from './backup-controller.ts';
import {InstallationController} from './installation-controller.ts';
import { PairingController } from './pairing-controller.ts';
import {PasskeyController} from './passkey-controller.ts';
import { render } from 'lit';
import { accountRequest } from './api.ts';
import { captureLink, type CapturedLink } from './links.ts';
import { chooseLocale, translations, type Copy, type Locale } from './locale.ts';
import { PortalSession, type SessionState } from './session.ts';
import { screen } from './screens.ts';
export type Fields = {email: string; password: string; legalBusinessName: string; organisationName: string};
export class PortalApp {
  root: HTMLElement;
  path = location.pathname;
  link: CapturedLink;
  locale: Locale;
  fields: Fields = {email: '', password: '', legalBusinessName: '', organisationName: ''};
  errors: Partial<Record<keyof Fields, keyof Copy>> = {};
  error: keyof Copy | undefined;
  notice: keyof Copy | undefined;
  requested = false;
  differentOrg = false;
  reveal = false;
  pending = false;
  cooldownUntil = 0;
  cooldownOperation = '';
  session: PortalSession;
  pairing: PairingController;
  installations: InstallationController;
  backups: BackupController;
  recovery: RecoveryController;
  remote: RemoteController;
  alerts: AlertController;
  passkeys: PasskeyController;
  #route = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(root: HTMLElement) {
    this.root = root;
    this.link = this.#capture();
    let saved: string | null = null;
    try { saved = localStorage.getItem('cloud.locale'); } catch { /* Storage is optional. */ }
    this.locale = this.link.locale ?? chooseLocale(saved, navigator.languages);
    this.passkeys = new PasskeyController(() => this.draw());
    void this.passkeys.checkSupport();
    this.alerts = new AlertController(() => this.draw());
    this.remote = new RemoteController(() => this.draw());
    this.recovery = new RecoveryController(() => this.draw());
    this.recovery.open(this.link.recoveryId);
    this.backups = new BackupController(() => {
      const selected=this.backups.page?.points.find(p=>p.id===this.backups.selected&&p.verification==='verified');
      if(this.backups.selectedSource==='continuous'&&this.backups.page?.continuousRecovery)this.recovery.chooseContinuous(this.backups.venueId);
      else this.recovery.choose(this.backups.venueId,selected?.id);
      this.draw();
    });
    this.installations = new InstallationController(() => {
      if(this.remote.installationId&&!this.installations.visible.some(i=>i.installationId===this.remote.installationId&&i.canRevoke&&!i.revokedAt))this.remote.close();
      if(this.backups.venueId&&!this.installations.visible.some(i=>i.venueId===this.backups.venueId&&i.canRevoke)){this.backups.close();this.recovery.choose(undefined,undefined);}
      this.draw();
    });
    this.pairing = new PairingController(() => this.draw());
    this.pairing.open(this.link.requestId);
    this.session = this.#session();
    window.addEventListener('popstate', () => this.navigate(location.pathname, false));
    document.addEventListener('keydown', event => { if (['/account','/connect','/recover'].includes(this.path)) void this.session.activity(event); });
    document.addEventListener('pointerdown', event => { if (['/account','/connect','/recover'].includes(this.path)) void this.session.activity(event); });
    window.addEventListener('pagehide', () => { this.session.dispose(); this.pairing.account(undefined); this.installations.account(undefined); this.backups.account(undefined); this.recovery.account(undefined); this.remote.account(undefined); this.alerts.account(undefined); this.passkeys.account(undefined); clearTimeout(this.#timer); }, {once: true});
    window.addEventListener('pageshow', event => {
      if (event.persisted) { this.session = this.#session(); void this.session.check(); }
    });
    this.draw(); void this.session.check();
  }
  #capture() { return captureLink(new URL(location.href), url => history.replaceState(null, '', url)); }
  #session() { return new PortalSession(state => this.#sessionChanged(state)); }
  #sessionChanged(state: SessionState) {
    this.passkeys.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (['/account','/'].includes(this.path) && state.kind === 'authenticated' && !this.passkeys.loaded) void this.passkeys.load();
    this.recovery.account(state.kind === 'authenticated' ? state.accountId : undefined);
    this.alerts.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (['/account','/'].includes(this.path) && state.kind === 'authenticated' && !this.alerts.loaded) void this.alerts.load();
    this.remote.account(state.kind === 'authenticated' ? state.accountId : undefined);
    this.backups.account(state.kind === 'authenticated' ? state.accountId : undefined);
    this.installations.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (['/account','/','/recover'].includes(this.path) && state.kind === 'authenticated' && !this.installations.loaded) void this.installations.load();
    this.pairing.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (this.path === '/connect' && state.kind === 'authenticated' && !this.pairing.loaded) void this.pairing.load();
    if (this.path === '/' && state.kind === 'authenticated') this.navigate('/account');
    else if ((['/', '/account', '/connect', '/recover'].includes(this.path)) && state.kind === 'anonymous') this.navigate('/login');
    else this.draw();
  }
  get copy() { return translations[this.locale]; }
  get completion() { return (this.path === '/signup' && !!this.link.token) || this.path === '/reset-password'; }
  get operation() {
    if (this.path === '/signup') return this.link.token ? '/signup/complete' : '/signup/request';
    if (this.path === '/forgot-password') return '/password-reset/request';
    if (this.path === '/reset-password') return '/password-reset/complete';
    return this.path;
  }
  get waiting() {
    if (this.path === '/recover') return Math.max(this.recovery.waiting,this.backups.waiting,this.installations.waiting,Math.max(0,Math.ceil((this.session.retryAt-Date.now())/1000)));
    if (this.path === '/connect') return Math.max(this.pairing.waiting, Math.max(0, Math.ceil((this.session.retryAt - Date.now()) / 1000)));
    const deadline = ['/', '/account'].includes(this.path) ? Math.max(this.session.retryAt,this.installations.retryAt,this.backups.retryAt,this.alerts.retryAt,this.remote.retryAt) : this.cooldownOperation === this.operation ? this.cooldownUntil : 0;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }
  draw() {
    document.documentElement.lang = this.locale;
    const title = this.title(); document.title = `${title} · Waitron Cloud`;
    render(screen(this), this.root);
    clearTimeout(this.#timer);
    if (this.waiting || (['/account','/recover'].includes(this.path) && this.session.state.kind === 'authenticated')) this.#timer = setTimeout(() => this.draw(), 1000);
  }
  title(): string {
    const c = this.copy;
    if (this.path === '/recover') return c.recoveryTitle;
    if (this.path === '/connect') return c.connect;
    if (this.notice) return c[this.notice === 'signupReady' ? 'completeSignup' : this.notice === 'resetReady' ? 'reset' : 'login'];
    if (this.requested) return c.checkEmail;
    if (this.path === '/signup') return c[this.link.token ? 'completeSignup' : 'signup'];
    if (this.path === '/forgot-password') return c.forgot;
    if (this.path === '/reset-password') return c.reset;
    if (this.path === '/account') return c.account;
    return c.login;
  }
  navigate(path: string, push = true) {
    this.#route++; this.path = path; this.passkeys.fence();
    if (push) history.pushState(null, '', path);
    this.link = this.#capture();
    if (this.link.recoveryId || this.link.invalid) this.recovery.open(this.link.recoveryId);
    if (this.link.requestId || this.link.invalid) this.pairing.open(this.link.requestId);
    this.locale = this.link.locale ?? this.locale;
    this.fields = {email: '', password: '', legalBusinessName: '', organisationName: ''};
    this.errors = {}; this.error = undefined; this.notice = undefined; this.requested = false;
    this.pending = false; this.reveal = false; this.differentOrg = false;
    // Keep the cooldown across navigation so returning cannot bypass a Retry-After.
    this.draw(); this.focusHeading();
    if (['/account','/','/connect','/recover'].includes(path)) void this.session.check();
  }
  follow(event: MouseEvent, path: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); this.navigate(path);
  }
  readFields() {
    const passkeyPassword=this.root.querySelector('wt-input[name="passkeyPassword"]')?.shadowRoot?.querySelector('input')?.value;
    if(passkeyPassword!==undefined)this.passkeys.password=passkeyPassword;
    const recoveryCode=this.root.querySelector('wt-input[name="recoveryCode"]')?.shadowRoot?.querySelector('input')?.value;if(recoveryCode!==undefined)this.recovery.code=recoveryCode;
    const code = this.root.querySelector('wt-input[name="pairingCode"]')?.shadowRoot?.querySelector('input')?.value;
    if (code !== undefined) this.pairing.code = code;
    for (const key of Object.keys(this.fields) as (keyof Fields)[]) {
      const value = this.root.querySelector(`wt-input[name="${key}"]`)?.shadowRoot?.querySelector('input')?.value;
      if (value !== undefined) this.fields[key] = value;
    }
  }
  setLocale(locale: Locale) {
    this.readFields(); this.locale = locale;
    try { localStorage.setItem('cloud.locale', locale); } catch { /* The current tab still changes language. */ }
    this.draw();
  }
  focusHeading() { this.root.querySelector<HTMLElement>('h1')?.focus(); }
  #focusErrors() {
    queueMicrotask(() => {
      const field = Object.keys(this.errors)[0];
      if (field) this.root.querySelector<HTMLElement>(`wt-input[name="${field}"]`)?.focus();
      else this.root.querySelector<HTMLElement>('wt-form-error-summary')?.focus();
    });
  }
  async submitPairing() {
    this.readFields();
    if (this.pairing.view) await this.pairing.approve(); else await this.pairing.inspect();
    if (this.pairing.error) this.#focusErrors(); else this.focusHeading();
  }
  async submit() {
    if(this.path==='/recover'){this.readFields();await this.recovery.inspect();return;}
    if (['/','/account'].includes(this.path)) return;
    if (this.path === '/connect') { await this.submitPairing(); return; }
    if (this.pending || this.waiting) return;
    this.readFields(); this.errors = {}; this.error = undefined;
    const f = this.fields;
    const emailNeeded = this.path === '/login' || !this.completion;
    const passwordNeeded = this.path === '/login' || this.completion;
    if (emailNeeded && (!f.email || f.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))) this.errors.email = 'emailError';
    if (passwordNeeded && (new TextEncoder().encode(f.password).length > 1024 || (this.completion ? [...f.password].length < 15 : !f.password)))
      this.errors.password = new TextEncoder().encode(f.password).length > 1024 ? 'passwordLong' : this.completion ? 'passwordHelp' : 'requiredPassword';
    if (this.path === '/signup' && this.link.token) {
      const validName = (value: string) => value.length <= 200 && value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
      if (!validName(f.legalBusinessName)) this.errors.legalBusinessName = 'nameError';
      if (this.differentOrg && !validName(f.organisationName)) this.errors.organisationName = 'nameError';
    }
    if (Object.keys(this.errors).length) { this.draw(); this.#focusErrors(); return; }
    if (this.link.invalid || (this.path === '/reset-password' && !this.link.token)) return;
    let path: string; let body: Record<string, string>;
    if (this.path === '/login') { path = '/login'; body = {email: f.email, password: f.password}; }
    else if (this.path === '/signup' && this.link.token) {
      path = '/signup/complete'; body = {token: this.link.token, password: f.password,
        legalBusinessName: f.legalBusinessName.trim(), organisationName: (this.differentOrg ? f.organisationName : f.legalBusinessName).trim(), countryCode: 'ES'};
    } else if (this.path === '/reset-password') { path = '/password-reset/complete'; body = {token: this.link.token!, password: f.password, locale: this.locale}; }
    else { path = this.path === '/signup' ? '/signup/request' : '/password-reset/request'; body = {email: f.email, locale: this.locale}; }
    this.pending = true; const route = this.#route;
    const priorSession = {...this.session.state};
    this.draw();
    const result = await accountRequest(path, body);
    if (route !== this.#route) return;
    this.pending = false;
    if (result.ok) {
      if (path === '/login') { this.session.dispose(); this.session = this.#session(); this.navigate(this.recovery.requestId ? '/recover' : this.pairing.requestId ? '/connect' : '/account'); return; }
      if (path.endsWith('/request')) { this.requested = true; this.cooldownOperation = this.operation; this.cooldownUntil = Date.now() + 60_000; }
      else { this.notice = path === '/signup/complete' ? 'signupReady' : 'resetReady'; this.link = {invalid: false}; this.fields.password = ''; }
    } else {
      this.cooldownOperation = this.operation; this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + result.retryAfterMs);
      if (path === '/login' && (result.status === 0 || result.status === 503)) {
        this.session.dispose(); this.session = this.#session(); await this.session.check();
        if (route !== this.#route) return;
        if (priorSession.kind === 'anonymous' && this.session.state.kind === 'authenticated') { this.navigate(this.recovery.requestId ? '/recover' : this.pairing.requestId ? '/connect' : '/account'); return; }
      }
      if (result.code === 'password_compromised') this.errors.password = 'passwordCompromised';
      else this.error = result.code === 'link_unavailable' ? 'linkUnavailable'
        : result.code === 'credentials_invalid' ? 'credentials'
        : result.status === 429 ? 'limited' : result.status === 403 ? 'forbidden'
        : result.status === 0 ? (path.endsWith('/complete') ? 'uncertain' : 'unavailable')
        : result.status >= 500 ? (path.endsWith('/complete') && result.code !== 'temporarily_unavailable' ? 'uncertain' : 'unavailable') : 'invalid';
    }
    this.draw(); if (this.error || Object.keys(this.errors).length) this.#focusErrors(); else this.focusHeading();
  }
  async signInWithPasskey() {
    const route = this.#route;
    const result = await this.passkeys.signIn();
    if (route !== this.#route || !result) return;
    this.session.dispose(); this.session = this.#session();
    if (result === 'authenticated') { this.navigate(this.recovery.requestId ? '/recover' : this.pairing.requestId ? '/connect' : '/account'); return; }
    await this.session.check();
    if (route === this.#route && this.session.state.kind !== 'authenticated') this.draw();
  }
  async addPasskey() {
    this.readFields();
    if (!this.passkeys.password) { this.passkeys.error = 'requiredPassword'; this.draw(); return; }
    await this.passkeys.enroll(this.passkeys.password);
  }
  async removePasskey(id: string) {
    this.readFields();
    if (!this.passkeys.password) { this.passkeys.error = 'requiredPassword'; this.draw(); return; }
    await this.passkeys.remove(id, this.passkeys.password);
  }
  get logoutWaiting() { return Math.max(0, Math.ceil((this.session.retryAt - Date.now()) / 1000)); }
  async logout() {
    if (this.pending || this.logoutWaiting || this.pairing.pending || this.installations.pending || this.remote.pending || this.recovery.pending) return;
    this.pending = true; this.error = undefined; this.draw();
    const route = this.#route;
    const success = await this.session.logout();
    // A confirmed anonymous session may already have routed to login.
    if (success) { if (this.path !== '/login') this.navigate('/login'); this.notice = 'signedOut'; }
    else if (route === this.#route) this.error = 'logoutFailed';
    this.pending = false; this.draw();
  }
}
