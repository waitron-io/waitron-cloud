import type {Context} from 'hono';
import type {AccountBusinessStore} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';

export const accountBusinessPaths = ['/api/account/businesses', '/api/account/organisations/rename'];
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function accountBusinessResponse(c: Context, store: AccountBusinessStore, origin: string, secure: boolean) {
  const listing = c.req.path === accountBusinessPaths[0];
  const token = readSessionCookie(c, secure) ?? '';
  if (listing && c.req.method === 'GET') return c.json(await store.list(token));
  if (c.req.method !== 'POST') throw new AccountHttpError(405, 'method_not_allowed');
  if (c.req.header('origin') !== origin) throw new AccountHttpError(403, 'forbidden');
  const csrf = c.req.header('x-csrf-token') ?? '';
  if (listing) {
    const {legalName, taxNumber, countryCode, organisationId} = await readAccountBody(c.req.raw, ['legalName','taxNumber','countryCode'], ['organisationId']);
    if (organisationId !== undefined && !uuid.test(organisationId)) throw new AccountHttpError(400, 'invalid_input');
    return c.json(await store.register(token, csrf, {legalName: legalName!, taxNumber: taxNumber!, countryCode: countryCode!, organisationId}));
  }
  const {organisationId, name} = await readAccountBody(c.req.raw, ['organisationId','name']);
  if (!uuid.test(organisationId!)) throw new AccountHttpError(400, 'invalid_input');
  return c.json(await store.rename(token, csrf, organisationId!, name!));
}
