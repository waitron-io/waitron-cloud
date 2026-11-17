import {Hono} from 'hono';
import type {HttpBindings} from '@hono/node-server';
import {IdentityError} from '@waitron-cloud/identity';
import type {RegistrationResponseJSON, AuthenticationResponseJSON} from '@simplewebauthn/server';
import {AccountHttpError} from '../errors.ts';
import {readBoundedJsonObject} from '../request.ts';
import {readSessionCookie, writeSessionCookies} from '../cookies.ts';
import {securityHeaders, type PortalAssets} from '../portal.ts';
import {AccountRateLimiter} from '../rate-limit.ts';
import type {ConsoleAuth} from './auth.ts';
import type {CountryReadiness} from './countries.ts';
import {consolePage} from './page.ts';
export type ConsoleOptions = {auth: ConsoleAuth; countries: CountryReadiness; rateKey: string; assets?: PortalAssets};
export function createConsoleApp({auth, countries, rateKey, assets}: ConsoleOptions) {
  const app = new Hono<{Bindings: HttpBindings}>();
  const origin = new URL(auth.origin); const secure = origin.protocol === 'https:';
  const limiter = new AccountRateLimiter(auth.pool, rateKey);
  app.use('*', async (c, next) => {for (const [name,value] of Object.entries(securityHeaders)) c.header(name,value); await next();});
  app.onError((error,c) => {
    if (error instanceof IdentityError) return c.json({error:error.code},error.code === 'csrf_invalid' ? 403 : 401);
    if (error instanceof AccountHttpError) {
      if (error.retryAfter) c.header('Retry-After',String(error.retryAfter));
      return c.json({error:error.message},error.status);
    }
    console.error('Console request failed:',error.name);
    return c.json({error:'unavailable'},503);
  });
  app.all('*', async c => {
    const url = new URL(c.req.url);
    if (url.host !== origin.host || (c.req.header('host') && c.req.header('host') !== origin.host)) throw new AccountHttpError(403,'forbidden');
    if (url.search) throw new AccountHttpError(400,'invalid_input');
    const path = c.req.path;
    if (c.req.method === 'GET' && path === '/') return c.html(consolePage);
    if (c.req.method === 'GET' && ['/worldwide.js','/app.css'].includes(path)) {
      const asset = assets?.get(path); if (!asset) return c.notFound();
      return new Response(asset.body as BodyInit,{headers:{...securityHeaders,'content-type':asset.contentType}});
    }
    if (path === '/api/health/live' && c.req.method === 'GET') return c.json({status:'live'});
    if (path === '/api/health/ready' && c.req.method === 'GET') {await auth.pool.query('SELECT 1 FROM console_passkeys LIMIT 1'); return c.json({status:'ready'});}
    const routes = ['/api/console/session','/api/console/countries','/api/console/signout','/api/console/signin/options','/api/console/signin/verify','/api/console/enrol/options','/api/console/enrol/verify'];
    if (!routes.includes(path)) return c.notFound();
    const read = path === '/api/console/session' || path === '/api/console/countries';
    if (c.req.method !== (read ? 'GET' : 'POST')) throw new AccountHttpError(405,'method_not_allowed');
    if (!read && c.req.header('origin') !== auth.origin) throw new AccountHttpError(403,'forbidden');
    const ip = c.env?.incoming?.socket.remoteAddress ?? 'local';
    const limit = await limiter.consume([{scope:read?'console-read':'console-write',subject:ip,limit:read?120:20,windowSeconds:60}]);
    if (!limit.allowed) throw new AccountHttpError(429,'rate_limited',limit.retryAfterSeconds);
    const token = readSessionCookie(c,secure) ?? '';
    if (read) {
      const session = await auth.session(token);
      return c.json(path === '/api/console/session' ? session : await countries.read());
    }
    if (path === '/api/console/signout') {
      await auth.signOut(token,c.req.header('x-csrf-token') ?? ''); writeSessionCookies(c,secure); return c.body(null,204);
    }
    if (path === '/api/console/signin/options') return c.json(await auth.authenticationOptions());
    const body = await readBoundedJsonObject(c.req.raw);
    if (path === '/api/console/enrol/options') {
      if (typeof body.secret !== 'string') throw new AccountHttpError(400,'invalid_input');
      return c.json(await auth.registrationOptions(body.secret));
    }
    if (typeof body.ceremonyId !== 'string' || !body.response || typeof body.response !== 'object' || Array.isArray(body.response)) throw new AccountHttpError(400,'invalid_input');
    const session = path === '/api/console/signin/verify'
      ? await auth.authenticate(body.ceremonyId, body.response as AuthenticationResponseJSON)
      : await auth.register(typeof body.secret === 'string' ? body.secret : '', body.ceremonyId, body.response as RegistrationResponseJSON);
    writeSessionCookies(c,secure,session); return c.json({signedIn:true});
  });
  return app;
}
