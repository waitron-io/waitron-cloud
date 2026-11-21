import {createHash, randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {IdentityError, organisationScopeSql, resolveSession} from '@waitron-cloud/identity';
import {RegistrationError} from './index.ts';
import {requireSignupCountry} from './signup.ts';
import {transaction} from './transaction.ts';

const normaliseTaxNumber = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');
const ownedScope = `m.account_id=$1 AND m.is_owner AND ${organisationScopeSql('m.account_id', 'o.id')}`;

export async function lockOwnedOrganisations(client: PoolClient, accountId: string) {
  // Keep permission stable while filing, in the same lock order as owner transfer.
  return (await client.query<{id: string}>(`SELECT o.id FROM organisation_memberships m
    JOIN organisations o ON o.id=m.organisation_id
    WHERE ${ownedScope} AND m.can_register_venues ORDER BY o.id FOR UPDATE OF o FOR SHARE OF m`, [accountId])).rows;
}

export async function matchingTaxBusinesses(client: PoolClient, organisations: string[], countryCode: string, taxNumber: string) {
  const number = normaliseTaxNumber(taxNumber);
  if (!number || !organisations.length) return [];
  const rows = (await client.query<{id: string; organisation_id: string; tax_number: string; name: string | null}>(`SELECT id,organisation_id,tax_number,name
    FROM legal_businesses WHERE organisation_id=ANY($1::uuid[]) AND country_code=$2 AND tax_number IS NOT NULL
    ORDER BY id FOR SHARE`, [organisations, countryCode])).rows;
  return rows.filter(business => normaliseTaxNumber(business.tax_number) === number);
}

export async function lockBlankBusiness(client: PoolClient, accountId: string, organisationId: string, countryCode: string) {
  return (await client.query<{id: string; name: string | null}>(`WITH known AS (
    SELECT b.id FROM legal_businesses b JOIN organisation_memberships m USING (organisation_id)
    WHERE m.account_id=$1 AND ${organisationScopeSql('m.account_id','b.organisation_id')} LIMIT 2
  ) SELECT b.id,b.name FROM legal_businesses b JOIN known k USING (id)
  WHERE (SELECT count(*) FROM known)=1 AND b.organisation_id=$2 AND b.country_code=$3 AND b.tax_number IS NULL
  FOR UPDATE OF b`, [accountId, organisationId, countryCode])).rows[0];
}

export async function fillBlankBusinessTaxNumber(client: PoolClient, businessId: string, taxNumber: string | null) {
  // The held business lock keeps a new venue's foreign-key check waiting until filing commits.
  const result = await client.query(`UPDATE legal_businesses SET tax_number=$2 WHERE id=$1
    AND NOT EXISTS (SELECT 1 FROM venues WHERE legal_business_id=$1)`, [businessId, taxNumber]);
  return !!result.rowCount;
}

async function canStartOrganisation(client: PoolClient, accountId: string) {
  const result = await client.query(`SELECT 1 FROM cloud_accounts a WHERE a.id=$1
    AND to_jsonb(a)->>'recovery_organisation_id' IS NULL
    AND NOT EXISTS (SELECT 1 FROM organisation_memberships WHERE account_id=a.id)`, [accountId]);
  return !!result.rowCount;
}

export async function createFirstOrganisation(client: PoolClient, accountId: string, name: string | null) {
  if (!await canStartOrganisation(client, accountId)) return undefined;
  const id = randomUUID();
  await client.query('INSERT INTO organisations(id,name) VALUES ($1,$2)', [id, name]);
  await client.query(`INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner)
    VALUES ($1,$2,true,true)`, [accountId, id]);
  return id;
}

async function readBusinesses(client: PoolClient, accountId: string) {
  const organisations = (await client.query<{id: string; name: string | null; canRegister: boolean}>(`SELECT o.id,o.name,m.can_register_venues AS "canRegister"
    FROM organisation_memberships m JOIN organisations o ON o.id=m.organisation_id WHERE ${ownedScope} ORDER BY o.name,o.id`, [accountId])).rows;
  const businesses = (await client.query<{id: string; organisationId: string; legalName: string | null; countryCode: string | null; taxNumber: string | null}>(
    `SELECT id,organisation_id AS "organisationId",name AS "legalName",country_code AS "countryCode",tax_number AS "taxNumber"
    FROM legal_businesses WHERE organisation_id=ANY($1::uuid[]) ORDER BY name,id`, [organisations.map(o => o.id)])).rows;
  return {organisations, businesses, canStartOrganisation: !organisations.length && await canStartOrganisation(client, accountId)};
}

type BusinessDetails = {legalName: string; taxNumber: string; countryCode: string; organisationId?: string};

function field(input: string, max: number) {
  const value = input.trim();
  if (!value || value.length > max || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(input)) throw new RegistrationError('invalid_input');
  return value;
}

export class AccountBusinessStore {
  readonly #pool: Pool;
  readonly #countryCode: string;
  constructor(pool: Pool, countryCode: string) {
    this.#pool = pool;
    this.#countryCode = countryCode;
  }

  async list(token: string) {
    return transaction(this.#pool, async client => {
      const session = await resolveSession(client, token, {touch: false});
      const data = await readBusinesses(client, session.accountId);
      await resolveSession(client, token, {touch: false});
      return data;
    });
  }

  async register(token: string, csrf: string, details: BusinessDetails) {
    return this.#write(token, csrf, async (client, accountId) => {
      const name = field(details.legalName, 200), taxNumber = field(details.taxNumber, 32);
      if (!normaliseTaxNumber(taxNumber)) throw new RegistrationError('invalid_input');
      const country = requireSignupCountry(details.countryCode, this.#countryCode);
      const organisations = await lockOwnedOrganisations(client, accountId);
      const selected = details.organisationId;
      if (selected && !organisations.some(org => org.id === selected)) throw new IdentityError('permission_denied');
      if (!selected && organisations.length > 1) throw new RegistrationError('business_match_ambiguous');
      const organisationId = selected ?? organisations[0]?.id ?? await createFirstOrganisation(client, accountId, name);
      if (!organisationId) throw new IdentityError('permission_denied');
      await client.query('UPDATE organisations SET name=$2 WHERE id=$1 AND name IS NULL', [organisationId, name]);
      const matches = await matchingTaxBusinesses(client, organisations.map(org => org.id), country, taxNumber);
      const match = matches[0];
      if (match) {
        if (matches.length > 1 || match.organisation_id !== organisationId || match.name !== name) {
          throw new RegistrationError('business_match_ambiguous');
        }
        return;
      }
      const blank = await lockBlankBusiness(client, accountId, organisationId, country);
      if (blank?.name === name && await fillBlankBusinessTaxNumber(client, blank.id, taxNumber)) return;
      await client.query(`INSERT INTO legal_businesses(id,organisation_id,name,country_code,tax_number)
        VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), organisationId, name, country, taxNumber]);
    });
  }

  async rename(token: string, csrf: string, organisationId: string, input: string) {
    return this.#write(token, csrf, async (client, accountId) => {
      const name = field(input, 200);
      const result = await client.query(`UPDATE organisations o SET name=$3 FROM organisation_memberships m
        WHERE o.id=$2 AND m.organisation_id=o.id AND ${ownedScope}`, [accountId, organisationId, name]);
      if (!result.rowCount) throw new IdentityError('permission_denied');
    });
  }

  async #write(token: string, csrf: string, change: (client: PoolClient, id: string) => Promise<void>) {
    return transaction(this.#pool, async client => {
      // Take the account before the session, as setup does, to serialize first-group creation.
      const hash = createHash('sha256').update(token).digest('hex');
      await client.query('SELECT a.id FROM cloud_accounts a JOIN cloud_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 FOR UPDATE OF a', [hash]);
      const proof = {csrfToken: csrf, touch: false};
      const session = await resolveSession(client, token, proof);
      await change(client, session.accountId);
      const data = await readBusinesses(client, session.accountId);
      await resolveSession(client, token, proof);
      return data;
    });
  }
}
