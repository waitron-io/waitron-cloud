import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hashSecret, isSecretHash, verifySecret } from './secret-hash.ts';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_PASSWORD_HASH = await hashSecret('cloud-login-timing-dummy');
const passiveRead = new AsyncLocalStorage<boolean>();
export interface SessionCredentials { token: string; csrfToken: string; accountId: string; }
export interface Session { accountId: string; expiresAt: string; }
export interface AccountSessionSummary {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}
export interface AccountSessionRevocation { revoked: boolean; current: boolean; }
export class IdentityError extends Error {
  readonly code: 'credentials_invalid' | 'session_unavailable' | 'session_expired' | 'csrf_invalid' | 'permission_denied';
  constructor(code: IdentityError['code']) {
    super(code);
    this.name = 'IdentityError';
    this.code = code;
  }
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const isToken = (token: string) => typeof token === 'string' && TOKEN_FORMAT.test(token);

/** The caller must run identity operations inside a transaction on this client. */
export async function login(client: PoolClient, input: {email: string; password: string}): Promise<SessionCredentials> {
  if (typeof input.email !== 'string' || input.email.length > 254 || typeof input.password !== 'string'
    || Buffer.byteLength(input.password) > 1024) throw new IdentityError('credentials_invalid');
  const email = input.email.trim().toLowerCase();
  const lookup = await client.query(`SELECT c.account_id, c.password_hash FROM cloud_credentials c
    JOIN cloud_accounts a ON a.id = c.account_id WHERE c.email = $1 AND a.disabled_at IS NULL`, [email]);
  const accountId: string | undefined = lookup.rows[0]?.account_id;
  const passwordHash: string | undefined = lookup.rows[0]?.password_hash ?? undefined;
  const usable = passwordHash !== undefined && isSecretHash(passwordHash);
  // Failed passwords pay for one derivation without waiting on account-specific row locks.
  const correct = await verifySecret(input.password, usable ? passwordHash! : DUMMY_PASSWORD_HASH);
  if (!accountId || !usable || !correct) throw new IdentityError('credentials_invalid');
  // Account first, then credential/session rows: keep this order in account lifecycle operations.
  const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [accountId]);
  if (!account.rowCount) throw new IdentityError('credentials_invalid');
  const credentials = await client.query('SELECT password_hash FROM cloud_credentials WHERE account_id = $1 AND email = $2 FOR SHARE', [accountId, email]);
  // A password or account change during derivation/lock contention must invalidate this attempt.
  if (credentials.rows[0]?.password_hash !== passwordHash) throw new IdentityError('credentials_invalid');
  return createSession(client, accountId);
}

export async function requireCurrentPassword(client: PoolClient, accountId: string, password: string): Promise<void> {
  if (typeof accountId !== 'string' || typeof password !== 'string' || Buffer.byteLength(password) > 1024) {
    throw new IdentityError('credentials_invalid');
  }
  const lookup = await client.query('SELECT password_hash FROM cloud_credentials WHERE account_id = $1', [accountId]);
  const passwordHash: string | undefined = lookup.rows[0]?.password_hash ?? undefined;
  const usable = passwordHash !== undefined && isSecretHash(passwordHash);
  const correct = await verifySecret(password, usable ? passwordHash! : DUMMY_PASSWORD_HASH);
  if (!usable || !correct) throw new IdentityError('credentials_invalid');
  const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [accountId]);
  if (!account.rowCount) throw new IdentityError('credentials_invalid');
  const credentials = await client.query('SELECT password_hash FROM cloud_credentials WHERE account_id = $1 FOR SHARE', [accountId]);
  if (credentials.rows[0]?.password_hash !== passwordHash) throw new IdentityError('credentials_invalid');
}

export async function createSession(client: PoolClient, accountId: string): Promise<SessionCredentials> {
  const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [accountId]);
  if (!account.rowCount) throw new IdentityError('credentials_invalid');
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  await client.query('INSERT INTO cloud_sessions (token_hash, csrf_hash, account_id) VALUES ($1, $2, $3)',
    [digest(token), digest(csrfToken), accountId]);
  return { token, csrfToken, accountId };
}

export function withPassiveRead<T>(read: () => T): T { return passiveRead.run(true, read); }

export async function resolveSession(client: PoolClient, token: string, options: {touch?: boolean; csrfToken?: string} = {}): Promise<Session> {
  if (!isToken(token)) throw new IdentityError('session_unavailable');
  const tokenHash = digest(token);
  const lookup = await client.query('SELECT account_id FROM cloud_sessions WHERE token_hash = $1', [tokenHash]);
  const accountId: string | undefined = lookup.rows[0]?.account_id;
  if (!accountId) throw new IdentityError('session_unavailable');
  const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [accountId]);
  if (!account.rowCount) throw new IdentityError('session_unavailable');
  const { rows } = await client.query(`SELECT last_seen_at, absolute_expires_at, csrf_hash FROM cloud_sessions
    WHERE token_hash = $1 AND account_id = $2 AND ended_at IS NULL FOR UPDATE`, [tokenHash, accountId]);
  const session = rows[0];
  if (!session) throw new IdentityError('session_unavailable');
  // Query time separately after acquiring the row lock; waiting must not preserve an expired session.
  const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const idleDeadline = session.last_seen_at.getTime() + IDLE_TIMEOUT_MS;
  const absoluteDeadline = session.absolute_expires_at.getTime();
  if (now.getTime() >= Math.min(idleDeadline, absoluteDeadline)) throw new IdentityError('session_expired');
  if ('csrfToken' in options) {
    if (!isToken(options.csrfToken!) || !timingSafeEqual(Buffer.from(digest(options.csrfToken!), 'hex'), Buffer.from(session.csrf_hash, 'hex'))) {
      throw new IdentityError('csrf_invalid');
    }
  }
  const touch = options.touch !== false && passiveRead.getStore() !== true;
  if (touch) await client.query('UPDATE cloud_sessions SET last_seen_at = $2 WHERE token_hash = $1', [tokenHash, now]);
  return { accountId, expiresAt: new Date(Math.min(touch ? now.getTime() + IDLE_TIMEOUT_MS : idleDeadline, absoluteDeadline)).toISOString() };
}

export async function endSession(client: PoolClient, token: string): Promise<boolean> {
  // When combining logout with account updates, lock the account first to avoid reversing resolveSession's lock order.
  if (!isToken(token)) return false;
  const { rowCount } = await client.query('UPDATE cloud_sessions SET ended_at = clock_timestamp() WHERE token_hash = $1 AND ended_at IS NULL', [digest(token)]);
  return rowCount === 1;
}

export async function listAccountSessions(client: PoolClient, token: string): Promise<AccountSessionSummary[]> {
  const session = await resolveSession(client, token, {touch: false});
  const tokenHash = digest(token);
  const {rows} = await client.query(`WITH moment AS (SELECT clock_timestamp() AS now)
    SELECT id, created_at, last_seen_at,
      LEAST(last_seen_at + ($3::double precision * interval '1 millisecond'), absolute_expires_at) AS expires_at,
      token_hash = $2 AS current
    FROM cloud_sessions CROSS JOIN moment
    WHERE account_id = $1 AND ended_at IS NULL
      AND last_seen_at + ($3::double precision * interval '1 millisecond') > moment.now
      AND absolute_expires_at > moment.now
    ORDER BY (token_hash = $2) DESC, last_seen_at DESC, id`, [session.accountId, tokenHash, IDLE_TIMEOUT_MS]);
  return rows.map(row => ({id: row.id, createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_seen_at.toISOString(), expiresAt: row.expires_at.toISOString(), current: row.current}));
}

export async function revokeAccountSession(client: PoolClient, token: string, csrfToken: string,
  id: string): Promise<AccountSessionRevocation> {
  if (!isToken(token)) throw new IdentityError('session_unavailable');
  const tokenHash = digest(token);
  const candidate = (await client.query('SELECT account_id FROM cloud_sessions WHERE token_hash = $1', [tokenHash])).rows[0];
  if (!candidate) throw new IdentityError('session_unavailable');
  // One account-level turn prevents two sessions from locking each other in opposite order.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [candidate.account_id]);
  const actor = await resolveSession(client, token, {csrfToken, touch: false});
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return {revoked: false, current: false};
  }
  const target = (await client.query(`WITH moment AS (SELECT clock_timestamp() AS now)
    SELECT token_hash FROM cloud_sessions CROSS JOIN moment
    WHERE id = $1 AND account_id = $2 AND ended_at IS NULL
      AND last_seen_at + ($3::double precision * interval '1 millisecond') > moment.now
      AND absolute_expires_at > moment.now
    FOR UPDATE OF cloud_sessions`, [id, actor.accountId, IDLE_TIMEOUT_MS])).rows[0];
  if (!target) return {revoked: false, current: false};
  // A target-row wait must not let expired or revoked acting authority commit a change.
  await resolveSession(client, token, {csrfToken, touch: false});
  const result = await client.query('UPDATE cloud_sessions SET ended_at = clock_timestamp() WHERE id = $1 AND ended_at IS NULL', [id]);
  return {revoked: result.rowCount === 1, current: target.token_hash === tokenHash};
}

export async function requirePlatformPermission(client: PoolClient, token: string, permission: string, options: {csrfToken?: string} = {}): Promise<Session> {
  const session = await resolveSession(client, token, { ...options, touch: false });
  const { rowCount } = await client.query('SELECT 1 FROM platform_permissions WHERE account_id = $1 AND permission = $2 FOR SHARE', [session.accountId, permission]);
  if (!rowCount) throw new IdentityError('permission_denied');
  return resolveSession(client, token, options);
}
