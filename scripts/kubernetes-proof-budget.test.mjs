import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const target = new URL('./kubernetes-proof-budget.mjs', import.meta.url);
const budget = await import(target.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === target.href) return {};
  throw error;
});
const now = '2026-11-06T12:00:00Z';
const scope = { account: '462991287391', region: 'eu-north-1', stackId: 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570/00000000-0000-4000-8000-000000000000' };
const uuid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const categories = ['compute', 'disk', 'storage', 'requests', 'transfer', 'events', 'lambda', 'logs', 'network', 'tax', 'contingency'];
const identity = (changes = {}) => ({ uuid, head: 'a'.repeat(40), tree: 'b'.repeat(40), startedAt: now, expiry: '2026-11-06T14:15:00Z', liabilityUntil: '2026-12-06T14:15:00Z', ...changes });
const evidence = (changes = {}) => ({ observedAt: now, account: scope.account, region: scope.region,
  currency: 'USD', pricesReconciled: true, billingReconciled: true, protectionHealthy: true,
  components: Object.fromEntries(categories.map(key => [key, { upperMicroUsd: key === 'compute' ? 900000 : 10000,
    source: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/eu-north-1/index.json', digest: 'c'.repeat(64) }])),
  openings: { '2026-11': { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'd'.repeat(64) },
    '2026-12': { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'e'.repeat(64) } }, ...changes });
const confirmed = (changes = {}) => ({ uuid, observedAt: '2026-11-06T14:20:00Z', terminated: true, volumesAbsent: true,
  interfacesAbsent: true, billingReconciled: true, protectionHealthy: true, actualMicroUsd: 500000, ...changes });
const clone = value => structuredClone(value);

test('safe refusal names the S3 ledger validator', async () => {
  const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic-bucket', aws: { call: async () => ({}) } });
  await assert.rejects(store.list(), { message: 'D570 budget refused: s3 ledger' });
});

// This is the external conditional-object boundary. Persisted bytes survive a
// new budget module call; a conflicting writer receives the S3 precondition error.
function memoryStore() {
  const objects = new Map(), writes = []; let version = 0;
  const store = {
    objects, writes, beforePut: null,
    async list() { return [...objects.keys()]; },
    async get(key) { const row = objects.get(key); return row && { body: Buffer.from(row.body), etag: row.etag }; },
    async put(key, body, condition) {
      await store.beforePut?.(key, body, condition);
      const previous = objects.get(key);
      assert.ok(condition && (condition.ifNoneMatch === '*' || typeof condition.ifMatch === 'string'), 'unconditional ledger write');
      if (condition.ifNoneMatch === '*' ? previous : !previous || previous.etag !== condition.ifMatch) {
        throw Object.assign(new Error('conflict'), { name: 'PreconditionFailed' });
      }
      const etag = `"${++version}"`;
      objects.set(key, { body: Buffer.from(body), etag }); writes.push({ key, body: JSON.parse(body), condition });
      return { etag };
    },
    body(key) { return JSON.parse(objects.get(key).body); },
    damage(key, mutate) { const row = store.body(key); mutate(row); objects.get(key).body = Buffer.from(JSON.stringify(row)); },
  };
  return store;
}
async function fresh(options = {}) {
  assert.equal(typeof budget.initializeLedger, 'function', 'missing durable budget initializer');
  assert.equal(typeof budget.reserveRun, 'function', 'missing durable reservation');
  assert.equal(typeof budget.reconcileRun, 'function', 'missing conservative cleanup reconciliation');
  const store = memoryStore();
  await budget.initializeLedger({ scope, now, evidence: evidence(), store, ...options });
  return store;
}
const reserve = (store, id = identity(), proof = evidence(), at = now) => budget.reserveRun({ scope, identity: id, evidence: proof, now: at, store, clock: () => Date.parse(at) });
const reconcile = (store, proof = confirmed()) => budget.reconcileRun({ scope, uuid, observations: proof, now: proof.observedAt, store });

// Removing the active conditional write would admit both independent UUIDs.
test('two concurrent controllers reserve only one run before any monthly booking', async () => {
  const store = await fresh();
  const results = await Promise.allSettled([reserve(store), reserve(store, identity({ uuid: other }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(store.body('d570/ledger/active.json').active.state, 'reserved');
  for (const month of ['2026-11', '2026-12']) assert.equal(store.body(`d570/ledger/${month}.json`).entries.length, 1);
  const firstBooking = store.writes.findIndex(w => w.body.entries?.length);
  assert.equal(store.writes[firstBooking - 1].body.active.state, 'preparing');
});

test('an exact retry returns the original reservation without writes or a second charge', async () => {
  const store = await fresh(); const first = await reserve(store); const writes = store.writes.length;
  assert.deepEqual(await reserve(store), first);
  assert.equal(store.writes.length, writes);
  assert.equal(first.upperMicroUsd, 1000000);
  assert.deepEqual(first.months, ['2026-11', '2026-12']);
  assert.equal(first.expiry, '2026-11-06T14:15:00Z');
});

for (const [label, change] of [
  ['head', { head: 'f'.repeat(40) }], ['tree', { tree: 'f'.repeat(40) }],
  ['expiry', { expiry: '2026-11-06T14:14:00Z' }], ['retention', { liabilityUntil: '2026-12-07T14:15:00Z' }],
]) test(`same UUID cannot replace its original ${label}`, async () => {
  const store = await fresh(); await reserve(store); const before = clone([...store.objects]);
  await assert.rejects(reserve(store, identity(change)), /budget/i); assert.deepEqual(clone([...store.objects]), before);
});

test('a vanished controller keeps ownership across midnight and reservation expiry', async () => {
  const store = await fresh(); await reserve(store);
  await assert.rejects(reserve(store, identity({ uuid: other, startedAt: '2026-12-01T00:00:00Z', expiry: '2026-12-01T01:00:00Z', liabilityUntil: '2026-12-31T01:00:00Z' }), evidence({ observedAt: '2026-12-01T00:00:00Z' }), '2026-12-01T00:00:00Z'), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
});

for (const field of ['terminated', 'volumesAbsent', 'interfacesAbsent', 'billingReconciled', 'protectionHealthy']) {
  test(`unknown ${field} retains both ownership and all booked charges`, async () => {
    const store = await fresh(); await reserve(store); const before = clone([...store.objects]);
    await assert.rejects(reconcile(store, confirmed({ [field]: false })), /budget/i);
    assert.deepEqual(clone([...store.objects]), before);
    await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
  });
}

test('confirmed cleanup releases ownership while retaining full monthly reservations', async () => {
  const store = await fresh(); await reserve(store);
  const before = ['2026-11', '2026-12'].map(m => store.objects.get(`d570/ledger/${m}.json`).body);
  await reconcile(store);
  assert.equal(store.body('d570/ledger/active.json').active, null);
  assert.deepEqual(['2026-11', '2026-12'].map(m => store.objects.get(`d570/ledger/${m}.json`).body), before);
  await assert.rejects(reserve(store), /budget/i, 'completed UUID cannot launch twice');
  await reserve(store, identity({ uuid: other }));
  assert.equal(store.body('d570/ledger/2026-11.json').entries.length, 2);
});

for (const [label, mutate] of [
  ['missing price', e => delete e.components.disk], ['unknown bill', e => e.billingReconciled = false],
  ['unknown prices', e => e.pricesReconciled = false], ['unhealthy protection', e => e.protectionHealthy = false],
  ['wrong currency', e => e.currency = 'EUR'], ['stale official prices', e => e.observedAt = '2026-11-05T12:00:00Z'],
  ['future evidence', e => e.observedAt = '2026-11-06T12:00:01Z'],
  ['fractional money', e => e.components.disk.upperMicroUsd = 0.1],
  ['negative money', e => e.components.tax.upperMicroUsd = -1], ['nonfinite money', e => e.components.compute.upperMicroUsd = Infinity],
  ['foreign account', e => e.account = '949687825720'], ['foreign region', e => e.region = 'us-east-1'],
  ['unattributed price', e => e.components.disk.source = 'https://example.com/prices'],
  ['missing price digest', e => delete e.components.disk.digest],
  ['missing next month baseline', e => delete e.openings['2026-12']],
]) test(`${label} refuses before taking active ownership`, async () => {
  const store = await fresh(); const proof = evidence(); mutate(proof); const writes = store.writes.length;
  await assert.rejects(reserve(store, identity(), proof), /budget/i);
  assert.equal(store.writes.length, writes);
});

test('an exact twenty-dollar month refuses and never books another run', async () => {
  const proof = evidence(); proof.openings['2026-11'].baselineMicroUsd = 18800000;
  const store = await fresh({ evidence: proof });
  await assert.rejects(reserve(store, identity(), proof), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active, null);
});

test('a changed or deleted prior monthly record cannot reset usage', async () => {
  for (const damage of [s => s.objects.delete('d570/ledger/2026-11.json'), s => s.damage('d570/ledger/2026-11.json', b => b.opening.baselineMicroUsd = 0)]) {
    const proof = evidence(); proof.openings['2026-11'].baselineMicroUsd = 100000;
    const store = await fresh({ evidence: proof }); damage(store);
    await assert.rejects(reserve(store, identity(), proof), /budget/i);
    assert.equal(store.body('d570/ledger/active.json').active, null);
  }
});

test('partial month acquisition blocks other UUIDs and exact retry preserves the first booking', async () => {
  const store = await fresh(); let fail = true;
  store.beforePut = key => { if (fail && key === 'd570/ledger/2026-12.json') { fail = false; throw new Error('lost controller'); } };
  await assert.rejects(reserve(store), /lost controller/);
  assert.equal(store.body('d570/ledger/active.json').active.state, 'preparing');
  const november = Buffer.from(store.objects.get('d570/ledger/2026-11.json').body);
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
  const receipt = await reserve(store);
  assert.deepEqual(receipt.months, ['2026-11', '2026-12']);
  assert.deepEqual(store.objects.get('d570/ledger/2026-11.json').body, november);
});

test('lost successful monthly write is reconciled by exact content without a duplicate', async () => {
  const store = await fresh(); const put = store.put; let lose = true;
  store.put = async (...args) => { const result = await put(...args); if (lose && args[0] === 'd570/ledger/2026-12.json') { lose = false; throw new Error('lost response'); } return result; };
  await assert.rejects(reserve(store), /lost response/);
  await reserve(store);
  assert.equal(store.body('d570/ledger/2026-12.json').entries.length, 1);
});

test('missing active history never auto-initializes and initialization refuses existing monthly records', async () => {
  const store = await fresh(); store.objects.delete('d570/ledger/active.json');
  await assert.rejects(reserve(store), /budget/i);
  await assert.rejects(budget.initializeLedger({ scope, now, evidence: evidence(), store }), /budget/i);
});

for (const [label, id] of [
  ['long lifetime', identity({ expiry: '2026-11-06T14:15:01Z' })],
  ['short retention', identity({ liabilityUntil: '2026-12-06T14:14:59Z' })],
  ['future start beyond authority', identity({ startedAt: '2027-03-01T00:00:00Z', expiry: '2027-03-01T01:00:00Z', liabilityUntil: '2027-03-31T01:00:00Z' })],
  ['malformed UUID', identity({ uuid: 'not-a-uuid' })], ['future start', identity({ startedAt: '2026-11-06T12:00:01Z' })],
]) test(`${label} cannot produce a reservation`, async () => {
  const store = await fresh(); await assert.rejects(reserve(store, id), /budget/i);
});

test('reconciliation refuses inconsistent observations and unexplained cost overruns', async () => {
  for (const change of [{ uuid: other }, { actualMicroUsd: 1000001 }, { observedAt: '2026-11-06T11:59:59Z' }]) {
    const store = await fresh(); await reserve(store);
    await assert.rejects(reconcile(store, confirmed(change)), /budget/i);
    assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
  }
});

test('reservation refuses when its original deadline passes while object writes wait', async () => {
  const store = await fresh(); let clock = Date.parse(now);
  store.beforePut = key => { if (key === 'd570/ledger/2026-12.json') clock = Date.parse('2026-11-06T14:15:00Z'); };
  await assert.rejects(budget.reserveRun({ scope, identity: identity(), evidence: evidence(), now, store, clock: () => clock }), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
});

test('price evidence must still be same-day after a slow write crosses midnight', async () => {
  const store = await fresh(); const at = '2026-11-06T23:59:00Z'; let clock = Date.parse(at);
  store.beforePut = () => { clock = Date.parse('2026-11-07T00:00:00Z'); };
  await assert.rejects(budget.reserveRun({ scope, identity: identity({ startedAt: at, expiry: '2026-11-07T01:00:00Z', liabilityUntil: '2026-12-07T01:00:00Z' }), evidence: evidence({ observedAt: at }), now: at, store, clock: () => clock }), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
});

for (const field of ['baselineMicroUsd', 'overheadMicroUsd']) test(`new higher ${field} cannot hide behind an older monthly opening`, async () => {
  const store = await fresh(); const proof = evidence(); proof.openings['2026-11'][field] += 9000000;
  await assert.rejects(reserve(store, identity(), proof), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active, null);
});

test('monthly charges retain complete original identity and source evidence after cleanup', async () => {
  const store = await fresh(); const original = identity(), proof = evidence();
  await reserve(store, original, proof); await reconcile(store);
  const entry = store.body('d570/ledger/2026-11.json').entries[0];
  assert.deepEqual(entry.identity, original); assert.deepEqual(entry.evidence, proof);
  assert.deepEqual(store.body('d570/ledger/active.json').completed[0].observations, confirmed());
});

test('S3 adapter conditionally persists ledger bytes and reads them through a fresh adapter', async () => {
  assert.equal(typeof budget.createS3LedgerStore, 'function', 'missing conditional S3 adapter');
  const backend = memoryStore(), calls = [];
  const aws = { async call(operation, input) {
    calls.push({ operation, input }); assert.equal(input.Bucket, 'd570-synthetic'); assert.equal(input.ExpectedBucketOwner, '462991287391');
    if (operation === 'ListObjectsV2') return { Contents: [...backend.objects.keys()].map(Key => ({ Key })), IsTruncated: false };
    if (operation === 'GetObject') {
      const row = await backend.get(input.Key);
      if (!row) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: (async function* () { yield row.body; })(), ContentLength: row.body.byteLength, ETag: row.etag };
    }
    if (operation === 'PutObject') {
      assert.equal(input.ServerSideEncryption, 'AES256'); assert.equal(input.ContentType, 'application/json');
      const result = await backend.put(input.Key, input.Body, input.IfMatch ? { ifMatch: input.IfMatch } : { ifNoneMatch: input.IfNoneMatch });
      return { ETag: result.etag };
    }
    throw new Error('unexpected service operation');
  } };
  let store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws });
  await budget.initializeLedger({ scope, evidence: evidence(), now, store });
  const first = await reserve(store);
  store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws });
  assert.deepEqual(await reserve(store), first);
  assert.ok(calls.some(c => c.operation === 'PutObject' && c.input.IfMatch));
  assert.ok(calls.some(c => c.operation === 'PutObject' && c.input.IfNoneMatch === '*'));
  assert.ok(calls.filter(c => c.operation === 'ListObjectsV2').every(c => c.input.Prefix === 'd570/ledger/' && c.input.MaxKeys === 100));
});

test('S3 adapter does not turn denied, missing-bucket or malformed reads into missing history', async () => {
  assert.equal(typeof budget.createS3LedgerStore, 'function');
  for (const error of [Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), Object.assign(new Error('bucket'), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } })]) {
    const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => { throw error; } } });
    await assert.rejects(store.get('d570/ledger/active.json'), e => e === error);
  }
  for (const response of [
    { Body: Buffer.from('{}'), ContentLength: 1024 * 1024 + 1, ETag: '"etag"' },
    { Body: Buffer.from('{}'), ContentLength: 1, ETag: '"etag"' },
    { Body: Buffer.from('{}'), ContentLength: 2, ETag: '' },
    { Body: (async function* () { yield Buffer.alloc(1024 * 1024); yield Buffer.from('x'); })(), ContentLength: 2, ETag: '"etag"' },
  ]) {
    const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => response } });
    await assert.rejects(store.get('d570/ledger/active.json'), /budget/i);
  }
});

test('S3 adapter refuses unconditional writes, unexpected prefixes and incomplete repeated-page inventories', async () => {
  assert.equal(typeof budget.createS3LedgerStore, 'function');
  let calls = 0; const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { async call() { calls++; return { Contents: [], IsTruncated: true, NextContinuationToken: 'same' }; } } });
  await assert.rejects(store.put('d570/ledger/active.json', Buffer.from('{}'), {}), /budget/i);
  await assert.rejects(store.get('d570/payload/private'), /budget/i);
  assert.equal(calls, 0);
  await assert.rejects(store.list(), /budget/i); assert.equal(calls, 2);
});

for (const [label, change] of [
  ['array UUID', { uuid: [uuid] }], ['array head', { head: ['a'.repeat(40)] }], ['array tree', { tree: ['b'.repeat(40)] }],
]) test(`${label} cannot be coerced into a reservation identity`, async () => {
  const store = await fresh(); await assert.rejects(reserve(store, identity(change)), /budget/i);
});

test('caller mutation during active acquisition cannot replace the snapshotted evidence', async () => {
  const store = await fresh(); const id = identity(), proof = evidence();
  store.beforePut = key => { if (key === 'd570/ledger/active.json') { id.head = 'f'.repeat(40); proof.components.compute.upperMicroUsd = 1; } };
  const pending = reserve(store, id, proof); await assert.doesNotReject(pending);
  const result = await pending;
  assert.equal(result.head, 'a'.repeat(40)); assert.equal(result.upperMicroUsd, 1000000);
  assert.equal(store.body('d570/ledger/2026-11.json').entries[0].evidence.components.compute.upperMicroUsd, 900000);
});

test('missing or corrupted persisted bookings block both exact retry and cleanup', async () => {
  for (const damage of [s => s.objects.delete('d570/ledger/2026-12.json'), s => s.damage('d570/ledger/2026-11.json', row => row.entries[0].upperMicroUsd = 1)]) {
    const store = await fresh(); await reserve(store); damage(store);
    await assert.rejects(reserve(store), /budget/i); await assert.rejects(reconcile(store), /budget/i);
    assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
  }
});

test('unrecognized and oversized ledger records refuse before new bookings', async () => {
  for (const change of [s => s.damage('d570/ledger/active.json', row => row.schema = 'future-version'), s => s.objects.get('d570/ledger/active.json').body = Buffer.alloc(1024 * 1024 + 1)]) {
    const store = await fresh(); change(store); const writes = store.writes.length;
    await assert.rejects(reserve(store), /budget/i); assert.equal(store.writes.length, writes);
  }
});

test('a lost successful active completion is read back as one immutable reservation', async () => {
  const store = await fresh(), put = store.put; let lose = true;
  store.put = async (...args) => { const result = await put(...args); if (lose && args[0] === 'd570/ledger/active.json' && JSON.parse(args[1]).active?.state === 'reserved') { lose = false; throw new Error('lost active response'); } return result; };
  await assert.rejects(reserve(store), /lost active response/);
  const writes = store.writes.length; assert.equal((await reserve(store)).uuid, uuid); assert.equal(store.writes.length, writes);
});

test('the 135-minute lifetime is independently bounded when retention is otherwise valid', async () => {
  const store = await fresh();
  await assert.rejects(reserve(store, identity({ expiry: '2026-11-06T14:15:01Z', liabilityUntil: '2026-12-06T14:15:01Z' })), /budget/i);
});

test('a run starting before access expiry cannot extend its machine into the next day', async () => {
  const at = '2027-02-28T23:00:00Z';
  const proof = evidence({ observedAt: at, openings: { '2027-02': { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'd'.repeat(64) }, '2027-03': { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'e'.repeat(64) } } });
  const store = await fresh({ now: at, evidence: proof });
  await assert.rejects(reserve(store, identity({ startedAt: at, expiry: '2027-03-01T00:00:00Z', liabilityUntil: '2027-03-31T00:00:00Z' }), proof, at), /budget/i);
});

test('runtime refuses a completely empty ledger rather than silently assuming zero spend', async () => {
  assert.equal(typeof budget.reserveRun, 'function'); const store = memoryStore();
  await assert.rejects(reserve(store), /budget/i); assert.equal(store.objects.size, 0);
});

test('loss of an earlier valid booking refuses a later exact retry', async () => {
  const store = await fresh(); await reserve(store); await reconcile(store);
  await reserve(store, identity({ uuid: other }));
  store.damage('d570/ledger/2026-11.json', row => row.entries = row.entries.filter(e => e.identity.uuid !== uuid));
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
});

test('loss of a completed booking cannot reduce a new run admission total', async () => {
  const store = await fresh(); await reserve(store); await reconcile(store);
  store.damage('d570/ledger/2026-11.json', row => row.entries = []);
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active, null);
});

test('a syntactically valid ledger over one MiB refuses before any new write', async () => {
  const store = await fresh(); const previous = store.objects.get('d570/ledger/active.json');
  previous.body = Buffer.concat([previous.body, Buffer.alloc(1024 * 1024, 32)]);
  await assert.rejects(reserve(store), /budget/i); assert.equal(store.writes.length, 3);
});

test('confirmed no-resource cleanup recovers a partial reservation after its deadline', async () => {
  const store = await fresh(); let fail = true;
  store.beforePut = key => { if (fail && key === 'd570/ledger/2026-12.json') { fail = false; throw new Error('lost controller'); } };
  await assert.rejects(reserve(store), /lost controller/);
  await assert.doesNotReject(reconcile(store));
  assert.equal(store.body('d570/ledger/active.json').active, null);
  for (const month of ['2026-11', '2026-12']) assert.equal(store.body(`d570/ledger/${month}.json`).entries.length, 1);
});

for (const field of ['terminated', 'volumesAbsent', 'interfacesAbsent', 'billingReconciled', 'protectionHealthy']) {
  test(`partial cleanup with unknown ${field} still preserves active ownership`, async () => {
    const store = await fresh(); let fail = true;
    store.beforePut = key => { if (fail && key === 'd570/ledger/2026-12.json') { fail = false; throw new Error('lost controller'); } };
    await assert.rejects(reserve(store), /lost controller/); const before = clone([...store.objects]);
    await assert.rejects(reconcile(store, confirmed({ [field]: false })), /budget/i);
    assert.deepEqual(clone([...store.objects]), before);
  });
}

for (const during of ['active-read', 'month-read']) test(`a retry loses admission when cleanup completes during its ${during}`, async () => {
  const store = await fresh(); await reserve(store); const get = store.get; let once = true;
  store.get = async key => {
    const old = await get(key);
    if (once && key === (during === 'active-read' ? 'd570/ledger/active.json' : 'd570/ledger/2026-11.json')) {
      once = false; await reconcile(store); await reserve(store, identity({ uuid: other }));
    }
    return old;
  };
  await assert.rejects(reserve(store), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, other);
});

test('cleanup argument and observations cannot together replace the current owner UUID', async () => {
  const store = await fresh(); await reserve(store);
  await assert.rejects(budget.reconcileRun({ scope, uuid: other, observations: confirmed({ uuid: other }), now: confirmed().observedAt, store }), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
});

for (const during of ['active-read', 'month-read']) test(`a completed retry cannot return admission from unchanged booked months during ${during}`, async () => {
  const store = await fresh(); await reserve(store); const get = store.get; let once = true;
  store.get = async key => {
    const old = await get(key);
    if (once && key === (during === 'active-read' ? 'd570/ledger/active.json' : 'd570/ledger/2026-11.json')) { once = false; await reconcile(store); }
    return old;
  };
  await assert.rejects(reserve(store), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active, null);
});

for (const [label, change] of [
  ['completion evidence hash', row => row.completed[0].evidenceHash = 'f'.repeat(64)],
  ['completion identity hash', row => row.completed[0].identityHash = 'f'.repeat(64)],
  ['completion cost', row => row.completed[0].observations.actualMicroUsd = 1],
  ['completion observation time', row => row.completed[0].observations.observedAt = '2026-11-06T14:21:00Z'],
  ['lost completion', row => row.completed = []],
]) test(`damaged ${label} cannot admit another run`, async () => {
  const store = await fresh(); await reserve(store); await reconcile(store);
  store.damage('d570/ledger/active.json', change);
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
});

test('cleanup cannot permanently record a damaged active identity', async () => {
  const store = await fresh(); await reserve(store);
  store.damage('d570/ledger/active.json', row => row.active.identity.head = 'f'.repeat(40));
  await assert.rejects(reconcile(store), /budget/i);
});

function resealActive(store, change) {
  const value = store.body('d570/ledger/active.json'); delete value.integrity; change(value);
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  value.integrity = createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
  store.objects.get('d570/ledger/active.json').body = Buffer.from(JSON.stringify(value));
}

for (const [label, change] of [
  ['completed identity relation', row => row.completed[0].identityHash = 'f'.repeat(64)],
  ['completed evidence relation', row => row.completed[0].evidenceHash = 'f'.repeat(64)],
  ['orphaned monthly booking', row => row.completed = []],
]) test(`even a checksum-valid ${label} must correlate to monthly history`, async () => {
  const store = await fresh(); await reserve(store); await reconcile(store);
  resealActive(store, change);
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
});

test('checksum-valid active identity must still match its original bookings during cleanup', async () => {
  const store = await fresh(); await reserve(store);
  resealActive(store, row => row.active.identity.head = 'f'.repeat(40));
  await assert.rejects(reconcile(store), /budget/i);
});

for (const partial of [false, true]) test(`${partial ? 'partial' : 'reserved'} retry requires every remembered month, including unrelated months`, async () => {
  const proof = evidence(); proof.openings['2027-01'] = { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'f'.repeat(64) };
  const store = await fresh({ evidence: proof });
  if (partial) {
    let fail = true; store.beforePut = key => { if (fail && key === 'd570/ledger/2026-12.json') { fail = false; throw new Error('lost controller'); } };
    await assert.rejects(reserve(store), /lost controller/);
  } else await reserve(store);
  store.objects.delete('d570/ledger/2027-01.json');
  await assert.rejects(reserve(store), /budget/i);
});

for (const change of [{ account: '949687825720' }, { region: 'us-east-1' }]) test(`the observed scope refuses ${JSON.stringify(change)} before any setup write`, async () => {
  const store = memoryStore(), actual = { ...scope, ...change }, proof = evidence({ account: actual.account, region: actual.region });
  await assert.rejects(budget.initializeLedger({ scope: actual, evidence: proof, now, store }), /budget/i); assert.equal(store.objects.size, 0);
});

for (const failureAt of ['2026-11', '2026-12']) test(`partial retry after ${failureAt} failure cannot lose an earlier completed booking`, async () => {
  const store = await fresh(); await reserve(store); await reconcile(store); let fail = true;
  store.beforePut = key => { if (fail && key === `d570/ledger/${failureAt}.json`) { fail = false; throw new Error('lost controller'); } };
  await assert.rejects(reserve(store, identity({ uuid: other })), /lost controller/);
  store.damage('d570/ledger/2026-11.json', row => row.entries = row.entries.filter(entry => entry.identity.uuid !== uuid));
  await assert.rejects(reserve(store, identity({ uuid: other })), /budget/i);
});

test('cleanup refuses a validly shaped lost booking and a checksum-valid future schema', async () => {
  for (const change of [s => s.damage('d570/ledger/2026-11.json', row => row.entries = []), s => resealActive(s, row => row.schema = 'future')]) {
    const store = await fresh(); await reserve(store); change(store);
    await assert.rejects(reconcile(store), /budget/i);
  }
});

test('future cleanup observations cannot release a currently owned reservation', async () => {
  const store = await fresh(); await reserve(store);
  await assert.rejects(budget.reconcileRun({ scope, uuid, observations: confirmed(), now: '2026-11-06T14:19:59Z', store }), /budget/i);
  assert.equal(store.body('d570/ledger/active.json').active.identity.uuid, uuid);
});

test('an impossible calendar time refuses even when normalized dates would fit the lifetime', async () => {
  const at = '2026-11-06T00:30:00Z', proof = evidence({ observedAt: at }); const store = await fresh({ now: at, evidence: proof });
  await assert.rejects(reserve(store, identity({ startedAt: '2026-11-05T24:00:00Z', expiry: '2026-11-06T01:00:00Z', liabilityUntil: '2026-12-06T01:00:00Z' }), proof, at), /budget/i);
});

test('receipt liability beyond 31 days refuses independently of the run lifetime', async () => {
  const store = await fresh(); await assert.rejects(reserve(store, identity({ liabilityUntil: '2026-12-07T14:15:01Z' })), /budget/i);
});

test('the first booking in an unseen month is create-only and contains the full charge', async () => {
  const initial = evidence(); delete initial.openings['2026-12']; const store = await fresh({ evidence: initial });
  await reserve(store); const writes = store.writes.filter(w => w.key === 'd570/ledger/2026-12.json');
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].condition, { ifNoneMatch: '*' });
  assert.equal(writes[0].body.entries[0].upperMicroUsd, 1000000);
});

test('a new month at the cap refuses without taking partial active ownership', async () => {
  const initial = evidence(); delete initial.openings['2026-12']; const store = await fresh({ evidence: initial });
  const proof = evidence(); proof.openings['2026-12'].baselineMicroUsd = 18800000;
  await assert.rejects(reserve(store, identity(), proof), /budget/i); assert.equal(store.body('d570/ledger/active.json').active, null);
});

test('three UTC months each retain the full charge through the final liability boundary', async () => {
  const at = '2026-11-30T23:00:00Z', proof = evidence({ observedAt: at }); proof.openings['2027-01'] = { ...proof.openings['2026-12'] };
  const initial = clone(proof); delete initial.openings['2026-12']; delete initial.openings['2027-01'];
  const store = await fresh({ now: at, evidence: initial });
  const result = await reserve(store, identity({ startedAt: at, expiry: '2026-12-01T01:00:00Z', liabilityUntil: '2027-01-01T01:00:00Z' }), proof, at);
  assert.deepEqual(result.months, ['2026-11', '2026-12', '2027-01']);
  for (const month of result.months) assert.equal(store.body(`d570/ledger/${month}.json`).entries[0].upperMicroUsd, 1000000);
});

test('a stale initial clock refuses before any reservation write', async () => {
  const store = await fresh(), writes = store.writes.length;
  await assert.rejects(budget.reserveRun({ scope, identity: identity(), evidence: evidence(), now, store, clock: () => Date.parse('2026-11-06T14:15:00Z') }), /budget/i);
  assert.equal(store.writes.length, writes);
});

test('a fourteenth remembered month refuses before taking active ownership', async () => {
  const proof = evidence({ openings: {} });
  for (let index = 0; index < 13; index++) {
    const date = new Date(Date.UTC(2025, 9 + index, 1));
    proof.openings[date.toISOString().slice(0, 7)] = { baselineMicroUsd: 0, overheadMicroUsd: 200000, digest: 'd'.repeat(64) };
  }
  const store = await fresh({ evidence: proof }), writes = store.writes.length;
  await assert.rejects(reserve(store), /budget/i); assert.equal(store.writes.length, writes);
});

test('an exact cleanup retry after a lost successful response is acknowledged without writes', async () => {
  const store = await fresh(); await reserve(store); await reconcile(store); const before = clone([...store.objects]);
  await assert.doesNotReject(reconcile(store)); assert.deepEqual(clone([...store.objects]), before);
});

test('S3 absence requires the documented not-found status and writes retain their prefix boundary', async () => {
  const error = Object.assign(new Error('uncertain'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 500 } });
  const missing = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => { throw error; } } });
  await assert.rejects(missing.get('d570/ledger/active.json'), e => e === error);
  let calls = 0; const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => { calls++; return { ETag: '"etag"' }; } } });
  await assert.rejects(store.put('d570/payload/foreign', Buffer.from('{}'), { ifNoneMatch: '*' }), /budget/i); assert.equal(calls, 0);
});

test('S3 stream overflow stops consumption before reading the remainder', async () => {
  let chunks = 0;
  const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => ({ ContentLength: 1024 * 1024, ETag: '"etag"', Body: (async function* () { for (let index = 0; index < 64; index++) { chunks++; yield Buffer.alloc(256 * 1024); } })() }) } });
  await assert.rejects(store.get('d570/ledger/active.json'), /budget/i); assert.equal(chunks, 5);
});

test('refused S3 response headers close the owned response stream', async () => {
  let closed = false;
  const body = { destroy() { closed = true; }, async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); } };
  const store = budget.createS3LedgerStore({ bucket: 'd570-synthetic', aws: { call: async () => ({ ContentLength: 1024 * 1024 + 1, ETag: '"etag"', Body: body }) } });
  await assert.rejects(store.get('d570/ledger/active.json'), /budget/i); assert.equal(closed, true);
});


// Treating the new bill as another opening would count the same booked run twice.
function inspectBudget(store, billingMicroUsd = 1750000, at = '2026-11-06T14:20:00Z') {
  assert.equal(typeof budget.inspectBudget, 'function', 'missing retained-history budget inspection');
  return budget.inspectBudget({ scope, now: at, billingMicroUsd, store });
}

test('budget inspection compares current billing with the original opening and each retained booking once', async () => {
  const proof = evidence(); proof.openings['2026-11'].baselineMicroUsd = 1500000;
  const store = await fresh({ evidence: proof }); await reserve(store, identity(), proof); await reconcile(store);
  const before = clone([...store.objects]), writes = store.writes.length;
  assert.deepEqual(await inspectBudget(store), { month: '2026-11', baselineMicroUsd: 1500000,
    overheadMicroUsd: 200000, bookedMicroUsd: 1000000, completedMicroUsd: 500000,
    billingMicroUsd: 1750000, activeUuid: null });
  assert.deepEqual(clone([...store.objects]), before); assert.equal(store.writes.length, writes);
  // A second reservation keeps the original opening; billed spend is not added again.
  await reserve(store, identity({ uuid: other, startedAt: '2026-11-06T14:21:00Z', expiry: '2026-11-06T14:26:00Z',
    liabilityUntil: '2026-12-06T14:26:00Z' }), { ...proof, observedAt: '2026-11-06T14:21:00Z' }, '2026-11-06T14:21:00Z');
  assert.deepEqual(await inspectBudget(store, 2000000, '2026-11-06T14:22:00Z'), { month: '2026-11', baselineMicroUsd: 1500000,
    overheadMicroUsd: 200000, bookedMicroUsd: 2000000, completedMicroUsd: 500000,
    billingMicroUsd: 2000000, activeUuid: other });
});

for (const [label, amount] of [['unknown', undefined], ['negative', -1], ['fractional', 0.5],
  ['nonfinite', Infinity], ['over cap', 20000000], ['unexplained', 1200001]]) {
  test(`budget inspection refuses ${label} billing without a write`, async () => {
    const store = await fresh(); await reserve(store);
    assert.equal(typeof budget.inspectBudget, 'function', 'missing retained-history budget inspection');
    const before = clone([...store.objects]);
    await assert.rejects(budget.inspectBudget({ scope, now, billingMicroUsd: amount, store }), /budget/i);
    assert.deepEqual(clone([...store.objects]), before);
  });
}

test('budget inspection accepts the explained upper boundary without declaring estimated spend settled', async () => {
  const store = await fresh(); await reserve(store);
  assert.deepEqual(await inspectBudget(store, 1200000, now), { month: '2026-11', baselineMicroUsd: 0,
    overheadMicroUsd: 200000, bookedMicroUsd: 1000000, completedMicroUsd: 0,
    billingMicroUsd: 1200000, activeUuid: uuid });
  assert.equal(store.body('d570/ledger/active.json').active.state, 'reserved');
});

for (const [label, damage] of [
  ['missing active record', s => s.objects.delete('d570/ledger/active.json')],
  ['missing previous month', s => s.objects.delete('d570/ledger/2026-11.json')],
  ['missing later month', s => s.objects.delete('d570/ledger/2026-12.json')],
  ['changed month', s => s.damage('d570/ledger/2026-12.json', m => m.opening.overheadMicroUsd++)],
  ['unknown object', s => s.objects.set('d570/ledger/unknown.json', { body: Buffer.from('{}'), etag: '"foreign"' })],
  ['corrupt active', s => s.damage('d570/ledger/active.json', a => a.completed = [])],
]) test(`budget inspection refuses ${label} even when the current bill fits`, async () => {
  const store = await fresh(); await reserve(store); await reconcile(store); damage(store);
  const before = clone([...store.objects]);
  await assert.rejects(inspectBudget(store, 0), /budget/i);
  assert.deepEqual(clone([...store.objects]), before);
});

test('budget inspection cannot silently start a month missing from retained history', async () => {
  const store = await fresh(); const before = clone([...store.objects]);
  await assert.rejects(inspectBudget(store, 0, '2027-01-01T00:00:00Z'), /budget/i);
  assert.deepEqual(clone([...store.objects]), before);
});

test('budget inspection refuses a completion dated after its observation', async () => {
  const store = await fresh(); await reserve(store); await reconcile(store);
  await assert.rejects(inspectBudget(store, 0, now), /budget/i);
});

test('budget inspection notices a controller changing ownership while reading monthly history', async () => {
  const store = await fresh(); await reserve(store);
  const get = store.get; let changed = false;
  store.get = async key => {
    const row = await get(key);
    if (!changed && key === 'd570/ledger/2026-11.json') { changed = true; await reconcile(store); }
    return row;
  };
  await assert.rejects(inspectBudget(store, 0), /budget/i);
});

test('the approved twenty-dollar limit permits a reconciled opening above ten dollars',async()=>{
 const proof=evidence();proof.openings['2026-11'].baselineMicroUsd=11000000;
 const store=await fresh({evidence:proof});const result=await reserve(store,identity(),proof);
 assert.equal(result.upperMicroUsd,1000000);
 assert.equal(store.body('d570/ledger/2026-11.json').opening.baselineMicroUsd,11000000);
 assert.equal(store.body('d570/ledger/2026-11.json').entries.length,1);
});
