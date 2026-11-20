import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {organisationScopeSql, resolveSession, type SessionCredentials} from '@waitron-cloud/identity';
import type {Pool, PoolClient} from 'pg';
import {isPairingUuid, PairingError, type PairingV4Claims} from './pairing-proof.ts';
import {RegistrationError, RegistrationStore, type Registration} from './index.ts';
import {recordSecurityAuditEvent} from './security-audit.ts';
import {transaction} from './transaction.ts';

interface StartRow {
  public_key: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  start_expires_at: Date;
  available: boolean;
}

export interface SetupPairingContext { requestId: string; state: string; codeChallenge: string }
export type SetupPairingSignIn = (client: PoolClient, session: SessionCredentials) => Promise<void>;

interface Attempt {
  public_key: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  started_at: Date;
  expires_at: Date;
  cloud_account_id: string | null;
  cloud_session_id: string | null;
  cloud_security_revision: number | null;
  credential_hash: string | null;
  code_hash: string | null;
  code_expires_at: Date | null;
  redeemed_at: Date | null;
  cancelled_at: Date | null;
  details_hash: string | null;
  result: Registration | null;
}

type Setup = {publicKey: string; redirectUri: string};

interface SignIn {
  id: string;
  created_at: Date;
  absolute_expires_at: Date;
  action_security_revision: number;
  password_hash: string | null;
}

const codeHash = (value: string) => createHash('sha256').update(value).digest('hex');
type SignInAuthority = Pick<SignIn, 'id' | 'action_security_revision' | 'password_hash'>;
type AttemptAuthority = Pick<Attempt, 'cloud_session_id' | 'cloud_security_revision' | 'credential_hash'>;

const credentialHash = (session: SignInAuthority) => session.password_hash === null ? null : codeHash(session.password_hash);
const unavailable = () => new PairingError('pairing_unavailable');
const now = async (client: PoolClient): Promise<Date> =>
  (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;

async function attempt(client: PoolClient, requestId: string, setup: Setup) {
  if (!isPairingUuid(requestId)) throw unavailable();
  const row = (await client.query<Attempt>('SELECT * FROM setup_pairing_attempts WHERE id=$1 FOR UPDATE', [requestId])).rows[0];
  if (!row || row.public_key !== setup.publicKey || row.redirect_uri !== setup.redirectUri) throw unavailable();
  return row;
}

function checkContext(row: Attempt, context: SetupPairingContext) {
  if (row.state !== context.state || row.code_challenge !== context.codeChallenge) throw unavailable();
}

function statusView(requestId: string, row: Pick<Attempt, 'redeemed_at' | 'expires_at'>) {
  return {requestId, state: row.redeemed_at ? 'account_bound' as const : 'awaiting_cloud' as const,
    expiresAt: row.expires_at.toISOString()};
}

function completedView(requestId: string, expiresAt: Date, registration: Registration) {
  return {requestId, state: 'complete' as const, expiresAt: expiresAt.toISOString(), registration};
}

function returnToBox(row: Attempt, requestId: string, params: {code: string} | {error: string}) {
  const callback = new URL(row.redirect_uri);
  callback.search = new URLSearchParams({request_id: requestId, state: row.state, ...params}).toString();
  return {returnUrl: callback.href};
}

function sameAuthority(row: AttemptAuthority, session: SignInAuthority) {
  return row.cloud_session_id === session.id && row.cloud_security_revision === session.action_security_revision
    && row.credential_hash === credentialHash(session);
}

async function boundSession(client: PoolClient, row: Attempt, filing: boolean) {
  if (!row.cloud_account_id || !row.cloud_session_id) throw unavailable();
  if (!(await client.query(`SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR ${filing ? 'UPDATE' : 'SHARE'}`,
    [row.cloud_account_id])).rowCount) throw unavailable();
  const session = (await client.query<SignIn>(`SELECT s.id,s.absolute_expires_at,s.action_security_revision,c.password_hash
    FROM cloud_sessions s LEFT JOIN cloud_credentials c USING (account_id)
    WHERE s.id=$1 AND s.account_id=$2 AND s.ended_at IS NULL FOR SHARE OF s`,
  [row.cloud_session_id, row.cloud_account_id])).rows[0];
  if (!session || !sameAuthority(row, session)) throw unavailable();
  return session;
}

const normaliseTaxNumber = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');

async function businessForVenue(client: PoolClient, accountId: string, countryCode: string, taxNumber: string, legalName: string) {
  // Keep the organisation and permission stable while filing, in the same lock order as owner transfer.
  const organisations = (await client.query<{id: string}>(`SELECT o.id FROM organisation_memberships m
    JOIN organisations o ON o.id=m.organisation_id
    WHERE m.account_id=$1 AND m.is_owner AND m.can_register_venues AND ${organisationScopeSql('m.account_id','o.id')}
    ORDER BY o.id FOR UPDATE OF o FOR SHARE OF m`, [accountId])).rows;
  const number = normaliseTaxNumber(taxNumber);
  if (number && organisations.length) {
    const businesses = (await client.query<{id: string; organisation_id: string; tax_number: string}>(`SELECT id,organisation_id,tax_number
      FROM legal_businesses WHERE organisation_id=ANY($1::uuid[]) AND country_code=$2 AND tax_number IS NOT NULL
      ORDER BY id FOR SHARE`, [organisations.map(o => o.id), countryCode])).rows;
    const matches = businesses.filter(business => normaliseTaxNumber(business.tax_number) === number);
    if (matches.length > 1) throw new RegistrationError('business_match_ambiguous');
    if (matches[0]) return {organisationId: matches[0].organisation_id, legalBusinessId: matches[0].id};
  }
  if (organisations.length > 1) throw new RegistrationError('business_match_ambiguous');
  let organisationId = organisations[0]?.id;
  if (organisationId) {
    const blank = (await client.query<{id: string}>(`WITH known AS (
      SELECT b.id FROM legal_businesses b JOIN organisation_memberships m USING (organisation_id)
      WHERE m.account_id=$1 AND ${organisationScopeSql('m.account_id','b.organisation_id')} LIMIT 2
    ) SELECT b.id FROM legal_businesses b JOIN known k USING (id)
      WHERE (SELECT count(*) FROM known)=1 AND b.organisation_id=$2 AND b.country_code=$3 AND b.tax_number IS NULL
      FOR UPDATE OF b`, [accountId, organisationId, countryCode])).rows[0];
    if (blank) {
      // The business lock holds off venue foreign-key checks until filing commits.
      const updated = await client.query(`UPDATE legal_businesses SET tax_number=$2 WHERE id=$1
        AND NOT EXISTS (SELECT 1 FROM venues WHERE legal_business_id=$1)`, [blank.id, taxNumber || null]);
      if (updated.rowCount) return {organisationId, legalBusinessId: blank.id};
    }
  } else {
    const hasScope = await client.query(`SELECT 1 FROM cloud_accounts a WHERE a.id=$1
      AND to_jsonb(a)->>'recovery_organisation_id' IS NULL
      AND NOT EXISTS (SELECT 1 FROM organisation_memberships WHERE account_id=a.id)`, [accountId]);
    if (!hasScope.rowCount) throw new PairingError('permission_denied');
    organisationId = randomUUID();
    await client.query('INSERT INTO organisations(id,name) VALUES ($1,$2)', [organisationId, legalName]);
    await client.query(`INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner)
      VALUES ($1,$2,true,true)`, [accountId, organisationId]);
  }
  const legalBusinessId = randomUUID();
  await client.query(`INSERT INTO legal_businesses(id,organisation_id,name,country_code,tax_number)
    VALUES ($1,$2,$3,$4,$5)`, [legalBusinessId, organisationId, legalName, countryCode, taxNumber || null]);
  return {organisationId, legalBusinessId};
}

export class SetupPairingStore {
  readonly #pool: Pool;

  constructor(pool: Pool) { this.#pool = pool; }

  signIn(context: SetupPairingContext, setup: Setup): SetupPairingSignIn {
    return async (client, credentials) => {
      const row = await attempt(client, context.requestId, setup);
      checkContext(row, context);
      const session = (await client.query<SignIn>(`SELECT s.id,s.created_at,s.absolute_expires_at,
        s.action_security_revision,c.password_hash FROM cloud_sessions s LEFT JOIN cloud_credentials c USING (account_id)
        WHERE s.token_hash=$1 AND s.account_id=$2 AND s.ended_at IS NULL`,
      [codeHash(credentials.token), credentials.accountId])).rows[0];
      if (!session || row.cancelled_at || row.cloud_session_id || session.created_at < row.started_at || row.expires_at <= await now(client))
        throw unavailable();

      // Pairing authority belongs to this request and gives the session no extra account permissions.
      await client.query(`UPDATE setup_pairing_attempts SET cloud_account_id=$2,cloud_session_id=$3,
        cloud_security_revision=$4,credential_hash=$5 WHERE id=$1`,
      [context.requestId, credentials.accountId, session.id, session.action_security_revision, credentialHash(session)]);
    };
  }

  authorize(context: SetupPairingContext, setup: Setup, token: string, csrf: string) {
    return transaction(this.#pool, async client => {
      const browser = await resolveSession(client, token, {csrfToken: csrf, touch: false});
      const session = (await client.query<SignIn>(`SELECT s.id,s.action_security_revision,c.password_hash
        FROM cloud_sessions s LEFT JOIN cloud_credentials c USING (account_id) WHERE s.token_hash=$1`, [codeHash(token)])).rows[0]!;
      const row = await attempt(client, context.requestId, setup);
      checkContext(row, context);
      if (row.cloud_account_id !== browser.accountId || !sameAuthority(row, session))
        throw new PairingError('permission_denied');
      if (row.cancelled_at || row.redeemed_at || row.expires_at <= await now(client)) throw unavailable();
      const code = randomBytes(32).toString('base64url');
      await client.query(`UPDATE setup_pairing_attempts SET code_hash=$2,
        code_expires_at=LEAST(expires_at,clock_timestamp()+interval '60 seconds') WHERE id=$1`,
      [context.requestId, codeHash(code)]);
      return returnToBox(row, context.requestId, {code});
    });
  }

  redeem(claims: PairingV4Claims & {action: 'redeem'}, setup: Setup) {
    const {requestId, args: [code, verifier]} = claims;
    return transaction(this.#pool, async client => {
      const binding = (await client.query<Attempt>('SELECT * FROM setup_pairing_attempts WHERE id=$1', [requestId])).rows[0];
      if (!binding) throw unavailable();
      const session = await boundSession(client, binding, false);
      const row = await attempt(client, requestId, setup);
      const time = await now(client);
      if (session.absolute_expires_at <= time || !sameAuthority(row, session) || row.cancelled_at || row.redeemed_at
        || row.expires_at <= time || !row.code_expires_at || row.code_expires_at <= time
        || row.code_hash !== codeHash(code) || row.code_challenge !== createHash('sha256').update(verifier).digest('base64url'))
        throw unavailable();
      await client.query(`UPDATE setup_pairing_attempts SET redeemed_at=$2,expires_at=$3,
        code_hash=NULL,code_expires_at=NULL WHERE id=$1`, [requestId, time, session.absolute_expires_at]);
      return statusView(requestId, {redeemed_at: time, expires_at: session.absolute_expires_at});
    });
  }

  cancel(requestId: string, state: string, setup: Setup) {
    return transaction(this.#pool, async client => {
      const row = await attempt(client, requestId, setup);
      if (row.state !== state || row.redeemed_at) throw unavailable();
      const expired = row.expires_at <= await now(client);
      await client.query(`UPDATE setup_pairing_attempts SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()),
        code_hash=NULL,code_expires_at=NULL WHERE id=$1`, [requestId]);
      return returnToBox(row, requestId, {error: expired ? 'expired' : 'access_denied'});
    });
  }

  complete(claims: PairingV4Claims & {action: 'complete'}, setup: Setup, country: string) {
    const {requestId, publicKey, args: [countryCode, venueName, address, taxNumber, legalName]} = claims;
    if (countryCode !== country) throw new PairingError('permission_denied');
    const detailsHash = codeHash(JSON.stringify(claims.args));
    return transaction(this.#pool, async client => {
      const binding = (await client.query<Attempt>('SELECT * FROM setup_pairing_attempts WHERE id=$1', [requestId])).rows[0];
      if (!binding?.redeemed_at || !binding.cloud_account_id || binding.public_key !== publicKey) throw unavailable();
      const session = binding.result ? undefined : await boundSession(client, binding, true);
      const row = await attempt(client, requestId, setup);
      if (row.result) {
        if (row.details_hash !== detailsHash) throw new PairingError('binding_conflict');
        if (!(await client.query('SELECT id FROM installations WHERE id=$1 AND revoked_at IS NULL FOR SHARE',
          [row.result.installationId])).rowCount) throw unavailable();
        return completedView(requestId, row.expires_at, row.result);
      }
      if (!session || !sameAuthority(row, session) || row.expires_at <= await now(client)) throw unavailable();
      const business = await businessForVenue(client, binding.cloud_account_id, countryCode, taxNumber, legalName);
      const registration = new RegistrationStore(this.#pool, client);
      const connection = {operationId: requestId, installationKey: publicKey, venueId: '', environment: 'test', ...business};
      await registration.start(connection);
      await registration.approveCloud(connection, binding.cloud_account_id);
      await registration.approveLocal(connection, requestId);
      const result = await registration.complete(connection);
      await client.query('UPDATE venues SET display_name=$2,setup_address=$3 WHERE id=$1',
        [result.venueId, venueName, JSON.stringify(address)]);
      const audit = {organisationId: business.organisationId, subjectKind: 'pairing_request' as const,
        subjectId: requestId, sourceId: requestId};
      await recordSecurityAuditEvent(client, {...audit, venueId: null, type: 'pairing.cloud_approved',
        actorKind: 'account', actorId: binding.cloud_account_id});
      await recordSecurityAuditEvent(client, {...audit, venueId: result.venueId, type: 'pairing.local_approved',
        actorKind: 'local_authority', actorId: requestId});
      if (row.expires_at <= await now(client)) throw unavailable();
      await client.query('UPDATE setup_pairing_attempts SET details_hash=$2,result=$3 WHERE id=$1',
        [requestId, detailsHash, result]);
      return completedView(requestId, row.expires_at, result);
    });
  }

  start(claims: PairingV4Claims & {action: 'start'}) {
    const {origin, requestId, publicKey, args: [redirectUri, state, codeChallenge]} = claims;
    return transaction(this.#pool, async client => {
      await client.query(`INSERT INTO setup_pairing_attempts (id,public_key,redirect_uri,state,code_challenge)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [requestId, publicKey, redirectUri, state, codeChallenge]);
      const row = (await client.query<StartRow>(`SELECT public_key,redirect_uri,state,code_challenge,
        started_at + interval '10 minutes' AS start_expires_at, cancelled_at IS NULL AND expires_at > clock_timestamp() AS available
        FROM setup_pairing_attempts WHERE id=$1 FOR UPDATE`, [requestId])).rows[0];
      if (!row?.available) throw unavailable();
      if (row.public_key !== publicKey || row.redirect_uri !== redirectUri || row.state !== state || row.code_challenge !== codeChallenge)
        throw new PairingError('binding_conflict');

      const authorizationUrl = new URL('/login', origin);
      authorizationUrl.search = new URLSearchParams({
        request_id: requestId, state, code_challenge: codeChallenge, code_challenge_method: 'S256',
      }).toString();
      return {requestId, state: 'awaiting_cloud', expiresAt: row.start_expires_at.toISOString(), authorizationUrl: authorizationUrl.href};
    });
  }

  async status({requestId, publicKey}: PairingV4Claims & {action: 'status'}) {
    const row = (await this.#pool.query<Pick<Attempt, 'redeemed_at' | 'expires_at' | 'result'> & AttemptAuthority & {
      session_id: string | null; action_security_revision: number; password_hash: string | null;
    }>(`SELECT a.redeemed_at,a.expires_at,a.result,a.cloud_session_id,a.cloud_security_revision,a.credential_hash,
        s.id AS session_id,s.action_security_revision,c.password_hash
      FROM setup_pairing_attempts a
      LEFT JOIN cloud_accounts owner ON owner.id=a.cloud_account_id AND owner.disabled_at IS NULL
      LEFT JOIN cloud_sessions s ON s.id=a.cloud_session_id AND s.account_id=owner.id AND s.ended_at IS NULL
      LEFT JOIN cloud_credentials c ON c.account_id=owner.id
      WHERE a.id=$1 AND a.public_key=$2 AND a.cancelled_at IS NULL
      AND ((a.result IS NULL AND a.expires_at > clock_timestamp()) OR EXISTS (
        SELECT 1 FROM installations i WHERE i.id=(a.result->>'installationId')::uuid AND i.revoked_at IS NULL))`,
    [requestId, publicKey])).rows[0];
    if (!row) throw unavailable();
    if (row.result) return completedView(requestId, row.expires_at, row.result);
    if (row.redeemed_at && (!row.session_id || !sameAuthority(row, {
      id: row.session_id, action_security_revision: row.action_security_revision, password_hash: row.password_hash,
    }))) throw unavailable();
    return statusView(requestId, row);
  }
}
