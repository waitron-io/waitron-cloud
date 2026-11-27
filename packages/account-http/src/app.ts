import {isHostname} from '@waitron-cloud/remote-access/manifest';
import {AccountBusinessStore} from '@waitron-cloud/registration';
import {accountBusinessPaths, accountBusinessResponse} from './account-businesses.ts';
import {ownerRecoveryResponse} from './owner-recovery.ts';
import {OwnerRecoveryStore} from '@waitron-cloud/registration';
import {ownerTransferResponse} from './owner-transfer.ts';
import {OwnerTransferStore,OwnerTransferError} from '@waitron-cloud/registration';
import {CloudActions} from '@waitron-cloud/registration';
import {CloudActionError} from '@waitron-cloud/registration';
import {cloudActionsResponse} from './cloud-actions.ts';
import {operatorVenuesResponse} from './operator-venues.ts';
import {GuestMenuMachine} from '@waitron-cloud/remote-access/guest-menu';
import {guestMenuDeliveryResponse,guestMenuResponse} from './guest-menu.ts';
import {validateGuestOrigin} from './guest-menu-server.ts';
import {AccountActionProofStore,AccountActionProofError,AccountSecurityStore,AccountSecurityError} from '@waitron-cloud/registration';
import {accountSecurityResponse} from './account-security.ts';
import {accountActionProofResponse} from './account-action-proof.ts';
import {billingMethodsResponse,validateBillingMethodsOptions,type BillingMethodsOptions} from './billing-methods.ts';
import {billingAccountPaths,billingAccountResponse} from './billing-account.ts';
import {validateBillingAccountOptions,type BillingAccountOptions} from './config.ts';
import {BoxErrorReports} from '@waitron-cloud/registration';
import {boxErrorResponse} from './box-error-reports.ts';
import {TunnelProvisionMachine,tunnelProvisionResponse,type TunnelProvisionOptions} from './tunnel-provision.ts';
import {AddressLookupMachine,addressLookupResponse,warnAboutAddressCap,type AddressLookupOptions} from './address-lookup.ts';
import {createBillingDisplayMachine,billingDisplayResponse,type BillingDisplayOptions} from './billing-display.ts';
import {validateAllowanceOptions,type AllowanceOptions,type PlanMode} from '@waitron-cloud/registration';
import {TranslationMachine} from '@waitron-cloud/translation';
import {translationPaths,translationResponse} from './translation.ts';
import {RelayMessages,type RelayAdmissionConfig} from '@waitron-cloud/registration';
import {relayMessageResponse} from './relay-messages.ts';
import {StaffCertificateExchange} from '@waitron-cloud/remote-access/staff-exchange';
import {staffCertificateResponse} from './staff-certificates.ts';
import {recoveryCodeKeysFromEnv,type RecoveryCodeKeys} from '@waitron-cloud/backups/recovery-codes';
import {replacementResponse} from './replacement.ts';
import {diagnosticsResponse} from './diagnostics.ts';
import {usageResponse} from './usage.ts';
import {securityAuditResponse} from './security-audit.ts';
import {accountSessionResponse} from './account-sessions.ts';
import {passkeyResponse} from './passkeys.ts';
import {authenticatorResponse} from './authenticator-factor.ts';
import {recoveryResponse} from './recovery.ts';
import {remoteAccessResponse,type RemoteResolver} from './remote-access.ts';
import {venueEmailResponse} from './venue-email.ts';
import {BackupCaptures,type CaptureOptions} from '@waitron-cloud/backups/captures';
import {BackupCatalogue,type ExitRangeOptions} from '@waitron-cloud/backups/catalogue';
import {captureResponse} from './captures.ts';
import {ManagedStreamMachines,managedStreamResponse} from './managed-streams.ts';
import {alertPreferencesResponse} from './alerts.ts';
import {translationConsentResponse} from './translation-consent.ts';
import {backupResponse,exitDownloadSession} from './backups.ts';
import {sentReportsResponse} from './sent-reports.ts';
import {installationResponse} from './installations.ts';
import {InstallationError,SecurityAuditError,UsageError,migrationNames,type LeaseIssuer} from '@waitron-cloud/registration';
import {pairingResponse} from './pairing.ts';
import {PairingError,RegistrationError} from '@waitron-cloud/registration';
import { securityHeaders } from './portal.ts';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import type { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { endSession, IdentityError, resolveSession, withEnrollmentPolicy } from '@waitron-cloud/identity';
import { EmailOutbox, pairingCodeKeysFromEnv, type PairingCodeKeys, PasskeyStore, PasswordRecoveryError, PasswordRecoveryStore, SignupError, SignupStore, normaliseEmail, transaction, type PasskeyCeremonyAdapter, type PasswordScreeningProvider } from '@waitron-cloud/registration';
import { type AccountHttpConfig, validateConfig, factorConfigFromEnv, validateFactorConfig, type FactorConfig } from './config.ts';
import {AuthenticatorFactorStore,PasswordLoginStore,FactorError,SignInCheckError} from '@waitron-cloud/registration';
import { AccountRateLimiter, type RateRule } from './rate-limit.ts';
import {admitSignup, warnAboutSignupVolume} from './signup-limits.ts';
import { clientAddress } from './client-address.ts';
import { readAccountBody } from './request.ts';
import { readSessionCookie, writeSessionCookies, readBrowserCookie } from './cookies.ts';
import { AccountHttpError } from './errors.ts';
import {createTurnstileGuard, turnstileAction} from './turnstile.ts';
const paths: Record<string, readonly string[]> = {
  '/signup/request': ['email'], '/signup/complete': ['token', 'password'],
  '/login': ['email', 'password'], '/session/activity': [], '/logout': [],
  '/password-reset/request': ['email'], '/password-reset/complete': ['token', 'password'],
};
function protect(c: Context) {
  for (const [name, value] of Object.entries(securityHeaders)) c.header(name, value);
}
function publicError(error: unknown): AccountHttpError {
  if (error instanceof AccountHttpError) return error;
  if(error instanceof FactorError||error instanceof SignInCheckError)return new AccountHttpError(error.code==='temporarily_unavailable'?503:401,error.code,error.code==='temporarily_unavailable'?1:undefined);
  if(error instanceof OwnerTransferError)return new AccountHttpError(error.code==='transfer_unavailable'?404:error.code==='invalid_input'?400:409,error.code);
  if(error instanceof CloudActionError)return new AccountHttpError(error.code==='conflict'?409:400,error.code);
  if(error instanceof AccountActionProofError)return new AccountHttpError(403,'proof_required');
  if(error instanceof AccountSecurityError)return new AccountHttpError(400,'link_unavailable');
  if (error instanceof IdentityError) {
    if (error.code === 'credentials_invalid') return new AccountHttpError(401, 'credentials_invalid');
    if (error.code === 'csrf_invalid') return new AccountHttpError(403, 'forbidden');
    if (error.code === 'enrollment_required') return new AccountHttpError(403, 'enrollment_required');
    if (error.code === 'permission_denied') return new AccountHttpError(403, 'permission_denied');
    if (error.code === 'session_expired') return new AccountHttpError(401, 'session_expired');
    return new AccountHttpError(401, 'unauthenticated');
  }
  if (error instanceof InstallationError) return new AccountHttpError(error.code==='invalid_proof'?401:error.code==='revoked'||error.code==='permission_denied'?403:error.code==='unavailable'?503:400,error.code);
  if (error instanceof PairingError) return new AccountHttpError(error.code === 'invalid_proof' ? 401 : error.code === 'permission_denied' ? 403 : 400, error.code);
  if (error instanceof RegistrationError) return new AccountHttpError(
    error.code === 'permission_denied' ? 403 : error.code === 'business_match_ambiguous' ? 409 : 400, error.code);
  if (error instanceof SecurityAuditError) return new AccountHttpError(error.code==='permission_denied'?403:error.code==='invalid_input'?400:409,error.code==='security_audit_conflict'?'conflict':error.code);
  if (error instanceof UsageError) return new AccountHttpError(error.code==='permission_denied'?403:error.code==='invalid_input'?400:409,error.code==='usage_conflict'?'conflict':error.code);
  if (error instanceof SignupError || error instanceof PasswordRecoveryError) {
    if(error.code==='country_unavailable')return new AccountHttpError(400,'country_unavailable');
    if (error.code === 'password_compromised') return new AccountHttpError(400, 'password_compromised');
    if (error.code === 'password_screening_unavailable') return new AccountHttpError(503, 'temporarily_unavailable', 1);
    return new AccountHttpError(400, ['verification_unavailable', 'reset_unavailable'].includes(error.code) ? 'link_unavailable' : 'invalid_input');
  }
  return new AccountHttpError(503, 'temporarily_unavailable', 1);
}
export function createAccountApp(options: {operatorAccountId?:string;operatorVenues?:boolean;guestOrigin?:string;liveGuestMenu?:boolean;venueMailDnsSuffix?:string;pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;factor?:FactorConfig;relay?:RelayAdmissionConfig;staffCertificates?:boolean;translation?:boolean;translationMachine?:TranslationMachine;leaseIssuer?:LeaseIssuer;leaseTrust?:ReadonlyMap<string,string>;billingDisplay?:BillingDisplayOptions;billingAccount?:BillingAccountOptions;billingMethods?:BillingMethodsOptions;addressLookup?:AddressLookupOptions;tunnelProvision?:TunnelProvisionOptions;captures?:CaptureOptions;exitRanges?:ExitRangeOptions;planMode?:PlanMode;allowances?:AllowanceOptions;remoteResolve?:RemoteResolver;passwordScreening?:PasswordScreeningProvider;turnstileFetch?:typeof fetch;passkeyAdapter?:PasskeyCeremonyAdapter;pairingCodeKeys?:PairingCodeKeys|null;recoveryCodeKeys?:RecoveryCodeKeys|null}) {
  const allowances=validateAllowanceOptions(options.allowances,options.planMode??'existing');
  const config = validateConfig(options.config);
  const venueMailDnsSuffix=options.venueMailDnsSuffix;
  if(venueMailDnsSuffix!==undefined&&(config.production||options.planMode!=='test-venue-levels'||!isHostname(venueMailDnsSuffix)||venueMailDnsSuffix.length>211))throw Error('venue_mail_dns.test_suffix_required');
  const operatorVenues=options.operatorVenues===true;
  if(operatorVenues&&config.production)throw Error('operator_venues.unavailable_in_production');
  if(config.setupPairing&&options.planMode!=='test-venue-levels')throw Error('setup_pairing.test_mode_required');
  if(options.liveGuestMenu&&(config.production||options.planMode!=='test-venue-levels'))throw Error('live_guest_menu.test_mode_required');
  if(options.guestOrigin){validateGuestOrigin(options.guestOrigin);if(options.guestOrigin===config.portalOrigin)throw Error('guest_origin_invalid');}
  const billingAccount=validateBillingAccountOptions(options.billingAccount,options.planMode??'existing');
  const billingMethods=validateBillingMethodsOptions(options.billingMethods,options.planMode??'existing',billingAccount);
  if(options.tunnelProvision&&!options.leaseIssuer)throw Error('tunnel_provision.installation_issuer_required');
  if(options.addressLookup&&!options.leaseIssuer)throw Error('address_lookup.installation_issuer_required');
  if(options.relay&&!options.leaseIssuer)throw Error('relay.installation_issuer_required');
  if(options.translation&&!options.leaseIssuer)throw Error('translation.installation_issuer_required');
  if(options.staffCertificates&&!options.leaseIssuer)throw Error('staff_certificate.installation_issuer_required');
  if(options.captures&&!options.leaseIssuer)throw Error('backup.installation_issuer_required');
  const {pool, outbox,operatorAccountId} = options;
  const cloudActions=new CloudActions(pool,operatorAccountId,outbox);
  const factor=options.factor?validateFactorConfig(options.factor):factorConfigFromEnv(process.env);
  const passwordLogin=new PasswordLoginStore(pool,factor.keys,factor.policy,outbox);
  const actionProof=new AccountActionProofStore(pool,factor.keys,factor.policy,outbox);
  const ownerTransfers=new OwnerTransferStore(pool,outbox);
  const accountBusinesses = new AccountBusinessStore(pool, config.countryCode ?? 'ES');
  const accountSecurity=new AccountSecurityStore(pool,outbox,options.passwordScreening);
  const authenticator=new AuthenticatorFactorStore(pool,factor.keys,factor.policy,outbox);
  const recoveryCodeKeys=options.recoveryCodeKeys===undefined?(recoveryCodeKeysFromEnv(process.env)??null):options.recoveryCodeKeys;
  const pairingCodeKeys=options.pairingCodeKeys===undefined?(pairingCodeKeysFromEnv(process.env)??null):options.pairingCodeKeys;
  const origin = new URL(config.portalOrigin); const secure = origin.protocol === 'https:';
  const captures=options.captures&&options.leaseIssuer?new BackupCaptures(pool,options.leaseIssuer,config.portalOrigin,{...options.captures,planMode:options.planMode},options.leaseTrust):undefined;
  const exitDownloads=options.captures&&(options.planMode==='test-free-paid'||options.planMode==='test-venue-levels')
    ?new BackupCatalogue(pool,options.captures.vault,options.captures.objects,options.planMode,options.exitRanges):undefined;
  const translation=options.translation&&options.leaseIssuer?(options.translationMachine??new TranslationMachine(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust,undefined,options.planMode,allowances)):undefined;
  const staffExchange=options.staffCertificates&&options.leaseIssuer?new StaffCertificateExchange(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust,options.planMode):undefined;
  const streams=options.captures?.managedStreams&&options.leaseIssuer?new ManagedStreamMachines(pool,options.leaseIssuer,config.portalOrigin,options.captures.vault,options.captures.managedStreams,options.leaseTrust,options.planMode):undefined;
  const relay=options.relay&&options.leaseIssuer?new RelayMessages(pool,options.leaseIssuer,config.portalOrigin,options.relay,options.leaseTrust,options.planMode,allowances):undefined;
  const billingDisplay=createBillingDisplayMachine({pool,issuer:options.leaseIssuer,origin:config.portalOrigin,display:options.billingDisplay,trusted:options.leaseTrust});
  const guestMenus=options.guestOrigin&&options.leaseIssuer?new GuestMenuMachine(pool,options.leaseIssuer,config.portalOrigin,options.guestOrigin,options.leaseTrust,options.planMode):undefined;
  const boxErrors=options.leaseIssuer?new BoxErrorReports(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust):undefined;
  const limiter = new AccountRateLimiter(pool, config.rateKey);
  const verifyBrowser = config.turnstile && createTurnstileGuard({limiter, hostname: origin.hostname,
    secret: config.turnstile.secretKey, fetcher: options.turnstileFetch});
  const addressLookup=options.addressLookup&&options.leaseIssuer?new AddressLookupMachine(pool,options.leaseIssuer,config.portalOrigin,config.rateKey,options.addressLookup,options.leaseTrust,
   (cap,venueId)=>warnAboutAddressCap(pool,limiter,outbox,operatorAccountId,cap,venueId,operatorVenues)):undefined;
  const tunnelProvision=options.tunnelProvision&&options.leaseIssuer?new TunnelProvisionMachine(pool,options.leaseIssuer,config.portalOrigin,options.tunnelProvision,options.leaseTrust,options.planMode):undefined;
  const signup = new SignupStore(pool, outbox, options.passwordScreening); const recovery = new PasswordRecoveryStore(pool, outbox, options.passwordScreening);
  const passkeys = new PasskeyStore(pool, {rpName: 'Waitron Cloud', rpId: origin.hostname, origin: config.portalOrigin}, options.passkeyAdapter,outbox);
  const ownerRecovery=options.leaseIssuer&&config.countryCode?new OwnerRecoveryStore(pool,outbox,{origin:config.portalOrigin,countryCode:config.countryCode,issuer:options.leaseIssuer,trusted:options.leaseTrust,screening:options.passwordScreening}):undefined;
  const app = new Hono<{Bindings: HttpBindings}>();
  app.onError((error, c) => {
    protect(c); const fault = publicError(error);
    if (fault.retryAfter) c.header('Retry-After', String(fault.retryAfter));
    return c.json({error: fault.message}, fault.status);
  });
  const consume = async (rules: RateRule[]) => {
    const decision = await limiter.consume(rules);
    if (!decision.allowed) throw new AccountHttpError(429, 'rate_limited', decision.retryAfterSeconds);
  };
  app.use('*', async (c, next) => {
    const read = c.req.method === 'GET' && ['/api/account/action-proof','/api/account/session', '/api/account/passkeys', '/api/account/authenticator'].includes(c.req.path);
    const write = c.req.method === 'POST' && ['/api/account/session/activity', '/api/account/logout',
      '/api/account/passkeys/registration/options', '/api/account/passkeys/registration/verify',
      '/api/account/authenticator/begin', '/api/account/authenticator/activate', '/api/account/authenticator/cancel'].includes(c.req.path);
    return withEnrollmentPolicy({required: config.requireEnrollment === true, allowEnrollment: read || write || c.req.path.startsWith('/api/account/action-proof/')}, next);
  });
  app.all('*', async c => {
    const startedAt=Date.now();
    protect(c);
    const url = new URL(c.req.url);
    if (url.host !== origin.host || (c.req.header('host') && c.req.header('host') !== origin.host)) throw new AccountHttpError(403, 'forbidden');
    if (url.search) throw new AccountHttpError(400, 'invalid_input');
    const health=c.req.path==='/api/health/live'||c.req.path==='/api/health/ready';
    if(health){
      if(c.req.method!=='GET')throw new AccountHttpError(405,'method_not_allowed');
      if(c.req.path==='/api/health/live')return c.json({status:'live'});
    }
    const ip = clientAddress(c.env?.incoming?.socket.remoteAddress ?? '', c.req.header('x-forwarded-for'), config.trustedProxyIps);
    if(health){
      try{await consume([{scope:'all-ip',subject:ip,limit:120,windowSeconds:60}]);}
      catch(error){if(error instanceof AccountHttpError)throw error;return c.json({status:'unavailable'},503);}
      try{
        const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
        return installed.rows[0]?.count===migrationNames.length?c.json({status:'ready'}):c.json({status:'unavailable'},503);
      }catch{return c.json({status:'unavailable'},503);}
    }
    const rangeRead=exitDownloads?.exitRangesEnabled&&c.req.method==='POST'&&c.req.path==='/api/account/backups/download-range/read';
    await consume([{scope:rangeRead?'backup-exit-range-ip':'all-ip',subject:ip,limit:rangeRead?240:120,windowSeconds:60}]);
    if(c.req.path.startsWith('/api/account/owner-recovery/')||['/api/installations/owner-recovery-read','/api/installations/owner-recovery-approve','/api/installations/owner-recovery-refuse'].includes(c.req.path))return ownerRecoveryResponse(c,{store:ownerRecovery,origin:config.portalOrigin,secure,ip,consume});
    if(relay&&['/v1/installations/email/submit','/v1/installations/email/status','/v1/installations/email/cancel'].includes(c.req.path))return relayMessageResponse(c,{relay,ip,consume});
    if(['/api/installations/guest-menu-publish','/api/installations/guest-menu-status','/api/installations/guest-menu-withdraw'].includes(c.req.path))return guestMenuDeliveryResponse(c,guestMenus);
    if(c.req.path.startsWith('/api/account/guest-menu/'))return guestMenuResponse(c,{pool,origin:config.portalOrigin,guestOrigin:options.guestOrigin,liveGuestMenu:options.liveGuestMenu});
    if(c.req.path.startsWith('/api/account/operator/venues/'))return operatorVenuesResponse(c,operatorVenues?
      {pool,operator:operatorAccountId,country:config.countryCode,secure,origin:config.portalOrigin,ip,consume}:undefined);
    if(c.req.path.startsWith('/api/account/operator/'))return cloudActionsResponse(c,cloudActions,{pool,secure,origin:config.portalOrigin,ip,consume},operatorVenues);
    if(c.req.path.startsWith('/api/account/diagnostics/'))return diagnosticsResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path.startsWith('/api/account/usage/'))return usageResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path.startsWith('/api/account/security-audit/'))return securityAuditResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path==='/api/account/sessions'||c.req.path.startsWith('/api/account/sessions/'))return accountSessionResponse(c,{pool,origin:config.portalOrigin,secure});
    if (accountBusinessPaths.includes(c.req.path)) return accountBusinessResponse(c, accountBusinesses, config.portalOrigin, secure);
    if(c.req.path==='/api/account/owner-transfers'||c.req.path.startsWith('/api/account/owner-transfers/'))return ownerTransferResponse(c,{pool,store:ownerTransfers,origin:config.portalOrigin,secure,ip,consume});
    if(c.req.path.startsWith('/api/account/security/'))return accountSecurityResponse(c,{pool,store:accountSecurity,origin:config.portalOrigin,secure,ip,consume});
    if(c.req.path==='/api/account/action-proof'||c.req.path.startsWith('/api/account/action-proof/'))return accountActionProofResponse(c,{pool,store:actionProof,passkeys,origin:config.portalOrigin,secure,ip,consume});
    if(c.req.path==='/api/account/passkeys'||c.req.path.startsWith('/api/account/passkeys/'))return passkeyResponse(c,{pool,store:passkeys,origin:config.portalOrigin,secure,ip,consume,setupPairing:config.setupPairing});
    if(c.req.path==='/api/account/login/recovery'||c.req.path==='/api/account/login/factor'||c.req.path==='/api/account/login/email'||c.req.path==='/api/account/authenticator'||c.req.path.startsWith('/api/account/authenticator/'))
      return authenticatorResponse(c,{pool,login:passwordLogin,store:authenticator,policy:factor.policy,origin:config.portalOrigin,secure,ip,consume,setupPairing:config.setupPairing});
    if(c.req.path.startsWith('/api/replacement/'))return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:options.planMode}:undefined,consume});
    if(c.req.path.startsWith('/api/recovery/')||c.req.path.startsWith('/api/account/recovery/'))return recoveryResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:options.planMode}:undefined,consume,recoveryCodeKeys});
    if(['/api/installations/error-report','/api/installations/release-held','/api/installations/staff-report','/api/installations/staff-description'].includes(c.req.path))return boxErrorResponse(c,{machine:boxErrors,ip,consume});
    if(c.req.path==='/api/installations/tunnel-provision')return tunnelProvisionResponse(c,{machine:tunnelProvision,ip,consume});
    if(c.req.path==='/api/installations/address-lookup')return addressLookupResponse(c,{machine:addressLookup,ip,consume});
    if(translationPaths.includes(c.req.path))return translationResponse(c,{machine:translation,ip,consume});
    if(['/api/installations/staff-certificate-submit','/api/installations/staff-certificate-status'].includes(c.req.path))return staffCertificateResponse(c,{exchange:staffExchange,ip,consume});
    if(['/api/installations/backup-reserve','/api/installations/backup-publish'].includes(c.req.path))return captureResponse(c,{captures,ip,consume,startedAt});
    if(['/api/installations/backup-stream-configure','/api/installations/backup-stream-observe'].includes(c.req.path))return managedStreamResponse(c,{streams,ip,consume});
    if(options.planMode==='test-venue-levels'&&c.req.path.startsWith('/api/account/venue-email/'))return venueEmailResponse(c,{pool,origin:config.portalOrigin,secure,ip,consume,suffix:venueMailDnsSuffix,resolve:options.remoteResolve});
    if(c.req.path.startsWith('/api/account/remote-access/'))return remoteAccessResponse(c,{pool,origin:config.portalOrigin,consume,resolve:options.remoteResolve,planMode:options.planMode,guestOrigin:options.guestOrigin,liveGuestMenu:options.liveGuestMenu,venueMailDnsSuffix});
    if(c.req.path==='/api/account/translation-consent')return translationConsentResponse(c,{pool,origin:config.portalOrigin,consume});
    if(['/api/account/billing/method/start','/api/account/billing/method/verify'].includes(c.req.path))return billingMethodsResponse(c,{pool,origin:config.portalOrigin,consume,billing:billingAccount,methods:billingMethods});
    if(billingAccountPaths.includes(c.req.path))return billingAccountResponse(c,{pool,origin:config.portalOrigin,consume,billing:billingAccount,methodsEnabled:!!billingMethods,backupEndEnabled:options.planMode==='test-venue-levels'&&!!exitDownloads});
    if(c.req.path==='/api/account/alerts')return alertPreferencesResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path.startsWith('/api/account/backups/'))return backupResponse(c,{pool,origin:config.portalOrigin,consume,exitDownloads});
    if(c.req.path.startsWith('/api/account/sent-reports/'))return sentReportsResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path==='/api/installations/billing-display')return billingDisplayResponse(c,{machine:billingDisplay,ip,consume});
    if(c.req.path.startsWith('/api/installations/')||c.req.path==='/api/account/installations'||c.req.path.startsWith('/api/account/installations/')) return installationResponse(c,{pool,issuer:options.leaseIssuer,trusted:options.leaseTrust,planMode:options.planMode,origin:config.portalOrigin,ip,consume});
    if(c.req.path.startsWith('/api/pairing/')||c.req.path.startsWith('/api/account/pairing/')) return pairingResponse(c,{pool,origin:config.portalOrigin,ip,consume,pairingCodeKeys,setupPairing:config.setupPairing,country:config.countryCode??'ES',relayGrants:options.relay?.grants});
    const path = c.req.path.startsWith('/api/account/') ? c.req.path.slice('/api/account'.length) : '';
    const fields = paths[path];
    if (path !== '/session' && !fields) throw new AccountHttpError(404, 'not_found');
    if (c.req.method !== (path === '/session' ? 'GET' : 'POST')) throw new AccountHttpError(405, 'method_not_allowed');
    if (c.req.method === 'POST' && c.req.header('origin') !== config.portalOrigin) throw new AccountHttpError(403, 'forbidden');
    if (path === '/session') {
      const session = await transaction(pool, client => resolveSession(client, readSessionCookie(c, secure) ?? '', {touch: false}));
      return c.json({...session,...(billingAccount?.accountIds.includes(session.accountId)?{billingTrialAvailable:true}:{})});
    }
    const action = turnstileAction(c.req.path);
    const optional = ['/login', '/signup/request', '/password-reset/request', '/password-reset/complete'].includes(path) ? ['locale'] : [];
    if (action) optional.push('turnstileToken');
    const body = await readAccountBody(c.req.raw, fields!, optional);
    if (body.locale !== undefined && body.locale !== 'en' && body.locale !== 'es') throw new AccountHttpError(400, 'invalid_input');
    const locale = body.locale ?? 'en';
    let started = performance.now();
    let padReply = ['/login', '/signup/request', '/password-reset/request'].includes(path) && !(verifyBrowser && action);
    try {
      const email = 'email' in body ? normaliseEmail(body.email) : undefined;
      if ('email' in body && !email) throw new AccountHttpError(400, 'invalid_input');
      if ('password' in body && Buffer.byteLength(body.password!) > 1024) throw new AccountHttpError(400, 'invalid_input');
      if ('token' in body && !/^[A-Za-z0-9_-]{43}$/.test(body.token!)) throw new AccountHttpError(400, 'link_unavailable');
      if (path === '/login') {
        // IP-blocked traffic must not spend another person's shared email allowance.
        await consume([{scope: 'login-ip', subject: ip, limit: 10, windowSeconds: 60}]);
        await consume([{scope: 'login-email', subject: email!, limit: 30, windowSeconds: 900}]);
        if(factor.policy)await consume([{scope:'factor-login-email',subject:email!,...factor.policy.loginAccount}]);
        const result=await passwordLogin.start({email:email!,password:body.password!,locale,browserToken:readBrowserCookie(c,secure)},factor.policy?async (accountId,client)=>{
          const decision=await limiter.consume([{scope:'factor-login-account',subject:accountId,...factor.policy!.loginAccount}],client);
          if(!decision.allowed)return new AccountHttpError(429,'rate_limited',decision.retryAfterSeconds);
        }:undefined);
        if(result.kind==='factor')return c.json({factorRequired:true,challengeToken:result.challengeToken,expiresAt:result.expiresAt},202);
        if(result.kind==='email')return c.json({emailRequired:true,challengeToken:result.challengeToken,expiresAt:result.expiresAt,...(result.rememberBrowserAllowed?{rememberBrowserAllowed:true}:{})},202);
        const credentials=result.credentials;
        writeSessionCookies(c, secure, credentials);
        return c.json({accountId: credentials.accountId});
      }
      if (path.endsWith('/request')) {
        if (verifyBrowser && action) {
          await verifyBrowser(ip, action, body.turnstileToken);
          // A slow provider reply must leave the same padding for the email lookup.
          started = performance.now();
          padReply = true;
        }
        if (path === '/signup/request') {
          const decision = await limiter.consume([{scope: 'signup-request-hour-ip', subject: ip, limit: config.signupLimits.requestsPerHour, windowSeconds: 3600}]);
          if (!decision.allowed) throw new AccountHttpError(429, 'signup_rate_limited', decision.retryAfterSeconds);
          return c.json(await signup.request(email!, locale, config.signupLimits), 202);
        }
        await consume([{scope: `${path}-ip`, subject: ip, limit: 10, windowSeconds: 900}]);
        return c.json(await recovery.request(email!, locale), 202);
      }
      if (path.endsWith('/complete')) {
        await consume([{scope: `${path}-ip`, subject: ip, limit: 10, windowSeconds: 900},
          {scope: `${path}-token`, subject: body.token!, limit: 10, windowSeconds: 900}]);
        if (path === '/signup/complete') {
          let warningDay: string | undefined;
          const account = await signup.completeAccount(body.token!, {password: body.password!}, async (client, address) => {
            warningDay = await admitSignup(client, limiter, config.signupLimits, ip, address);
          });
          if (warningDay) await warnAboutSignupVolume(pool, outbox, options.operatorAccountId, warningDay, config.signupLimits.operatorWarningThreshold);
          return c.json(account, 201);
        }
        return c.json(await recovery.complete(body.token!, body.password!, locale));
      }
      const token = readSessionCookie(c, secure) ?? '';
      const csrfToken = c.req.header('x-csrf-token') ?? '';
      if (path === '/session/activity') {
        const session=await transaction(pool, client => resolveSession(client, token, {csrfToken}));
        return c.json({...session,...(billingAccount?.accountIds.includes(session.accountId)?{billingTrialAvailable:true}:{})});
      }
      try {
        await transaction(pool, async client => {
          await resolveSession(client, token, {csrfToken, touch: false});
          await endSession(client, token);
        });
      } catch (error) {
        if (!(error instanceof IdentityError) || !['session_unavailable', 'session_expired'].includes(error.code)) throw error;
      }
      await exitDownloads?.cancelExitSession(exitDownloadSession(token)).catch(()=>{});
      writeSessionCookies(c, secure); return c.body(null, 204);
    } finally {if (padReply) await delay(Math.max(0, 300 - (performance.now() - started)));}
  });
  return app;
}
