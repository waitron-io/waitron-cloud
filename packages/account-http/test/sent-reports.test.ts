import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after, before, beforeEach, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {createLeaseIssuer, transaction} from '@waitron-cloud/registration';
import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {connectedVenue, database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';

const origin = 'https://cloud.example.test';
const bindings = {incoming: {socket: {remoteAddress: '192.0.2.20'}}} as HttpBindings;
const cutoff = '2026-11-01T12:00:00.000Z';
const beforeCutoff = '2026-11-01T11:59:59.999999Z';
const exact = ' {"version":"1.2.3"}\n';
const later = '{"description":"Impresora"}\n';
let db: Awaited<ReturnType<typeof database>>;
let box: Awaited<ReturnType<typeof connectedVenue>>;
let owner: Awaited<ReturnType<typeof createSession>>;
let app: ReturnType<typeof createAccountApp>;
const issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
before(async () => { db = await database(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
 await resetSchema(db.pool);
 box = await connectedVenue(db, issuer, origin);
 owner = await transaction(db.pool, client => createSession(client, box.accountId));
 await db.pool.query('UPDATE organisation_memberships SET owner_since=$2 WHERE organisation_id=$1', [box.organisationId, cutoff]);
 app = createAccountApp({pool: db.pool, outbox: db.outbox, config: {portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: []}});
});

function request(action: 'list'|'read', fields: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
 return app.request(origin + '/api/account/sent-reports/' + action, {
  method: 'POST',
  headers: {origin, cookie: `__Host-cloud_session=${owner.token}`, 'x-csrf-token': owner.csrfToken, 'content-type': 'application/json', ...headers},
  body: JSON.stringify({venueId: box.venueId, ...fields}),
 }, bindings);
}

async function seed({reportedAt = cutoff, descriptionAt = cutoff, receiptOwner = box.accountId,
 installationId = box.installationId, ids = [randomUUID()], environment = 'test'}: {
 reportedAt?: string; descriptionAt?: string; receiptOwner?: string|null; installationId?: string; ids?: string[]; environment?: string;
} = {}) {
 await db.pool.query(`INSERT INTO installation_error_reports
  (installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,received_at,logs,details,description,staff_receipt_owner_id,staff_report_body,staff_description_body,staff_description_at)
  SELECT $1,id,$2,repeat('a',64),'staff',1,2,3,$3,$4,'[]','{}','Structured copy',$5,$6,$7,$8 FROM unnest($9::uuid[]) AS id`,
 [installationId, environment, reportedAt, '2026-11-02T12:00:00.123456Z', receiptOwner, exact, later, descriptionAt, ids]);
 return ids[0]!;
}

test('Sent reports limits first bodies and later descriptions to the current tenure', async () => {
 const early = await seed({reportedAt: beforeCutoff});
 const visible = await seed();
 const oldText = await seed({descriptionAt: beforeCutoff});
 const ownerless = await seed({receiptOwner: null});
 const wrongOwner = await seed({receiptOwner: randomUUID()});
 const page = await request('list');
 assert.equal(page.status, 200, await page.clone().text());
 assert.equal(page.headers.get('cache-control'), 'no-store');
 const response = await page.json();
 assert.deepEqual(response.reports.map((r: {reportId: string}) => r.reportId).sort(), [visible, oldText].sort());
 assert.ok(!JSON.stringify(response).includes('Structured copy'));
 assert.deepEqual(response.reports.find((r: {reportId: string}) => r.reportId === visible), {
  installationId: box.installationId, reportId: visible, reportedAt: cutoff, version: '1.2.3', bugStatus: 'open', fixedVersion: null,
 });
 await db.pool.query(`UPDATE installation_error_reports SET bug_issue_repository='clintongormley/waitron',bug_issue_number=18,
  bug_status='fixed',fixed_version='1.2.4' WHERE operation_id IN ($1,$2,$3)`, [visible, early, wrongOwner]);
 const updated = (await (await request('list')).json()).reports;
 assert.deepEqual(updated.map((r: {reportId: string}) => r.reportId).sort(), [visible, oldText].sort());
 assert.deepEqual(updated.find((r: {reportId: string}) => r.reportId === visible), {
  installationId: box.installationId, reportId: visible, reportedAt: cutoff, version: '1.2.3', bugStatus: 'fixed', fixedVersion: '1.2.4',
 });
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1", [box.venueId]);
 const production = (await (await request('list')).json()).reports;
 assert.ok(production.every((r: {bugStatus: string|null; fixedVersion: string|null}) => r.bugStatus === null && r.fixedVersion === null));
 const read = (reportId: string) => request('read', {installationId: box.installationId, reportId});
 for (const id of [early, ownerless, wrongOwner, randomUUID()]) assert.equal((await read(id)).status, 403);
 const current = await read(visible);
 assert.equal(current.status, 200);
 assert.equal(current.headers.get('cache-control'), 'no-store');
 assert.deepEqual(await current.json(), {venueId: box.venueId, installationId: box.installationId, reportId: visible, reportBody: exact, descriptionBody: later});
 const partial = await read(oldText);
 assert.equal(partial.status, 200);
 assert.deepEqual(await partial.json(), {venueId: box.venueId, installationId: box.installationId, reportId: oldText, reportBody: exact, descriptionBody: null});
 await db.pool.query("UPDATE organisation_memberships SET owner_since=$2::timestamptz + interval '1 microsecond' WHERE organisation_id=$1", [box.organisationId, cutoff]);
 assert.equal((await read(visible)).status, 403, 'the same account takes over again after the report was made');
});

test('Sent reports pages tied receipt times over current and replaced boxes in a production venue', async () => {
 const previous = randomUUID();
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1", [box.venueId]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key,superseded_by,revoked_at) VALUES($1,$2,'old-test-key',$3,clock_timestamp())", [previous, box.venueId, box.installationId]);
 const ids = Array.from({length: 52}, () => randomUUID());
 await seed({ids: ids.slice(0, 26), installationId: previous, environment: 'production'});
 await seed({ids: ids.slice(26), environment: 'production'});
 const list = await request('list');
 assert.equal(list.status, 200, await list.clone().text());
 const page = await list.json();
 assert.equal(page.reports.length, 50);
 assert.ok(page.nextCursor);
 const next = await request('list', {cursor: page.nextCursor});
 assert.equal(next.status, 200);
 const remaining = await next.json();
 assert.equal(remaining.nextCursor, null);
 assert.ok([...page.reports, ...remaining.reports].every(r => r.bugStatus === null && r.fixedVersion === null));
 assert.deepEqual([...page.reports, ...remaining.reports].map((r: {reportId: string}) => r.reportId).sort(), ids.sort());
 assert.equal((await request('read', {installationId: previous, reportId: page.reports.find((r: {installationId: string}) => r.installationId === previous).reportId})).status, 200);
 const other = await connectedVenue(db, issuer, origin);
 assert.equal((await request('list', {venueId: other.venueId, cursor: page.nextCursor})).status, 400);
});

test('Sent reports requires browser proof and live owner and recovery scope', async () => {
 const reportId = await seed();
 const item = {installationId: box.installationId, reportId};
 assert.equal((await request('read', item)).status, 200);
 assert.equal((await request('read', item, {cookie: ''})).status, 401);
 assert.equal((await request('read', item, {origin: 'https://other.example.test'})).status, 403);
 assert.equal((await request('read', item, {'x-csrf-token': ''})).status, 403);
 assert.equal((await request('read', {...item, venueId: randomUUID()})).status, 403);
 const sameOwnerVenue = randomUUID(), otherInstallation = randomUUID();
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')", [sameOwnerVenue, box.organisationId, box.legalBusinessId]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'another-box')", [otherInstallation, sameOwnerVenue]);
 const otherId = await seed({installationId: otherInstallation});
 const otherPage = await request('list', {venueId: sameOwnerVenue});
 assert.equal(otherPage.status, 200);
 assert.deepEqual((await otherPage.json()).reports.map((r: {reportId: string}) => r.reportId), [otherId]);
 assert.equal((await request('read', {...item, venueId: sameOwnerVenue})).status, 403);
 assert.equal((await request('read', {...item, installationId: randomUUID()})).status, 403);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE organisation_id=$1', [box.organisationId]);
 assert.equal((await request('list')).status, 403);
 assert.equal((await request('read', item)).status, 403);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE organisation_id=$1', [box.organisationId]);
 await setRecoveryScope(db.pool, box.accountId);
 assert.equal((await request('read', item)).status, 403);
});

for (const [action, invalidated] of [['read', 'membership'], ['read', 'session'], ['list', 'session']] as const) test(`Sent reports rejects a ${action} when the ${invalidated} changes during a wait`, async () => {
 const item = {installationId: box.installationId, reportId: await seed()};
 const fields = action === 'read' ? item : {};
 assert.equal((await request(action, fields)).status, 200);
 const holder = await db.secondPool.connect();
 let response: Promise<Response>|undefined;
 try {
  if (invalidated === 'session') await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '2 seconds' WHERE account_id=$1", [box.accountId]);
  await holder.query('BEGIN');
  await holder.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 FOR UPDATE', [box.organisationId]);
  const {rows: [{pid}]} = await holder.query('SELECT pg_backend_pid() AS pid');
  response = Promise.resolve(request(action, fields));
  let waiting = false;
  for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
   waiting = !!(await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))', [db.schema, pid])).rowCount;
   if (!waiting) await delay(10);
  }
  assert.ok(waiting, 'the request waited for the owner membership');
  if (invalidated === 'membership') await holder.query('DELETE FROM organisation_memberships WHERE organisation_id=$1', [box.organisationId]);
  else await holder.query('SELECT pg_sleep(GREATEST(0,EXTRACT(epoch FROM (absolute_expires_at-clock_timestamp()))+0.05)) FROM cloud_sessions WHERE account_id=$1', [box.accountId]);
  await holder.query('COMMIT');
  assert.equal((await response).status, invalidated === 'membership' ? 403 : 401);
 } finally {
  await holder.query('ROLLBACK');
  holder.release();
  await response?.catch(() => {});
 }
});
