import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {createSession, resolveSession, endSession, IdentityError} from '@waitron-cloud/identity';
import {generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON} from '@simplewebauthn/server';
import type {PasskeyCeremonyAdapter} from '../../../registration/src/passkeys.ts';
import {readFile} from 'node:fs/promises';
import type {Pool, PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
export async function requireConsoleDatabase(client: Pool | PoolClient): Promise<void> {
  const {rows} = await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname IN ('organisations','schema_migrations') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') AS customers`);
  if (rows[0].customers) throw new Error('Refusing customer database');
}
export async function initializeConsole(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('../../../../deploy/worldwide/schema.sql', import.meta.url), 'utf8');
  await transaction(pool, async client => {
    await requireConsoleDatabase(client);
    await client.query(sql);
  });
}
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
const invalid = () => new IdentityError('credentials_invalid');
const algorithms = [-8, -7, -257];
const simpleWebAuthn: PasskeyCeremonyAdapter = {
  registrationOptions: generateRegistrationOptions, authenticationOptions: generateAuthenticationOptions,
  verifyRegistration: verifyRegistrationResponse, verifyAuthentication: verifyAuthenticationResponse,
};
export class ConsoleAuth {
  readonly pool: Pool;
  readonly origin: string;
  readonly rpId: string;
  readonly adapter: PasskeyCeremonyAdapter;
  constructor(pool: Pool, origin: string, adapter = simpleWebAuthn) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost'))) throw new Error('Invalid console origin');
    this.pool = pool; this.origin = origin; this.rpId = parsed.hostname; this.adapter = adapter;
  }
  async admin(action: 'create' | 'disable' | 'reissue', name: string): Promise<string | undefined> {
    if (!name.trim() || name.length > 100) throw new Error('Invalid admin name');
    return transaction(this.pool, async client => {
      await requireConsoleDatabase(client);
      const secret = randomBytes(32).toString('base64url');
      if (action === 'create') {
        await client.query(`INSERT INTO cloud_accounts(name,user_handle,bootstrap_hash,bootstrap_expires_at)
          VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')`, [name, randomBytes(32), digest(secret)]);
      } else {
        const row = (await client.query('SELECT id FROM cloud_accounts WHERE name=$1 AND disabled_at IS NULL FOR UPDATE', [name])).rows[0];
        if (!row) throw invalid();
        await client.query('DELETE FROM console_passkeys WHERE account_id=$1', [row.id]);
        await client.query('DELETE FROM console_ceremonies WHERE account_id=$1', [row.id]);
        await client.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1 AND ended_at IS NULL', [row.id]);
        await client.query(`UPDATE cloud_accounts SET disabled_at=CASE WHEN $2 THEN clock_timestamp() ELSE disabled_at END,
          bootstrap_hash=$3,bootstrap_expires_at=CASE WHEN $2 THEN NULL ELSE clock_timestamp()+interval '10 minutes' END WHERE id=$1`,
        [row.id, action === 'disable', action === 'disable' ? null : digest(secret)]);
      }
      return action === 'disable' ? undefined : secret;
    });
  }
  async registrationOptions(secret: string) {
    return transaction(this.pool, async client => {
      const account = await this.bootstrap(client, secret);
      const options = await this.adapter.registrationOptions({rpName: 'Waitron Cloud admins', rpID: this.rpId,
        userName: account.name, userDisplayName: account.name, userID: new Uint8Array(account.user_handle),
        attestationType: 'none', supportedAlgorithmIDs: algorithms,
        authenticatorSelection: {residentKey: 'required', userVerification: 'required'}, timeout: 300000});
      const ceremonyId = await this.challenge(client, 'registration', options.challenge, account.id, digest(secret));
      return {ceremonyId, options};
    });
  }
  async register(secret: string, ceremonyId: string, response: RegistrationResponseJSON) {
    const ceremony = await this.consume(ceremonyId, 'registration');
    let result;
    try {result = await this.adapter.verifyRegistration({response, expectedChallenge: ceremony.challenge,
      expectedOrigin: this.origin, expectedRPID: this.rpId, requireUserVerification: true, supportedAlgorithmIDs: algorithms});}
    catch {throw invalid();}
    if (!result.verified || !result.registrationInfo.userVerified) throw invalid();
    const key = result.registrationInfo.credential;
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(key.id) || !key.publicKey.length || !Number.isSafeInteger(key.counter) || key.counter < 0) throw invalid();
    return transaction(this.pool, async client => {
      const account = await this.bootstrap(client, secret);
      if (account.id !== ceremony.account_id || digest(secret) !== ceremony.bootstrap_hash) throw invalid();
      await client.query('INSERT INTO console_passkeys(credential_id,account_id,public_key,counter,transports) VALUES($1,$2,$3,$4,$5)',
        [key.id, account.id, Buffer.from(key.publicKey), key.counter, key.transports ?? []]);
      await client.query('UPDATE cloud_accounts SET bootstrap_hash=NULL,bootstrap_expires_at=NULL WHERE id=$1', [account.id]);
      return createSession(client, account.id);
    });
  }
  async authenticationOptions() {
    const options = await this.adapter.authenticationOptions({rpID: this.rpId, userVerification: 'required', allowCredentials: [], timeout: 300000});
    const ceremonyId = await transaction(this.pool, client => this.challenge(client, 'authentication', options.challenge));
    return {ceremonyId, options};
  }
  async authenticate(ceremonyId: string, response: AuthenticationResponseJSON) {
    const ceremony = await this.consume(ceremonyId, 'authentication');
    if (typeof response?.id !== 'string') throw invalid();
    return transaction(this.pool, async client => {
      const lookup = (await client.query('SELECT account_id FROM console_passkeys WHERE credential_id=$1', [response.id])).rows[0];
      if (!lookup) throw invalid();
      const account = (await client.query('SELECT id,user_handle FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [lookup.account_id])).rows[0];
      const key = (await client.query('SELECT * FROM console_passkeys WHERE credential_id=$1 AND account_id=$2', [response.id, lookup.account_id])).rows[0];
      if (!account || !key || (response.response?.userHandle && response.response.userHandle !== account.user_handle.toString('base64url'))) throw invalid();
      let result;
      try {result = await this.adapter.verifyAuthentication({response, expectedChallenge: ceremony.challenge, expectedOrigin: this.origin,
        expectedRPID: this.rpId, requireUserVerification: true,
        credential: {id: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports}});}
      catch {throw invalid();}
      const next = result.authenticationInfo?.newCounter;
      if (!result.verified || !result.authenticationInfo.userVerified || !Number.isSafeInteger(next) || next < 0 || (Number(key.counter) !== 0 || next !== 0) && next <= Number(key.counter)) throw invalid();
      await client.query('UPDATE console_passkeys SET counter=$2 WHERE credential_id=$1', [key.credential_id, next]);
      return createSession(client, account.id);
    });
  }
  session(token: string, csrfToken?: string) {
    return transaction(this.pool, client => resolveSession(client, token, csrfToken === undefined ? {} : {csrfToken}));
  }
  signOut(token: string, csrfToken: string) {
    return transaction(this.pool, async client => {await resolveSession(client, token, {csrfToken}); await endSession(client, token);});
  }
  private async bootstrap(client: PoolClient, secret: string) {
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw invalid();
    const row = (await client.query('SELECT * FROM cloud_accounts WHERE bootstrap_hash=$1 AND disabled_at IS NULL FOR UPDATE', [digest(secret)])).rows[0];
    if (!row || !(await client.query('SELECT bootstrap_expires_at>clock_timestamp() AS live FROM cloud_accounts WHERE id=$1', [row.id])).rows[0].live) throw invalid();
    return row;
  }
  private async challenge(client: PoolClient, kind: string, challenge: string, accountId?: string, bootstrapHash?: string) {
    await client.query('DELETE FROM console_ceremonies WHERE expires_at<=clock_timestamp()');
    const id = randomUUID();
    await client.query('INSERT INTO console_ceremonies(id,kind,challenge,account_id,bootstrap_hash) VALUES($1,$2,$3,$4,$5)', [id, kind, challenge, accountId, bootstrapHash]);
    return id;
  }
  private async consume(id: string, kind: string) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw invalid();
    // Consuming commits before verification, so a refused response cannot replay its challenge.
    const row = await transaction(this.pool, async client => (await client.query('DELETE FROM console_ceremonies WHERE id=$1 RETURNING *,expires_at>clock_timestamp() AS live', [id])).rows[0]);
    if (!row?.live || row.kind !== kind) throw invalid();
    return row;
  }
}
