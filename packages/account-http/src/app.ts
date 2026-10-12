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
import {BackupCaptures,type CaptureOptions} from '@waitron-cloud/backups/captures';
import {captureResponse} from './captures.ts';
import {ManagedStreamMachines,managedStreamResponse} from './managed-streams.ts';
import {alertPreferencesResponse} from './alerts.ts';
import {backupResponse} from './backups.ts';
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
import { endSession, IdentityError, resolveSession } from '@waitron-cloud/identity';
import { EmailOutbox, pairingCodeKeysFromEnv, type PairingCodeKeys, PasskeyStore, PasswordRecoveryError, PasswordRecoveryStore, SignupError, SignupStore, normaliseEmail, transaction, type PasskeyCeremonyAdapter, type PasswordScreeningProvider } from '@waitron-cloud/registration';
import { type AccountHttpConfig, validateConfig, factorConfigFromEnv, validateFactorConfig, type FactorConfig } from './config.ts';
import {AuthenticatorFactorStore,PasswordLoginStore,FactorError} from '@waitron-cloud/registration';
import { AccountRateLimiter, type RateRule } from './rate-limit.ts';
import { clientAddress } from './client-address.ts';
import { readAccountBody } from './request.ts';
import { readSessionCookie, writeSessionCookies } from './cookies.ts';
import { AccountHttpError } from './errors.ts';
const paths: Record<string, readonly string[]> = {
  '/signup/request': ['email'], '/signup/complete': ['token', 'password', 'organisationName', 'legalBusinessName', 'countryCode'],
  '/login': ['email', 'password'], '/session/activity': [], '/logout': [],
  '/password-reset/request': ['email'], '/password-reset/complete': ['token', 'password'],
};
function protect(c: Context) {
  for (const [name, value] of Object.entries(securityHeaders)) c.header(name, value);
}
function publicError(error: unknown): AccountHttpError {
  if (error instanceof AccountHttpError) return error;
  if(error instanceof FactorError)return new AccountHttpError(error.code==='temporarily_unavailable'?503:401,error.code,error.code==='temporarily_unavailable'?1:undefined);
  if (error instanceof IdentityError) {
    if (error.code === 'credentials_invalid') return new AccountHttpError(401, 'credentials_invalid');
    if (error.code === 'csrf_invalid' || error.code === 'permission_denied') return new AccountHttpError(403, 'forbidden');
    if (error.code === 'session_expired') return new AccountHttpError(401, 'session_expired');
    return new AccountHttpError(401, 'unauthenticated');
  }
  if (error instanceof InstallationError) return new AccountHttpError(error.code==='invalid_proof'?401:error.code==='revoked'||error.code==='permission_denied'?403:error.code==='unavailable'?503:400,error.code);
  if (error instanceof PairingError) return new AccountHttpError(error.code === 'invalid_proof' ? 401 : error.code === 'permission_denied' ? 403 : 400, error.code);
  if (error instanceof RegistrationError) return new AccountHttpError(error.code === 'permission_denied' ? 403 : 400, error.code);
  if (error instanceof SecurityAuditError) return new AccountHttpError(error.code==='permission_denied'?403:error.code==='invalid_input'?400:409,error.code==='security_audit_conflict'?'conflict':error.code);
  if (error instanceof UsageError) return new AccountHttpError(error.code==='permission_denied'?403:error.code==='invalid_input'?400:409,error.code==='usage_conflict'?'conflict':error.code);
  if (error instanceof SignupError || error instanceof PasswordRecoveryError) {
    if (error.code === 'password_compromised') return new AccountHttpError(400, 'password_compromised');
    if (error.code === 'password_screening_unavailable') return new AccountHttpError(503, 'temporarily_unavailable', 1);
    return new AccountHttpError(400, ['verification_unavailable', 'reset_unavailable'].includes(error.code) ? 'link_unavailable' : 'invalid_input');
  }
  return new AccountHttpError(503, 'temporarily_unavailable', 1);
}
export function createAccountApp(options: {pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;factor?:FactorConfig;relay?:RelayAdmissionConfig;staffCertificates?:boolean;leaseIssuer?:LeaseIssuer;leaseTrust?:ReadonlyMap<string,string>;captures?:CaptureOptions;remoteResolve?:RemoteResolver;passwordScreening?:PasswordScreeningProvider;passkeyAdapter?:PasskeyCeremonyAdapter;pairingCodeKeys?:PairingCodeKeys|null;recoveryCodeKeys?:RecoveryCodeKeys|null}) {
  const config = validateConfig(options.config);
  if(options.relay&&!options.leaseIssuer)throw Error('relay.installation_issuer_required');
  if(options.staffCertificates&&!options.leaseIssuer)throw Error('staff_certificate.installation_issuer_required');
  if(options.captures&&!options.leaseIssuer)throw Error('backup.installation_issuer_required');
  const {pool, outbox} = options;
  const factor=options.factor?validateFactorConfig(options.factor):factorConfigFromEnv(process.env);
  const passwordLogin=new PasswordLoginStore(pool,factor.keys,factor.policy);
  const authenticator=new AuthenticatorFactorStore(pool,factor.keys,factor.policy);
  const recoveryCodeKeys=options.recoveryCodeKeys===undefined?(recoveryCodeKeysFromEnv(process.env)??null):options.recoveryCodeKeys;
  const pairingCodeKeys=options.pairingCodeKeys===undefined?(pairingCodeKeysFromEnv(process.env)??null):options.pairingCodeKeys;
  const origin = new URL(config.portalOrigin); const secure = origin.protocol === 'https:';
  const captures=options.captures&&options.leaseIssuer?new BackupCaptures(pool,options.leaseIssuer,config.portalOrigin,options.captures,options.leaseTrust):undefined;
  const staffExchange=options.staffCertificates&&options.leaseIssuer?new StaffCertificateExchange(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust):undefined;
  const streams=options.captures?.managedStreams&&options.leaseIssuer?new ManagedStreamMachines(pool,options.leaseIssuer,config.portalOrigin,options.captures.vault,options.captures.managedStreams,options.leaseTrust):undefined;
  const relay=options.relay&&options.leaseIssuer?new RelayMessages(pool,options.leaseIssuer,config.portalOrigin,options.relay,options.leaseTrust):undefined;
  const limiter = new AccountRateLimiter(pool, config.rateKey);
  const signup = new SignupStore(pool, outbox, options.passwordScreening); const recovery = new PasswordRecoveryStore(pool, outbox, options.passwordScreening);
  const passkeys = new PasskeyStore(pool, {rpName: 'Waitron Cloud', rpId: origin.hostname, origin: config.portalOrigin}, options.passkeyAdapter);
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
  app.all('*', async c => {
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
    await consume([{scope: 'all-ip', subject: ip, limit: 120, windowSeconds: 60}]);
    if(relay&&['/v1/installations/email/submit','/v1/installations/email/status','/v1/installations/email/cancel'].includes(c.req.path))return relayMessageResponse(c,{relay,ip,consume});
    if(c.req.path.startsWith('/api/account/diagnostics/'))return diagnosticsResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path.startsWith('/api/account/usage/'))return usageResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path.startsWith('/api/account/security-audit/'))return securityAuditResponse(c,{pool,origin:config.portalOrigin,secure,consume});
    if(c.req.path==='/api/account/sessions'||c.req.path.startsWith('/api/account/sessions/'))return accountSessionResponse(c,{pool,origin:config.portalOrigin,secure});
    if(c.req.path==='/api/account/passkeys'||c.req.path.startsWith('/api/account/passkeys/'))return passkeyResponse(c,{pool,store:passkeys,origin:config.portalOrigin,secure,ip,consume});
    if(c.req.path==='/api/account/login/factor'||c.req.path==='/api/account/authenticator'||c.req.path.startsWith('/api/account/authenticator/'))
      return authenticatorResponse(c,{pool,login:passwordLogin,store:authenticator,policy:factor.policy,origin:config.portalOrigin,secure,ip,consume});
    if(c.req.path.startsWith('/api/replacement/'))return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures,consume});
    if(c.req.path.startsWith('/api/recovery/')||c.req.path.startsWith('/api/account/recovery/'))return recoveryResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures,consume,recoveryCodeKeys});
    if(['/api/installations/staff-certificate-submit','/api/installations/staff-certificate-status'].includes(c.req.path))return staffCertificateResponse(c,{exchange:staffExchange,ip,consume});
    if(['/api/installations/backup-reserve','/api/installations/backup-publish'].includes(c.req.path))return captureResponse(c,{captures,ip,consume});
    if(['/api/installations/backup-stream-configure','/api/installations/backup-stream-observe'].includes(c.req.path))return managedStreamResponse(c,{streams,ip,consume});
    if(c.req.path.startsWith('/api/account/remote-access/'))return remoteAccessResponse(c,{pool,origin:config.portalOrigin,consume,resolve:options.remoteResolve});
    if(c.req.path==='/api/account/alerts')return alertPreferencesResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path.startsWith('/api/account/backups/'))return backupResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path.startsWith('/api/installations/')||c.req.path==='/api/account/installations'||c.req.path.startsWith('/api/account/installations/')) return installationResponse(c,{pool,issuer:options.leaseIssuer,trusted:options.leaseTrust,origin:config.portalOrigin,ip,consume});
    if(c.req.path.startsWith('/api/pairing/')||c.req.path.startsWith('/api/account/pairing/')) return pairingResponse(c,{pool,origin:config.portalOrigin,ip,consume,pairingCodeKeys});
    const path = c.req.path.startsWith('/api/account/') ? c.req.path.slice('/api/account'.length) : '';
    const fields = paths[path];
    if (path !== '/session' && !fields) throw new AccountHttpError(404, 'not_found');
    if (c.req.method !== (path === '/session' ? 'GET' : 'POST')) throw new AccountHttpError(405, 'method_not_allowed');
    if (c.req.method === 'POST' && c.req.header('origin') !== config.portalOrigin) throw new AccountHttpError(403, 'forbidden');
    if (path === '/session') {
      const session = await transaction(pool, client => resolveSession(client, readSessionCookie(c, secure) ?? '', {touch: false}));
      return c.json(session);
    }
    const body = await readAccountBody(c.req.raw, fields!, ['/signup/request', '/password-reset/request', '/password-reset/complete'].includes(path) ? ['locale'] : []);
    if (body.locale !== undefined && body.locale !== 'en' && body.locale !== 'es') throw new AccountHttpError(400, 'invalid_input');
    const locale = body.locale ?? 'en';
    const started = performance.now();
    const slow = ['/login', '/signup/request', '/password-reset/request'].includes(path);
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
        const result=await passwordLogin.start({email:email!,password:body.password!},factor.policy?async (accountId,client)=>{
          const decision=await limiter.consume([{scope:'factor-login-account',subject:accountId,...factor.policy!.loginAccount}],client);
          if(!decision.allowed)return new AccountHttpError(429,'rate_limited',decision.retryAfterSeconds);
        }:undefined);
        if(result.kind==='factor')return c.json({factorRequired:true,challengeToken:result.challengeToken,expiresAt:result.expiresAt},202);
        const credentials=result.credentials;
        writeSessionCookies(c, secure, credentials);
        return c.json({accountId: credentials.accountId});
      }
      if (path.endsWith('/request')) {
        await consume([{scope: `${path}-ip`, subject: ip, limit: 10, windowSeconds: 900}]);
        const result = await (path === '/signup/request' ? signup.request(email!, locale) : recovery.request(email!, locale));
        return c.json(result, 202);
      }
      if (path.endsWith('/complete')) {
        await consume([{scope: `${path}-ip`, subject: ip, limit: 10, windowSeconds: 900},
          {scope: `${path}-token`, subject: body.token!, limit: 10, windowSeconds: 900}]);
        if (path === '/signup/complete') return c.json(await signup.complete(body.token!, {
          password: body.password!, organisationName: body.organisationName!, legalBusinessName: body.legalBusinessName!, countryCode: body.countryCode!,
        }), 201);
        return c.json(await recovery.complete(body.token!, body.password!, locale));
      }
      const token = readSessionCookie(c, secure) ?? '';
      const csrfToken = c.req.header('x-csrf-token') ?? '';
      if (path === '/session/activity') return c.json(await transaction(pool, client => resolveSession(client, token, {csrfToken})));
      try {
        await transaction(pool, async client => {
          await resolveSession(client, token, {csrfToken, touch: false});
          await endSession(client, token);
        });
      } catch (error) {
        if (!(error instanceof IdentityError) || !['session_unavailable', 'session_expired'].includes(error.code)) throw error;
      }
      writeSessionCookies(c, secure); return c.body(null, 204);
    } finally {if (slow) await delay(Math.max(0, 300 - (performance.now() - started)));}
  });
  return app;
}
