import type {Context} from 'hono';
import type {Pool} from 'pg';
import {listAccountSessions, revokeAccountSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {readSessionCookie, writeSessionCookies} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import {readBoundedJsonObject} from './request.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function accountSessionResponse(c: Context, options: {
  pool: Pool;
  origin: string;
  secure: boolean;
}): Promise<Response> {
  const path = c.req.path.slice('/api/account/sessions'.length);
  if (!['', '/revoke'].includes(path)) throw new AccountHttpError(404, 'not_found');
  const method = path === '' ? 'GET' : 'POST';
  if (c.req.method !== method) throw new AccountHttpError(405, 'method_not_allowed');
  const token = readSessionCookie(c, options.secure) ?? '';
  if (path === '') {
    const sessions = await transaction(options.pool, client => listAccountSessions(client, token));
    return c.json({sessions});
  }
  if (c.req.header('origin') !== options.origin) throw new AccountHttpError(403, 'forbidden');
  const body = await readBoundedJsonObject(c.req.raw);
  if (Object.keys(body).length !== 1 || typeof body.id !== 'string' || !UUID.test(body.id)) {
    throw new AccountHttpError(400, 'invalid_input');
  }
  const result = await transaction(options.pool, client => revokeAccountSession(
    client, token, c.req.header('x-csrf-token') ?? '', body.id as string));
  if (result.current) writeSessionCookies(c, options.secure);
  return c.body(null, 204);
}
