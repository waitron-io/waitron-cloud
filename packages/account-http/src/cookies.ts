import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { AccountHttpError } from './errors.ts';
export function cookieNames(secure: boolean) {
  return {session: secure ? '__Host-cloud_session' : 'cloud_session', csrf: secure ? '__Host-cloud_csrf' : 'cloud_csrf'};
}
export function readSessionCookie(c: Context, secure: boolean): string | undefined {
  const name = cookieNames(secure).session;
  const values = (c.req.header('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.split('=')[0] === name);
  if (values.length > 1) throw new AccountHttpError(400, 'invalid_input');
  return values[0]?.slice(name.length + 1);
}
export function writeSessionCookies(c: Context, secure: boolean, session?: {token: string; csrfToken: string}) {
  const names = cookieNames(secure);
  const options = {secure, sameSite: 'Lax' as const, path: '/', ...(session ? {} : {maxAge: 0})};
  setCookie(c, names.session, session?.token ?? '', {...options, httpOnly: true});
  setCookie(c, names.csrf, session?.csrfToken ?? '', options);
}
