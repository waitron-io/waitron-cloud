import {AccountActionProofController} from './account-action-proof-controller.ts';
import {bodyRefusal} from './body-refusal.ts';
import {validEmail} from './email.ts';
import {AuthenticatorController} from './authenticator-controller.ts';
import {RecoveryController} from './recovery-controller.ts';
import {RemoteController} from './remote-controller.ts';
import {TranslationConsentController} from './translation-consent-controller.ts';
import {AlertController} from './alert-controller.ts';
import {BackupController} from './backup-controller.ts';
import {InstallationController} from './installation-controller.ts';
import { PairingController } from './pairing-controller.ts';
import {PasskeyController} from './passkey-controller.ts';
import {AccountSecurityController} from './account-security-controller.ts';
import {UsageController} from './usage-controller.ts';
import {BillingController} from './billing-controller.ts';
import {DiagnosticController} from './diagnostic-controller.ts';
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
  #serverCooldowns = new Map<string, number>();
  #emailCooldowns = new Map<string, number>();
  session: PortalSession;
  pairing: PairingController;
  installations: InstallationController;
  backups: BackupController;
  recovery: RecoveryController;
  remote: RemoteController;
  alerts: AlertController;
  translationConsent: TranslationConsentController;
  passkeys: PasskeyController;
  passkeyFirst: boolean;
  security: AccountSecurityController;
  authenticator: AuthenticatorController;
  actionProof:AccountActionProofController;
  factorCodes: string[] = [];
  usage: UsageController;
  billing: BillingController;
  diagnostics: DiagnosticController;
  #route = 0;
  #passkeyOffered = false;
  #enrollmentRestricted = false;
  #signOutCheck: PortalSession | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(root: HTMLElement) {
    this.root = root;
    this.link = this.#capture();
    let saved: string | null = null;
    try { saved = localStorage.getItem('cloud.locale'); } catch { /* Storage is optional. */ }
    this.locale = this.link.locale ?? chooseLocale(saved, navigator.languages);
    this.actionProof=new AccountActionProofController(()=>{
      if(!this.actionProof.pending&&this.actionProof.status?.freshUntil&&(this.remote?.error==='actionProofUnavailable'||this.remote?.error==='remoteProofRequired'))this.remote.error=undefined;
      if(!this.actionProof.pending&&this.actionProof.status?.methods.some(m=>m==='app'||m==='passkey')&&this.billing?.error==='pairEnrollment')this.billing.error=undefined;
      if(!this.actionProof.pending&&this.actionProof.status?.freshUntil&&(this.billing?.error==='actionProofUnavailable'||this.billing?.error==='billingProofRequired'))this.billing.error=undefined;
      if(!this.actionProof.pending&&this.actionProof.status?.methods.some(m=>m==='app'||m==='passkey')&&this.recovery?.error==='pairEnrollment')this.recovery.error=undefined;
      if(!this.actionProof.pending&&this.actionProof.status?.freshUntil&&(this.recovery?.error==='actionProofUnavailable'||this.recovery?.error==='recoveryProofRequired'))this.recovery.error=undefined;
      this.draw();
    });
    this.authenticator = new AuthenticatorController(() => this.draw());
    this.passkeys = new PasskeyController(() => this.draw());
    this.passkeyFirst = this.passkeys.preferred;
    this.security = new AccountSecurityController(() => this.draw(), async reason => {
      const session = this.session;
      const credentialNotice=this.security.notice;
      if (reason === 'signedOut') this.#signOutCheck = session;
      // Revocation needs a read started after the write, not an older session snapshot.
      try { await session.check({fresh: reason === 'signedOut'}); }
      finally { if (this.#signOutCheck === session) this.#signOutCheck = undefined; }
      if(this.session===session&&session.state.kind==='anonymous'&&(credentialNotice==='passwordChanged'||credentialNotice==='emailChanged')){this.notice=credentialNotice;this.draw();}
    });
    void this.passkeys.checkSupport();
    this.alerts = new AlertController(() => this.draw());
    this.translationConsent = new TranslationConsentController(() => this.draw());
    this.usage = new UsageController(() => this.draw());
    this.billing = new BillingController(() => this.draw());
    this.diagnostics = new DiagnosticController(() => this.draw());
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
      this.usage.organisation(this.installations.selectedOrganisation);
      if(this.session?.state.kind==='authenticated'&&this.usage.organisationId&&!this.usage.loaded)void this.usage.load();
      if(this.remote.installationId&&!this.installations.visible.some(i=>i.installationId===this.remote.installationId&&i.canRevoke&&!i.revokedAt))this.remote.close();
      if(this.backups.venueId&&!this.installations.visible.some(i=>i.venueId===this.backups.venueId&&i.canRevoke)){this.backups.close();this.recovery.choose(undefined,undefined);}
      this.draw();
    });
    this.pairing = new PairingController(() => this.draw());
    this.pairing.open(this.link.requestId);
    this.session = this.#session();
    window.addEventListener('popstate', () => this.navigate(location.pathname, false));
    document.addEventListener('keydown', event => { if (['/account','/connect','/recover'].includes(this.path)) void this.session.activity(event); }, true);
    document.addEventListener('pointerdown', event => { if (['/account','/connect','/recover'].includes(this.path)) void this.session.activity(event); });
    window.addEventListener('pagehide', () => { this.actionProof.account(undefined); this.billing.account(undefined); this.remote.account(undefined); this.session.dispose(); this.authenticator.account(undefined); this.authenticator.fence(); this.factorCodes = []; this.fields.password = ''; this.root.querySelectorAll('canvas').forEach(canvas => {canvas.width=0;}); this.draw(); this.pairing.account(undefined); this.installations.account(undefined); this.backups.account(undefined); this.recovery.account(undefined); this.alerts.account(undefined); this.translationConsent.account(undefined); this.usage.account(undefined); this.diagnostics.account(undefined); this.passkeys.account(undefined); this.passkeys.fence(); this.security.account(undefined); clearTimeout(this.#timer); }, {once: true});
    window.addEventListener('pageshow', event => {
      if (event.persisted) { this.session = this.#session(); void this.session.check(); }
    });
    this.draw(); void this.session.check();
  }
  #capture() { return captureLink(new URL(location.href), url => history.replaceState(null, '', url)); }
  #session() { return new PortalSession(state => this.#sessionChanged(state)); }
  #sessionChanged(state: SessionState) {
    const restricted = state.kind === 'authenticated' && state.enrollmentRequired === true;
    // A restriction can follow a method change on the same account; reload its setup controls.
    if (restricted && !this.#enrollmentRestricted) { this.passkeys.account(undefined); this.authenticator.account(undefined); }
    this.#enrollmentRestricted = restricted;
    const ordinary = state.kind === 'authenticated' && !state.enrollmentRequired;
    if (state.kind === 'authenticated') this.#passkeyOffered = false;
    // Redirect before starting reads so navigation cannot discard their replies.
    if (this.path === '/' && state.kind === 'authenticated') this.navigate('/account');
    this.actionProof.account(state.kind==='authenticated'?state.accountId:undefined);
    if(state.kind==='authenticated'&&(['/', '/account'].includes(this.path)||state.enrollmentRequired)&&!this.actionProof.loaded&&!this.actionProof.pending)void this.actionProof.load();
    this.authenticator.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (state.kind === 'authenticated' && (['/account','/'].includes(this.path) || state.enrollmentRequired) && !this.authenticator.loadAttempted) void this.authenticator.load();
    this.diagnostics.account(ordinary ? state.accountId : undefined);
    this.usage.account(ordinary ? state.accountId : undefined);
    const billingAccount=ordinary && state.billingTrialAvailable === true ? state.accountId : undefined;
    this.billing.account(billingAccount);
    if (['/account','/'].includes(this.path) && billingAccount && !this.billing.loadAttempted) void this.billing.load();
    this.security.account(ordinary ? state.accountId : undefined);
    if (['/account','/'].includes(this.path) && ordinary && !this.security.loadAttempted) void this.security.load();
    this.passkeys.account(state.kind === 'authenticated' ? state.accountId : undefined);
    if (state.kind === 'authenticated' && (['/account','/'].includes(this.path) || state.enrollmentRequired) && !this.passkeys.loaded) void this.passkeys.load();
    this.recovery.account(ordinary ? state.accountId : undefined);
    this.alerts.account(ordinary ? state.accountId : undefined);
    if (['/account','/'].includes(this.path) && ordinary && !this.alerts.loaded && !this.alerts.loadAttempted) void this.alerts.load();
    this.translationConsent.account(ordinary ? state.accountId : undefined);
    if (['/account','/'].includes(this.path) && ordinary && !this.translationConsent.loaded && !this.translationConsent.loadAttempted) void this.translationConsent.load();
    this.remote.account(ordinary ? state.accountId : undefined);
    this.backups.account(ordinary ? state.accountId : undefined);
    this.installations.account(ordinary ? state.accountId : undefined);
    if (['/account','/','/recover'].includes(this.path) && ordinary && !this.installations.loaded) void this.installations.load();
    this.pairing.account(ordinary ? state.accountId : undefined);
    if (this.path === '/connect' && ordinary && !this.pairing.loaded) void this.pairing.load();
    if ((['/', '/account', '/connect', '/recover'].includes(this.path)) && state.kind === 'anonymous') {
      const signedOut = this.#signOutCheck === this.session;
      this.navigate('/login');
      if (state.expired || signedOut) { this.notice = state.expired ? 'sessionExpired' : 'signedOut'; this.draw(); }
    }
    else this.draw();
    this.#offerPasskeys();
  }
  #offerPasskeys() {
    if (this.path !== '/login' || this.session.state.kind !== 'anonymous' || !this.passkeys.preferred || this.#passkeyOffered) return;
    this.#passkeyOffered = true;
    void this.signInWithPasskey(true);
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
    if (this.path === '/recover') return Math.max(this.recovery.waiting, this.backups.waiting, this.installations.waiting, this.session.waiting);
    if (this.path === '/connect') return Math.max(this.pairing.waiting, this.session.waiting);
    if (['/', '/account'].includes(this.path)) return Math.max(this.session.waiting, this.authenticator.waiting, this.passkeys.waiting, this.security.waiting,
      this.installations.waiting, this.backups.waiting, this.alerts.waiting, this.translationConsent.waiting, this.remote.waiting, this.usage.waiting, this.billing.waiting, this.diagnostics.waiting);
    const deadline = Math.max(this.#emailCooldowns.get(`${this.operation}:${this.fields.email.trim().toLowerCase()}`) ?? 0,
      this.#serverCooldowns.get(this.operation) ?? 0);
    return Math.max(0, Math.ceil((deadline - performance.now()) / 1000), this.path === '/login' ? Math.max(this.authenticator.waiting, this.passkeys.waiting) : 0);
  }
  draw() {
    this.remote.expireForward();
    // Account can inspect production backups; recovery accepts only its offered test venues.
    if(this.path==='/recover'&&this.backups.venueId&&!this.installations.visible.some(i=>i.venueId===this.backups.venueId&&i.canRevoke&&i.environment==='test')){this.backups.close();this.recovery.choose(undefined,undefined);}
    document.documentElement.lang = this.locale;
    const title = this.title(); document.title = `${title} · Waitron Cloud`;
    render(screen(this), this.root);
    clearTimeout(this.#timer);
    if (this.waiting || (['/account','/recover'].includes(this.path) && this.session.state.kind === 'authenticated')) this.#timer = setTimeout(() => this.draw(), 1000);
  }
  title(): string {
    const c = this.copy;
    if (this.session.state.kind === 'authenticated' && this.session.state.enrollmentRequired) return c.enrollmentRequiredTitle;
    if (this.path === '/login' && this.factorCodes.length) return c.factorCodesTitle;
    if (this.path === '/login' && this.authenticator.challenge) return 'emailRequired' in this.authenticator.challenge?(this.authenticator.proofKind==='recovery'&&!this.authenticator.challenge.rememberBrowserAllowed?c.factorRecovery:c.emailCheckTitle):c.factorTitle;
    if (this.path === '/recover') return c.recoveryTitle;
    if (this.path === '/connect') return c.connect;
    if (this.notice) return c[this.notice === 'signupReady' ? 'completeSignup' : this.notice === 'resetReady' ? 'reset' : 'login'];
    if (this.requested) return c.checkEmail;
    if (this.path === '/signup') return c[this.link.token ? 'completeSignup' : 'signup'];
    if (this.path === '/forgot-password') return c.forgot;
    if (this.path === '/reset-password') return c.reset;
    if (['/', '/account'].includes(this.path)) return c.account;
    return c.login;
  }
  navigate(path: string, push = true) {
    this.#signOutCheck = undefined;
    this.billing.fence();
    if (path === '/login') this.passkeyFirst = this.passkeys.preferred;
    this.actionProof.fence();this.#route++; this.path = path; this.passkeys.fence(); this.security.fence(); this.authenticator.fence(); this.factorCodes = [];
    // Only failed preferences need a new navigation attempt; pending work keeps its attempt.
    if(!this.alerts.pending&&!this.alerts.loaded)this.alerts.loadAttempted=false;
    if(!this.translationConsent.pending&&!this.translationConsent.loaded)this.translationConsent.loadAttempted=false;
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
    this.#offerPasskeys();
  }
  follow(event: MouseEvent, path: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); this.navigate(path);
  }
  readFields() {
    for(const [name,key] of [['newAccountPassword','newPassword'],['newAccountEmail','newEmail']] as const){
      const value=this.root.querySelector(`wt-input[name="${name}"]`)?.shadowRoot?.querySelector('input')?.value;if(value!==undefined)this.security[key]=value;
    }
    for (const [name,key] of [['factorPassword','password'],['factorProof','proofCode'],['factorConfirmation','confirmation']] as const) {
      const value=this.root.querySelector(`wt-input[name="${name}"]`)?.shadowRoot?.querySelector('input')?.value;
      if(value!==undefined)this.authenticator[key]=value;
    }
    const actionCode=this.root.querySelector('wt-input[name=actionProofCode]')?.shadowRoot?.querySelector('input')?.value;if(actionCode!==undefined)this.actionProof.code=actionCode;
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
    if(this.pairing.view?.state==='awaiting_cloud'&&this.pairing.businesses.some(b=>b.legalBusinessId===this.pairing.selected)){
      if(this.pairing.error==='pairEnrollment')this.pairing.error=undefined;
      const proved=await this.#requireActionProof();
      if(this.actionProof.status?.methods.every(m=>m==='email')){this.pairing.error='pairEnrollment';this.draw();return;}
      if(!proved)return;
    }
    if (this.pairing.view) await this.pairing.approve(); else await this.pairing.inspect();
    if (this.pairing.error) this.#focusErrors(); else this.focusHeading();
  }
  async approveRecovery(){
    const recovery=this.recovery,view=recovery.view;
    if(!view||view.state!=='awaiting_owner'||recovery.pending||recovery.waiting)return;
    const proved=await this.#requireActionProof();
    if(recovery.view!==view)return;
    if(this.actionProof.status?.methods.every(m=>m==='email'))recovery.error='pairEnrollment';
    else if(!proved)recovery.error=this.actionProof.error?'actionProofUnavailable':'recoveryProofRequired';
    else {await recovery.approve();return;}
    this.draw();
  }
  async startPaymentMethod(kind:'card'|'direct_debit'){
    const billing=this.billing,venue=billing.venue;
    if(!venue?.paymentMethods||billing.pending||billing.waiting)return;
    const proved=await this.#requireActionProof();
    if(billing.venue!==venue)return;
    if(this.actionProof.status?.methods.every(m=>m==='email'))billing.error='pairEnrollment';
    else if(!proved)billing.error=this.actionProof.error?'actionProofUnavailable':'billingProofRequired';
    else {await billing.startMethod(kind);return;}
    this.draw();
  }
  async applyRemote() {
    const remote=this.remote,change=remote.confirmation,id=remote.installationId;
    if(!change||remote.pending||remote.waiting)return;
    const proved=await this.#requireActionProof();
    if(remote.installationId!==id||remote.confirmation!==change)return;
    if(this.actionProof.status?.methods.every(m=>m==='email'))remote.error='pairEnrollment';
    else if(!proved)remote.error=this.actionProof.error?'actionProofUnavailable':'remoteProofRequired';
    else {await remote.apply();return;}
    this.draw();
  }
  async submit() {
    if(this.path==='/login' && this.authenticator.challenge){await this.completeFactorLogin();return;}
    if(this.path==='/login' && this.factorCodes.length)return;
    if(this.path==='/recover'){this.readFields();await this.recovery.inspect();return;}
    if (['/','/account'].includes(this.path)) return;
    if (this.path === '/connect') { await this.submitPairing(); return; }
    if (this.pending || this.waiting || (this.path === '/login' && this.passkeys.pending)) return;
    this.readFields(); this.errors = {}; this.error = undefined;
    if (this.path === '/login') this.passkeys.fence();
    const f = this.fields;
    const emailNeeded = this.path === '/login' || !this.completion;
    const passwordNeeded = this.path === '/login' || this.completion;
    if (emailNeeded) f.email = f.email.trim();
    if (emailNeeded && !validEmail(f.email)) this.errors.email = 'emailError';
    if (passwordNeeded && (new TextEncoder().encode(f.password).length > 1024 || (this.completion ? [...f.password].length < 15 : !f.password)))
      this.errors.password = new TextEncoder().encode(f.password).length > 1024 ? 'passwordLong' : this.completion ? 'passwordHelp' : 'requiredPassword';
    if (this.path === '/signup' && this.link.token) {
      const validName = (value: string) => value.length <= 200 && value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
      if (!validName(f.legalBusinessName)) this.errors.legalBusinessName = 'nameError';
      if (this.differentOrg && !validName(f.organisationName)) this.errors.organisationName = 'nameError';
    }
    if (Object.keys(this.errors).length) { this.draw(); this.#focusErrors(); return; }
    if (this.link.invalid || (this.path === '/reset-password' && !this.link.token)) return;
    if(this.path==='/login'){
      const route=this.#route;const previouslyAnonymous=this.session.state.kind==='anonymous';const result=await this.authenticator.startLogin(f.email,f.password,this.locale);this.fields.password='';
      if(route!==this.#route)return;await this.#factorLoginResult(result,route,previouslyAnonymous);return;
    }
    let path: string; let body: Record<string, string>;
    if (this.path === '/signup' && this.link.token) {
      path = '/signup/complete'; body = {token: this.link.token, password: f.password,
        legalBusinessName: f.legalBusinessName.trim(), organisationName: (this.differentOrg ? f.organisationName : f.legalBusinessName).trim(), countryCode: 'ES',...(this.authenticator.rememberBrowser?{rememberBrowser:'true'}:{})};
    } else if (this.path === '/reset-password') { path = '/password-reset/complete'; body = {token: this.link.token!, password: f.password, locale: this.locale}; }
    else { path = this.path === '/signup' ? '/signup/request' : '/password-reset/request'; body = {email: f.email, locale: this.locale}; }
    this.pending = true; const route = this.#route;
    this.draw();
    const result = await accountRequest(path, body);
    // A late reply still sets the wait for the operation that sent it.
    if (!result.ok) this.#serverCooldowns.set(path, Math.max(this.#serverCooldowns.get(path) ?? 0, performance.now() + result.retryAfterMs));
    if (route !== this.#route) return;
    this.pending = false;
    if (result.ok) {
      if (path.endsWith('/request')) { this.requested = true; this.#emailCooldowns.set(`${this.operation}:${body.email!.trim().toLowerCase()}`, performance.now() + 60_000); }
      else { this.notice = path === '/signup/complete' ? 'signupReady' : 'resetReady'; this.link = {invalid: false}; this.fields.password = ''; }
    } else {
      const cause = bodyRefusal(result);
      if (cause) this.error = `${path==='/signup/complete'?'accountCreate':path==='/password-reset/complete'?'accountPassword':path==='/password-reset/request'?'accountReset':'account'}Request${cause}`;
      else if (result.code === 'password_compromised') this.errors.password = 'passwordCompromised';
      else this.error = result.code === 'link_unavailable' ? 'linkUnavailable'
        : result.code === 'credentials_invalid' ? 'credentials'
        : result.status === 429 ? 'limited' : result.status === 403 ? 'forbidden'
        : result.status === 0 ? (path.endsWith('/complete') ? 'uncertain' : 'unavailable')
        : result.status >= 500 ? (path.endsWith('/complete') && result.code !== 'temporarily_unavailable' ? 'uncertain' : 'unavailable') : 'invalid';
    }
    this.draw(); if (this.error || Object.keys(this.errors).length) this.#focusErrors(); else this.focusHeading();
  }
  async #factorLoginResult(result:'authenticated'|'factor'|'reconcile'|false,route:number,previouslyAnonymous:boolean) {
    if(result==='authenticated'){this.session.dispose();this.session=this.#session();this.navigate(this.recovery.requestId?'/recover':this.pairing.requestId?'/connect':'/account');return;}
    if(result==='reconcile'){
      this.session.dispose();this.session=this.#session();await this.session.check();
      if(route!==this.#route)return;
      if(previouslyAnonymous&&this.session.state.kind==='authenticated'){this.navigate(this.recovery.requestId?'/recover':this.pairing.requestId?'/connect':'/account');return;}
    }
    this.draw();if(this.authenticator.error)this.#focusErrors();else this.focusHeading();
  }
  async completeFactorLogin(){this.readFields();const route=this.#route;const previouslyAnonymous=this.session.state.kind==='anonymous';const result=await this.authenticator.completeLogin();if(route===this.#route)await this.#factorLoginResult(result,route,previouslyAnonymous);}
  async manageFactor(action:'begin'|'activate'|'regenerate'|'remove'|'cancel'|'refresh',passkeyRecovery=false){
    this.readFields();const route=this.#route;
    if(!['activate','cancel','refresh'].includes(action)&&!await this.#requireActionProof())return;
    if(route!==this.#route)return;
    if(action==='begin'||action==='cancel'||action==='refresh'){await this.authenticator[action]();if(route===this.#route){this.draw();this.focusHeading();}return;}
    const result=await this.authenticator[action]();if(route!==this.#route)return;
    if(!result){
      if(passkeyRecovery&&this.authenticator.error){
        this.passkeys.error=this.authenticator.error==='credentials'?'passkeyPasswordInvalid':this.authenticator.error;this.authenticator.error=undefined;this.draw();
        const alert=this.root.querySelector<HTMLElement>('.passkeys [role=alert]');if(alert){alert.tabIndex=-1;alert.focus();}
      }
      return;
    }
    const codes=typeof result==='object'&&result.recoveryCodes?[...result.recoveryCodes]:[];
    this.session.dispose();this.session=this.#session();
    // Clear ended account authority before the login view can start another sign-in.
    this.#sessionChanged(this.session.state);this.navigate('/login');
    // Keep the committed one-time reply in this view after navigation fences all earlier authority.
    this.factorCodes=codes;this.notice=result==='reconcile'?'factorChangeUncertain':action==='remove'?'factorRemoved':action==='regenerate'?'recoveryCodesChanged':'factorChanged';this.draw();this.focusHeading();
    void this.session.check();
  }
  async signInWithPasskey(autofill = false) {
    const route = this.#route;
    this.authenticator.fence();this.factorCodes=[];
    const result = await this.passkeys.signIn(autofill);
    if (route !== this.#route || !result) return;
    this.session.dispose(); this.session = this.#session();
    if (result === 'authenticated') { this.navigate(this.recovery.requestId ? '/recover' : this.pairing.requestId ? '/connect' : '/account'); return; }
    await this.session.check();
    if (route === this.#route && this.session.state.kind !== 'authenticated') this.draw();
  }
  async #requireActionProof(){
    const route=this.#route,account=this.session.state.kind==='authenticated'?this.session.state.accountId:undefined;
    if(await this.actionProof.ensure()&&route===this.#route)return true;
    if(route===this.#route&&this.session.state.kind==='authenticated'&&this.session.state.accountId===account){this.draw();this.root.querySelector<HTMLElement>('#action-proof-heading')?.focus();}
    return false;
  }
  async proveWithPasskey(){
    const route=this.#route,account=this.session.state.kind==='authenticated'?this.session.state.accountId:undefined;const result=await this.passkeys.signIn(false,true);if(route!==this.#route||this.session.state.kind!=='authenticated'||this.session.state.accountId!==account)return;
    this.passkeys.error=undefined;this.passkeys.notice=undefined;
    await this.actionProof.load();if(route!==this.#route||this.session.state.kind!=='authenticated'||this.session.state.accountId!==account)return;if(!result||!this.actionProof.status?.freshUntil)this.actionProof.error='actionProofUnavailable';this.draw();
  }
  async refreshPasskeys() {
    const route = this.#route;
    await this.passkeys.refresh();
    if (route === this.#route) { this.draw(); this.focusHeading(); }
  }
  async addPasskey() {
    this.readFields();
    if(!await this.#requireActionProof())return;
    await this.passkeys.enroll('');await this.actionProof.load();
    if (this.session.state.kind === 'authenticated' && this.session.state.enrollmentRequired) await this.session.check({fresh: true});
  }
  async removePasskey(id: string) {
    this.readFields();
    if(!await this.#requireActionProof())return;
    await this.passkeys.remove(id, '');await this.actionProof.load();
    if (this.passkeys.notice === 'passkeyRemoved') await this.session.check({fresh: true});
  }
  async revokeSession(id: string) { await this.security.revoke(id); }
  async changeCredentials(kind:'password'|'email'|'verify'){
    this.readFields();if(kind!=='verify'&&!await this.#requireActionProof())return;
    await this.security.change(kind,this.locale,this.link.emailChangeToken);
  }
  get logoutWaiting() { return this.session.waiting; }
  // Share admission with the buttons so startup reads cannot leave an enabled, ignored sign-out.
  get logoutDisabled() { return this.pending || !!this.logoutWaiting || this.pairing.pending || this.installations.pending || this.remote.pending || this.recovery.pending || this.security.pending || this.usage.pending || this.billing.pending || this.authenticator.pending; }
  async logout() {
    if (this.logoutDisabled) return;
    this.pending = true; this.error = undefined; this.draw();
    const route = this.#route;
    const success = await this.session.logout();
    // Failed sign-out feedback belongs to the view that started it.
    if (!success && route !== this.#route) return;
    // A confirmed anonymous session may already have routed to login.
    if (success) { if (this.path !== '/login') this.navigate('/login'); this.notice = 'signedOut'; }
    else this.error = this.session.logoutCause ? `logoutRequest${this.session.logoutCause}` : 'logoutFailed';
    this.pending = false; this.draw();
    if (!success && this.error) this.#focusErrors();
  }
}
