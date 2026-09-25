import {replacementResponse} from './replacement.ts';
import {recoveryResponse} from './recovery.ts';
import {remoteAccessResponse,type RemoteResolver} from './remote-access.ts';
import {BackupCaptures,type CaptureOptions} from '@waitron-cloud/backups/captures';
import {captureResponse} from './captures.ts';
import {alertPreferencesResponse} from './alerts.ts';
import {backupResponse} from './backups.ts';
import {installationResponse} from './installations.ts';
import {InstallationError,type LeaseIssuer} from '@waitron-cloud/registration';
import {pairingResponse} from './pairing.ts';
import {PairingError,RegistrationError} from '@waitron-cloud/registration';
import { securityHeaders } from './portal.ts';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import type { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { endSession, IdentityError, login, resolveSession } from '@waitron-cloud/identity';
import { EmailOutbox, PasswordRecoveryError, PasswordRecoveryStore, SignupError, SignupStore, normaliseEmail, transaction } from '@waitron-cloud/registration';
import { type AccountHttpConfig, validateConfig } from './config.ts';
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
  if (error instanceof IdentityError) {
    if (error.code === 'credentials_invalid') return new AccountHttpError(401, 'credentials_invalid');
    if (error.code === 'csrf_invalid' || error.code === 'permission_denied') return new AccountHttpError(403, 'forbidden');
    return new AccountHttpError(401, 'unauthenticated');
  }
  if (error instanceof InstallationError) return new AccountHttpError(error.code==='invalid_proof'?401:error.code==='revoked'||error.code==='permission_denied'?403:error.code==='unavailable'?503:400,error.code);
  if (error instanceof PairingError) return new AccountHttpError(error.code === 'invalid_proof' ? 401 : error.code === 'permission_denied' ? 403 : 400, error.code);
  if (error instanceof RegistrationError) return new AccountHttpError(error.code === 'permission_denied' ? 403 : 400, error.code);
  if (error instanceof SignupError || error instanceof PasswordRecoveryError) {
    return new AccountHttpError(400, ['verification_unavailable', 'reset_unavailable'].includes(error.code) ? 'link_unavailable' : 'invalid_input');
  }
  return new AccountHttpError(503, 'temporarily_unavailable', 1);
}
export function createAccountApp(options: {pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;leaseIssuer?:LeaseIssuer;captures?:CaptureOptions;remoteResolve?:RemoteResolver}) {
  const config = validateConfig(options.config);
  if(options.captures&&!options.leaseIssuer)throw Error('backup.installation_issuer_required');
  const {pool, outbox} = options;
  const origin = new URL(config.portalOrigin); const secure = origin.protocol === 'https:';
  const captures=options.captures&&options.leaseIssuer?new BackupCaptures(pool,options.leaseIssuer,config.portalOrigin,options.captures):undefined;
  const limiter = new AccountRateLimiter(pool, config.rateKey);
  const signup = new SignupStore(pool, outbox); const recovery = new PasswordRecoveryStore(pool, outbox);
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
    const ip = clientAddress(c.env?.incoming?.socket.remoteAddress ?? '', c.req.header('x-forwarded-for'), config.trustedProxyIps);
    await consume([{scope: 'all-ip', subject: ip, limit: 120, windowSeconds: 60}]);
    if(c.req.path.startsWith('/api/replacement/'))return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures,consume});
    if(c.req.path.startsWith('/api/recovery/')||c.req.path.startsWith('/api/account/recovery/'))return recoveryResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures,consume});
    if(['/api/installations/backup-reserve','/api/installations/backup-publish'].includes(c.req.path))return captureResponse(c,{captures,ip,consume});
    if(c.req.path.startsWith('/api/account/remote-access/'))return remoteAccessResponse(c,{pool,origin:config.portalOrigin,consume,resolve:options.remoteResolve});
    if(c.req.path==='/api/account/alerts')return alertPreferencesResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path.startsWith('/api/account/backups/'))return backupResponse(c,{pool,origin:config.portalOrigin,consume});
    if(c.req.path.startsWith('/api/installations/')||c.req.path==='/api/account/installations'||c.req.path.startsWith('/api/account/installations/')) return installationResponse(c,{pool,issuer:options.leaseIssuer,origin:config.portalOrigin,ip,consume});
    if(c.req.path.startsWith('/api/pairing/')||c.req.path.startsWith('/api/account/pairing/')) return pairingResponse(c,{pool,origin:config.portalOrigin,ip,consume});
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
        const credentials = await transaction(pool, client => login(client, {email: email!, password: body.password!}));
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
