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
  cooldownPath = '';
  session: PortalSession;
  #route = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(root: HTMLElement) {
    this.root = root;
    this.link = this.#capture();
    let saved: string | null = null;
    try { saved = localStorage.getItem('cloud.locale'); } catch { /* Storage is optional. */ }
    this.locale = this.link.locale ?? chooseLocale(saved, navigator.languages);
    this.session = this.#session();
    window.addEventListener('popstate', () => this.navigate(location.pathname, false));
    document.addEventListener('keydown', event => { if (this.path === '/account') void this.session.activity(event); });
    document.addEventListener('pointerdown', event => { if (this.path === '/account') void this.session.activity(event); });
    window.addEventListener('pagehide', () => { this.session.dispose(); clearTimeout(this.#timer); }, {once: true});
    window.addEventListener('pageshow', event => {
      if (event.persisted) { this.session = this.#session(); void this.session.check(); }
    });
    this.draw(); void this.session.check();
  }
  #capture() { return captureLink(new URL(location.href), url => history.replaceState(null, '', url)); }
  #session() { return new PortalSession(state => this.#sessionChanged(state)); }
  #sessionChanged(state: SessionState) {
    if (this.path === '/' && state.kind === 'authenticated') this.navigate('/account');
    else if ((this.path === '/' || this.path === '/account') && state.kind === 'anonymous') this.navigate('/login');
    else this.draw();
  }
  get copy() { return translations[this.locale]; }
  get completion() { return (this.path === '/signup' && !!this.link.token) || this.path === '/reset-password'; }
  get waiting() {
    const deadline = ['/', '/account'].includes(this.path) ? this.session.retryAt : this.cooldownPath === this.path ? this.cooldownUntil : 0;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }
  draw() {
    document.documentElement.lang = this.locale;
    const title = this.title(); document.title = `${title} · Waitron Cloud`;
    render(screen(this), this.root);
    clearTimeout(this.#timer);
    if (this.waiting) this.#timer = setTimeout(() => this.draw(), 1000);
  }
  title(): string {
    const c = this.copy;
    if (this.notice) return c[this.notice === 'signupReady' ? 'completeSignup' : this.notice === 'resetReady' ? 'reset' : 'login'];
    if (this.requested) return c.checkEmail;
    if (this.path === '/signup') return c[this.link.token ? 'completeSignup' : 'signup'];
    if (this.path === '/forgot-password') return c.forgot;
    if (this.path === '/reset-password') return c.reset;
    if (this.path === '/account') return c.account;
    return c.login;
  }
  navigate(path: string, push = true) {
    this.#route++; this.path = path;
    if (push) history.pushState(null, '', path);
    this.link = this.#capture(); this.locale = this.link.locale ?? this.locale;
    this.fields = {email: '', password: '', legalBusinessName: '', organisationName: ''};
    this.errors = {}; this.error = undefined; this.notice = undefined; this.requested = false;
    this.pending = false; this.reveal = false; this.differentOrg = false;
    // Keep the cooldown across navigation so returning cannot bypass a Retry-After.
    this.draw(); this.focusHeading();
    if (path === '/account' || path === '/') void this.session.check();
  }
  follow(event: MouseEvent, path: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); this.navigate(path);
  }
  readFields() {
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
  async submit() {
    if (this.pending || this.waiting) return;
    this.readFields(); this.errors = {}; this.error = undefined;
    const f = this.fields;
    const emailNeeded = this.path === '/login' || !this.completion;
    const passwordNeeded = this.path === '/login' || this.completion;
    if (emailNeeded && (!f.email || f.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))) this.errors.email = 'emailError';
    if (passwordNeeded && (new TextEncoder().encode(f.password).length > 1024 || (this.completion ? [...f.password].length < 15 : !f.password)))
      this.errors.password = this.completion ? 'passwordHelp' : 'requiredPassword';
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
      if (path === '/login') { this.session.dispose(); this.session = this.#session(); this.navigate('/account'); return; }
      if (path.endsWith('/request')) { this.requested = true; this.cooldownPath = this.path; this.cooldownUntil = Date.now() + 60_000; }
      else { this.notice = path === '/signup/complete' ? 'signupReady' : 'resetReady'; this.link = {invalid: false}; this.fields.password = ''; }
    } else {
      this.cooldownPath = this.path; this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + result.retryAfterMs);
      if (path === '/login' && (result.status === 0 || result.status === 503)) {
        this.session.dispose(); this.session = this.#session(); await this.session.check();
        if (route !== this.#route) return;
        if (priorSession.kind === 'anonymous' && this.session.state.kind === 'authenticated') { this.navigate('/account'); return; }
      }
      this.error = result.code === 'link_unavailable' ? 'linkUnavailable'
        : result.code === 'credentials_invalid' ? 'credentials'
        : result.status === 429 ? 'limited' : result.status === 403 ? 'forbidden'
        : (result.status === 0 || result.status >= 500) ? (path.endsWith('/complete') ? 'uncertain' : 'unavailable') : 'invalid';
    }
    this.draw(); if (this.error) this.#focusErrors(); else this.focusHeading();
  }
  async logout() {
    if (this.pending || this.waiting) return;
    this.pending = true; this.error = undefined; this.draw();
    const route = this.#route;
    const success = await this.session.logout();
    // A confirmed anonymous session may already have routed to login.
    if (success) { if (this.path !== '/login') this.navigate('/login'); this.notice = 'signedOut'; }
    else if (route === this.#route) this.error = 'logoutFailed';
    this.pending = false; this.draw();
  }
}
