import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import { createSession, requireCurrentPassword, resolveSession, type SessionCredentials } from '@waitron-cloud/identity';
import { transaction } from './transaction.ts';

const CEREMONY_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface PasskeyCeremonyAdapter {
  registrationOptions(input: GenerateRegistrationOptionsOpts): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: VerifyRegistrationResponseOpts): Promise<VerifiedRegistrationResponse>;
  authenticationOptions(input: GenerateAuthenticationOptionsOpts): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: VerifyAuthenticationResponseOpts): Promise<VerifiedAuthenticationResponse>;
}

const simpleWebAuthn: PasskeyCeremonyAdapter = {
  registrationOptions: generateRegistrationOptions,
  verifyRegistration: verifyRegistrationResponse,
  authenticationOptions: generateAuthenticationOptions,
  verifyAuthentication: verifyAuthenticationResponse,
};

export interface PasskeySummary { id: string; createdAt: string; }
export interface PasskeyRegistrationOptions { ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON; }
export interface PasskeyAuthenticationOptions { ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON; }
export class PasskeyError extends Error {
  readonly code = 'passkey_invalid' as const;
  constructor() { super('passkey_invalid'); this.name = 'PasskeyError'; }
}

type Config = Readonly<{rpName: string; rpId: string; origin: string}>;
type RegistrationCeremony = {accountId: string; challenge: string};

export class PasskeyStore {
  readonly #pool: Pool;
  readonly #config: Config;
  readonly #adapter: PasskeyCeremonyAdapter;
  constructor(pool: Pool, config: Config, adapter: PasskeyCeremonyAdapter = simpleWebAuthn) {
    const parsed = new URL(config.origin);
    if (!config.rpName.trim() || parsed.origin !== config.origin || parsed.hostname !== config.rpId || parsed.pathname !== '/') {
      throw new Error('Invalid passkey configuration');
    }
    this.#pool = pool;
    this.#config = Object.freeze({...config});
    this.#adapter = adapter;
  }

  async registrationOptions(token: string, csrfToken: string, password: string): Promise<PasskeyRegistrationOptions> {
    return transaction(this.#pool, async client => {
      const session = await resolveSession(client, token, {csrfToken, touch: false});
      await requireCurrentPassword(client, session.accountId, password);
      await client.query(`INSERT INTO cloud_passkey_users (account_id, user_handle) VALUES ($1, $2)
        ON CONFLICT (account_id) DO NOTHING`, [session.accountId, randomBytes(32)]);
      const identity = (await client.query(`SELECT u.user_handle, c.email FROM cloud_passkey_users u
        JOIN cloud_credentials c ON c.account_id = u.account_id WHERE u.account_id = $1`, [session.accountId])).rows[0];
      const existing = (await client.query(`SELECT credential_id AS id, transports FROM cloud_passkeys
        WHERE account_id = $1 ORDER BY created_at, id`, [session.accountId])).rows;
      const options = await this.#adapter.registrationOptions({
        rpName: this.#config.rpName,
        rpID: this.#config.rpId,
        userName: identity.email,
        userDisplayName: identity.email,
        userID: new Uint8Array(identity.user_handle),
        timeout: CEREMONY_MS,
        attestationType: 'none',
        excludeCredentials: existing,
        authenticatorSelection: {residentKey: 'required', userVerification: 'required'},
      });
      requireChallenge(options.challenge);
      const ceremonyId = randomUUID();
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      await client.query(`INSERT INTO cloud_webauthn_ceremonies
        (id, kind, challenge, account_id, session_token_hash, created_at, expires_at)
        VALUES ($1, 'registration', $2, $3, $4, $5, $6)`,
      [ceremonyId, options.challenge, session.accountId, digest(token), now, new Date(now.getTime() + CEREMONY_MS)]);
      return {ceremonyId, options};
    });
  }

  async verifyRegistration(token: string, csrfToken: string, ceremonyId: string,
    response: RegistrationResponseJSON): Promise<PasskeySummary> {
    const ceremony = await transaction(this.#pool,
      async client => this.#consumeRegistration(client, token, csrfToken, ceremonyId));
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await this.#adapter.verifyRegistration({response, expectedChallenge: ceremony.challenge,
        expectedOrigin: this.#config.origin, expectedRPID: this.#config.rpId, requireUserVerification: true});
    } catch { throw new PasskeyError(); }
    if (!verification.verified || !verification.registrationInfo.userVerified) throw new PasskeyError();
    const {credential, credentialDeviceType, credentialBackedUp} = verification.registrationInfo;
    requireCredential(credential.id, credential.counter);
    const id = randomUUID();
    try {
      return await transaction(this.#pool, async client => {
        const session = await resolveSession(client, token, {csrfToken, touch: false});
        if (session.accountId !== ceremony.accountId) throw new PasskeyError();
        const inserted = await client.query(`INSERT INTO cloud_passkeys
          (id, account_id, credential_id, public_key, counter, transports, device_type, backed_up)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING created_at`,
        [id, ceremony.accountId, credential.id, Buffer.from(credential.publicKey), credential.counter,
          credential.transports ?? [], credentialDeviceType, credentialBackedUp]);
        return {id, createdAt: inserted.rows[0].created_at.toISOString()};
      });
    } catch (error) {
      if (isPgCode(error, '23505') || error instanceof PasskeyError) throw new PasskeyError();
      throw error;
    }
  }

  async authenticationOptions(): Promise<PasskeyAuthenticationOptions> {
    const options = await this.#adapter.authenticationOptions({rpID: this.#config.rpId, timeout: CEREMONY_MS,
      userVerification: 'required'});
    requireChallenge(options.challenge);
    return transaction(this.#pool, async client => {
      const ceremonyId = randomUUID();
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      await client.query(`INSERT INTO cloud_webauthn_ceremonies (id, kind, challenge, created_at, expires_at)
        VALUES ($1, 'authentication', $2, $3, $4)`,
      [ceremonyId, options.challenge, now, new Date(now.getTime() + CEREMONY_MS)]);
      return {ceremonyId, options};
    });
  }

  async authenticate(ceremonyId: string, response: AuthenticationResponseJSON): Promise<SessionCredentials> {
    const challenge = await transaction(this.#pool, async client => this.#consumeAuthentication(client, ceremonyId));
    if (!validCredentialId(response?.id) || !response.response?.userHandle || !BASE64URL.test(response.response.userHandle)) {
      throw new PasskeyError();
    }
    return transaction(this.#pool, async client => {
      const candidate = (await client.query(`SELECT p.account_id FROM cloud_passkeys p
        JOIN cloud_accounts a ON a.id = p.account_id WHERE p.credential_id = $1 AND a.disabled_at IS NULL`, [response.id])).rows[0];
      if (!candidate) throw new PasskeyError();
      const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [candidate.account_id]);
      if (!account.rowCount) throw new PasskeyError();
      const row = (await client.query(`SELECT p.*, u.user_handle FROM cloud_passkeys p
        JOIN cloud_passkey_users u ON u.account_id = p.account_id
        WHERE p.credential_id = $1 AND p.account_id = $2 FOR UPDATE OF p`, [response.id, candidate.account_id])).rows[0];
      if (!row || row.user_handle.toString('base64url') !== response.response.userHandle) throw new PasskeyError();
      const counter = Number(row.counter);
      requireCredential(row.credential_id, counter);
      let verification: VerifiedAuthenticationResponse;
      try {
        verification = await this.#adapter.verifyAuthentication({
          response, expectedChallenge: challenge, expectedOrigin: this.#config.origin, expectedRPID: this.#config.rpId,
          credential: {id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter, transports: row.transports},
          requireUserVerification: true,
        });
      } catch { throw new PasskeyError(); }
      const info = verification.authenticationInfo;
      if (!verification.verified || !info.userVerified || info.credentialID !== row.credential_id
        || !validCounter(info.newCounter) || info.newCounter < counter) throw new PasskeyError();
      await client.query(`UPDATE cloud_passkeys SET counter = $2, device_type = $3, backed_up = $4,
        last_used_at = clock_timestamp() WHERE id = $1`,
      [row.id, info.newCounter, info.credentialDeviceType, info.credentialBackedUp]);
      return createSession(client, row.account_id);
    });
  }

  async list(token: string): Promise<PasskeySummary[]> {
    return transaction(this.#pool, async client => {
      const session = await resolveSession(client, token, {touch: false});
      const rows = (await client.query(`SELECT id, created_at FROM cloud_passkeys WHERE account_id = $1
        ORDER BY created_at, id`, [session.accountId])).rows;
      return rows.map(row => ({id: row.id, createdAt: row.created_at.toISOString()}));
    });
  }

  async remove(token: string, csrfToken: string, id: string, password: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return transaction(this.#pool, async client => {
      const session = await resolveSession(client, token, {csrfToken, touch: false});
      await requireCurrentPassword(client, session.accountId, password);
      const removed = await client.query('DELETE FROM cloud_passkeys WHERE id = $1 AND account_id = $2', [id, session.accountId]);
      return removed.rowCount === 1;
    });
  }

  async #consumeRegistration(client: PoolClient, token: string, csrfToken: string,
    ceremonyId: string): Promise<RegistrationCeremony> {
    if (!UUID.test(ceremonyId)) throw new PasskeyError();
    const session = await resolveSession(client, token, {csrfToken, touch: false});
    const row = (await client.query(`SELECT * FROM cloud_webauthn_ceremonies
      WHERE id = $1 AND kind = 'registration' FOR UPDATE`, [ceremonyId])).rows[0];
    if (!row || row.account_id !== session.accountId || row.session_token_hash !== digest(token)) throw new PasskeyError();
    const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    if (row.consumed_at || row.expires_at <= now) throw new PasskeyError();
    await client.query('UPDATE cloud_webauthn_ceremonies SET consumed_at = $2 WHERE id = $1', [ceremonyId, now]);
    return {accountId: row.account_id, challenge: row.challenge};
  }

  async #consumeAuthentication(client: PoolClient, ceremonyId: string): Promise<string> {
    if (!UUID.test(ceremonyId)) throw new PasskeyError();
    const row = (await client.query(`SELECT * FROM cloud_webauthn_ceremonies
      WHERE id = $1 AND kind = 'authentication' FOR UPDATE`, [ceremonyId])).rows[0];
    const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    if (!row || row.consumed_at || row.expires_at <= now) throw new PasskeyError();
    await client.query('UPDATE cloud_webauthn_ceremonies SET consumed_at = $2 WHERE id = $1', [ceremonyId, now]);
    return row.challenge;
  }
}

function requireChallenge(challenge: string): void {
  if (typeof challenge !== 'string' || challenge.length > 512 || !BASE64URL.test(challenge)) throw new PasskeyError();
}
function validCredentialId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1364 && BASE64URL.test(value);
}
function validCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4294967295;
}
function requireCredential(id: unknown, counter: unknown): asserts id is string {
  if (!validCredentialId(id) || !validCounter(counter)) throw new PasskeyError();
}
function isPgCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
