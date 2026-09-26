import type { Context } from 'hono';
import type { Pool } from 'pg';
import { IdentityError, resolveSession } from '@waitron-cloud/identity';
import {
  PasskeyError,
  PasskeyStore,
  transaction,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@waitron-cloud/registration';
import { AccountHttpError } from './errors.ts';
import { readSessionCookie, writeSessionCookies } from './cookies.ts';
import { readBoundedJsonObject } from './request.ts';
import type { RateRule } from './rate-limit.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
type Consume = (rules: RateRule[]) => Promise<void>;
type Options = {pool: Pool; store: PasskeyStore; origin: string; secure: boolean; ip: string; consume: Consume};

export async function passkeyResponse(c: Context, options: Options): Promise<Response> {
  const path = c.req.path.slice('/api/account/passkeys'.length);
  const method = path === '' ? 'GET' : 'POST';
  if (!['', '/authentication/options', '/authentication/verify', '/registration/options', '/registration/verify', '/remove'].includes(path)) {
    throw new AccountHttpError(404, 'not_found');
  }
  if (c.req.method !== method) throw new AccountHttpError(405, 'method_not_allowed');
  if (method === 'POST' && c.req.header('origin') !== options.origin) throw new AccountHttpError(403, 'forbidden');
  const token = readSessionCookie(c, options.secure) ?? '';
  if (path === '') return c.json({passkeys: await options.store.list(token)});
  const body = await readBoundedJsonObject(c.req.raw);
  try {
    if (path === '/authentication/options') {
      exact(body, []);
      await options.consume([{scope: 'passkey-auth-options-ip', subject: options.ip, limit: 10, windowSeconds: 60}]);
      return c.json(await options.store.authenticationOptions());
    }
    if (path === '/authentication/verify') {
      exact(body, ['ceremonyId', 'response']);
      const ceremonyId = uuid(body.ceremonyId);
      const response = authentication(body.response);
      await options.consume([
        {scope: 'passkey-auth-verify-ip', subject: options.ip, limit: 10, windowSeconds: 60},
        {scope: 'passkey-auth-verify-ceremony', subject: ceremonyId, limit: 5, windowSeconds: 300},
      ]);
      const session = await options.store.authenticate(ceremonyId, response);
      writeSessionCookies(c, options.secure, session);
      return c.json({accountId: session.accountId});
    }
    exact(body, path === '/registration/verify' ? ['ceremonyId', 'response']
      : path === '/remove' ? ['id', 'password'] : ['password']);
    const parsedPassword = path === '/registration/verify' ? undefined : password(body.password);
    const registrationCeremony = path === '/registration/verify' ? uuid(body.ceremonyId) : undefined;
    const registrationResponse = path === '/registration/verify' ? registration(body.response) : undefined;
    const removalId = path === '/remove' ? uuid(body.id) : undefined;
    const csrfToken = c.req.header('x-csrf-token') ?? '';
    const live = await transaction(options.pool, client => resolveSession(client, token, {csrfToken, touch: false}));
    await options.consume([{scope: 'passkey-manage-account', subject: live.accountId, limit: 20, windowSeconds: 300}]);
    if (path === '/registration/options') {
      return c.json(await options.store.registrationOptions(token, csrfToken, parsedPassword!));
    }
    if (path === '/registration/verify') {
      return c.json(await options.store.verifyRegistration(token, csrfToken, registrationCeremony!, registrationResponse!), 201);
    }
    await options.store.remove(token, csrfToken, removalId!, parsedPassword!);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof PasskeyError) {
      throw new AccountHttpError(path === '/authentication/verify' ? 401 : 400,
        path === '/authentication/verify' ? 'credentials_invalid' : 'invalid_input');
    }
    if (error instanceof IdentityError && error.code === 'credentials_invalid') throw new AccountHttpError(403, 'credentials_invalid');
    throw error;
  }
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (fields.some(field => !(field in value)) || keys.some(field => !fields.includes(field) && !optional.includes(field))) {
    throw new AccountHttpError(400, 'invalid_input');
  }
}
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== 'string' || !value || value.length > maximum) throw new AccountHttpError(400, 'invalid_input');
  return value;
}
function encoded(value: unknown, maximum = 4096): string {
  const result = text(value, maximum);
  if (!BASE64URL.test(result)) throw new AccountHttpError(400, 'invalid_input');
  return result;
}
function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!UUID.test(result)) throw new AccountHttpError(400, 'invalid_input');
  return result;
}
function password(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024) throw new AccountHttpError(400, 'invalid_input');
  return value;
}
function credential(value: unknown, kind: 'registration' | 'authentication'): Record<string, unknown> {
  if (!plain(value)) throw new AccountHttpError(400, 'invalid_input');
  exact(value, ['id', 'rawId', 'response', 'clientExtensionResults', 'type'], ['authenticatorAttachment']);
  const id = encoded(value.id, 1364);
  if (encoded(value.rawId, 1364) !== id || value.type !== 'public-key' || !plain(value.clientExtensionResults)
    || ('authenticatorAttachment' in value && !['platform', 'cross-platform'].includes(String(value.authenticatorAttachment)))) {
    throw new AccountHttpError(400, 'invalid_input');
  }
  if (!plain(value.response)) throw new AccountHttpError(400, 'invalid_input');
  if (kind === 'registration') {
    exact(value.response, ['clientDataJSON', 'attestationObject'], ['authenticatorData', 'transports', 'publicKeyAlgorithm', 'publicKey']);
    encoded(value.response.clientDataJSON); encoded(value.response.attestationObject);
    for (const field of ['authenticatorData', 'publicKey'] as const) if (field in value.response) encoded(value.response[field]);
    if ('publicKeyAlgorithm' in value.response && !Number.isInteger(value.response.publicKeyAlgorithm)) throw new AccountHttpError(400, 'invalid_input');
    if ('transports' in value.response && (!Array.isArray(value.response.transports) || value.response.transports.length > 16
      || value.response.transports.some(item => typeof item !== 'string' || item.length > 32))) throw new AccountHttpError(400, 'invalid_input');
  } else {
    exact(value.response, ['clientDataJSON', 'authenticatorData', 'signature'], ['userHandle']);
    encoded(value.response.clientDataJSON); encoded(value.response.authenticatorData); encoded(value.response.signature);
    if ('userHandle' in value.response && value.response.userHandle !== undefined) encoded(value.response.userHandle, 512);
  }
  return value;
}
function registration(value: unknown): RegistrationResponseJSON {
  return credential(value, 'registration') as unknown as RegistrationResponseJSON;
}
function authentication(value: unknown): AuthenticationResponseJSON {
  return credential(value, 'authentication') as unknown as AuthenticationResponseJSON;
}
