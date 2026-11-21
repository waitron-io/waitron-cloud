import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {login} from '@waitron-cloud/identity';
import {SignupStore, transaction} from '@waitron-cloud/registration';
import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import {prepareConnectionProof} from '../../registration/test/fixtures/action-proof.ts';
import {createAccountApp} from '../src/app.ts';
import {database, signupVerification} from './fixtures.ts';

let db: Awaited<ReturnType<typeof database>>;
const origin = 'https://cloud.example.test';
const password = 'A long enough business password';
before(async () => { db = await database(); });
after(async () => db?.close());

async function account() {
  const email = randomUUID() + '@example.test';
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request(email);
  const {token} = await signupVerification(db, email);
  const owner = await signup.complete(token, {password, organisationName: 'Test Group', legalBusinessName: 'Original SL', countryCode: 'ES'});
  const session = await transaction(db.pool, client => login(client, {email, password}));
  return {...owner, ...session, email};
}

function requests(who: Awaited<ReturnType<typeof account>>) {
  const app = createAccountApp({pool: db.pool, outbox: db.outbox, config: {
    portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [], countryCode: 'ES',
  }});
  return (path = '/businesses', body?: object, headers: Record<string, string> = {}) =>
    app.request(origin + '/api/account' + path, {
      method: body ? 'POST' : 'GET', headers: {origin, cookie: '__Host-cloud_session=' + who.token,
        'x-csrf-token': who.csrfToken, 'content-type': 'application/json', ...headers},
      ...(body && {body: JSON.stringify(body)}),
    }, {incoming: {socket: {remoteAddress: '192.0.2.10'}}} as HttpBindings);
}

const details = {legalName: 'Second SL', taxNumber: 'ES-0123', countryCode: 'ES'};

test('Account lists venue-free businesses and uses one record for matching tax numbers', async () => {
  const owner = await account();
  const request = requests(owner);
  const input = {...details, organisationId: owner.organisationId};
  const replies = await Promise.all([
    request('/businesses', input),
    request('/businesses', {...input, taxNumber: 'es 0123'}),
  ]);
  for (const reply of replies) assert.equal(reply.status, 200);
  const businesses = (await (await request()).json() as {businesses: {legalName: string; taxNumber: string | null}[]}).businesses;
  assert.deepEqual(businesses.map(b => b.legalName).sort(), ['Original SL', 'Second SL']);
  assert.match(businesses.find(b => b.legalName === 'Second SL')!.taxNumber!, /^(ES-0123|es 0123)$/);
  const rename = await request('/organisations/rename', {organisationId: owner.organisationId, name: 'New Group'});
  assert.equal(rename.status, 200);
  const list = await (await request()).json() as {organisations: {id: string; name: string}[]};
  assert.equal(list.organisations.find(o => o.id === owner.organisationId)?.name, 'New Group');
});

test('An owner cannot register the same tax number under a different group or business name', async () => {
  const owner = await account();
  const request = requests(owner);
  const secondGroup = randomUUID();
  await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Second Group')", [secondGroup]);
  await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',
    [owner.accountId, secondGroup]);
  assert.equal((await request('/businesses', {...details, organisationId: owner.organisationId})).status, 200);
  const sameTax = await request('/businesses', {...details, organisationId: secondGroup});
  const differentName = await request('/businesses', {...details, organisationId: owner.organisationId, legalName: 'Another SL'});
  assert.deepEqual([sameTax.status, differentName.status], [409, 409]);
  assert.deepEqual(await sameTax.json(), {error: 'business_match_ambiguous'});
});

test('Registering the business named during signup completes its existing record', async () => {
  const owner = await account();
  const response = await requests(owner)('/businesses', {...details, legalName: 'Original SL'});
  assert.equal(response.status, 200);
  const data = await response.json() as {businesses: {id: string; taxNumber: string}[]};
  assert.deepEqual(data.businesses.map(({id, taxNumber}) => ({id, taxNumber})),
    [{id: owner.legalBusinessId, taxNumber: 'ES-0123'}]);
});

test('An account without memberships names its first group after the first business', async () => {
  const owner = await account();
  await db.pool.query('DELETE FROM organisation_memberships WHERE account_id=$1', [owner.accountId]);
  const request = requests(owner);
  const secondSession = await transaction(db.secondPool, client => login(client, {email: owner.email, password}));
  const replies = await Promise.all([
    request('/businesses', details),
    requests({...owner, ...secondSession})('/businesses', {...details, taxNumber: 'ES-0456', legalName: 'Third SL'}),
  ]);
  for (const reply of replies) assert.equal(reply.status, 200);
  const data = await (await request()).json() as {organisations: {name: string}[]; businesses: unknown[]};
  assert.equal(data.organisations.length, 1);
  assert.match(data.organisations[0]!.name, /^(Second|Third) SL$/);
  assert.equal(data.businesses.length, 2);
});

test('Business reads and writes respect ownership and recovery scope', async () => {
  const owner = await account();
  const other = await account();
  const request = requests(owner);
  await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id) VALUES ($1,$2)', [owner.accountId, other.organisationId]);
  const rename = {organisationId: other.organisationId, name: 'Wrong Group'};
  assert.equal((await request('/organisations/rename', rename)).status, 403);
  assert.equal((await request('/businesses', {...details, organisationId: other.organisationId})).status, 403);
  assert.equal((await request('/businesses', details, {origin: 'https://foreign.example.test'})).status, 403);
  assert.equal((await request('/businesses', details, {'x-csrf-token': ''})).status, 403);
  assert.equal((await request('/businesses', {...details, countryCode: 'FR'}, {cookie: ''})).status, 401);
  assert.equal((await request('/businesses', {...details, countryCode: 'FR'}, {'x-csrf-token': ''})).status, 403);
  assert.equal((await request('/organisations/rename', {...rename, name: ''}, {cookie: ''})).status, 401);
  const unserved = await request('/businesses', {...details, countryCode: 'FR'});
  assert.equal(unserved.status, 400);
  assert.deepEqual(await unserved.json(), {error: 'country_unavailable'});

  await prepareConnectionProof(db.pool, owner.accountId, owner.token);
  await setRecoveryScope(db.pool, owner.accountId, other.organisationId);
  const scoped = await (await request()).json() as {organisations: unknown[]; businesses: unknown[]};
  assert.deepEqual(scoped, {organisations: [], businesses: [], canStartOrganisation: false});
  assert.equal((await request('/businesses', details)).status, 403);
});
