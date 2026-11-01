import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-storage-withdrawal.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-storage-withdrawal.mjs')) return {};
  throw error;
});
const denied = () => Object.assign(Error('provider refusal'), {$metadata: {httpStatusCode: 403}});

test('direct withdrawal requires both an old write and an old read to be refused by storage', async () => {
  const {waitForStorageWithdrawal} = await load();
  assert.equal(typeof waitForStorageWithdrawal, 'function', 'Direct storage withdrawal observation is missing');
  let clock = 1000, writes = 0, reads = 0;
  const result = await waitForStorageWithdrawal({startedAt: 1000, now: () => clock,
    pause: async ms => {clock += ms;},
    put: async () => {if (++writes > 1) throw denied();},
    get: async () => {reads++; throw denied();}});
  assert.deepEqual(result, {writeStatus: 403, readStatus: 403, durationMs: 100});
  assert.equal(writes, 2); assert.equal(reads, 1);
});

for (const stage of ['put', 'get']) test('a '+stage+' network failure cannot count as provider withdrawal', async () => {
  const {waitForStorageWithdrawal} = await load();
  assert.equal(typeof waitForStorageWithdrawal, 'function');
  const network = Error('private transport detail');
  await assert.rejects(waitForStorageWithdrawal({startedAt: 1000, now: () => 1000,
    put: async () => {throw stage === 'put' ? network : denied();},
    get: async () => {throw network;}}), error => error === network);
});

test('a still-live writer reaches the unchanged thirty-second withdrawal deadline', async () => {
  const {waitForStorageWithdrawal} = await load();
  assert.equal(typeof waitForStorageWithdrawal, 'function');
  let clock = 1000;
  await assert.rejects(waitForStorageWithdrawal({startedAt: 1000, now: () => clock,
    pause: async ms => {clock += ms;}, put: async () => {assert.ok(clock < 31000, 'The observer issued another write after its deadline');}, get: async () => {throw denied();}}), /integration.storage_withdrawal_required/);
  assert.equal(clock, 31000);
});

test('refusing writes while retaining the old read permission cannot count as withdrawal', async () => {
  const {waitForStorageWithdrawal} = await load();
  assert.equal(typeof waitForStorageWithdrawal, 'function');
  await assert.rejects(waitForStorageWithdrawal({startedAt: 1000, now: () => 1000,
    put: async () => {throw denied();}, get: async () => {}}), /integration.storage_read_still_allowed/);
});

for (const startedAt of [undefined, '1000', -1, 1001, NaN]) test('withdrawal refuses an invalid commit time '+startedAt, async () => {
  const {waitForStorageWithdrawal} = await load();
  assert.equal(typeof waitForStorageWithdrawal, 'function');
  await assert.rejects(waitForStorageWithdrawal({startedAt, now: () => 1000,
    put: async () => {throw denied();}, get: async () => {throw denied();}}), /integration.storage_commit_time/);
});

for (const status of [401, 404, 500]) for (const stage of ['put', 'get']) {
  test(stage+' status '+status+' cannot stand in for the provider’s explicit permission refusal', async () => {
    const {waitForStorageWithdrawal} = await load();
    const failure = Object.assign(Error('other provider status'), {$metadata: {httpStatusCode: status}});
    await assert.rejects(waitForStorageWithdrawal({startedAt: 1000, now: () => 1000,
      put: async () => {throw stage === 'put' ? failure : denied();},
      get: async () => {throw failure;}}), error => error === failure);
  });
}

test('a delayed provider reply after the withdrawal deadline cannot produce accepted evidence', async () => {
  const {waitForStorageWithdrawal} = await load();
  let clock = 1000;
  await assert.rejects(waitForStorageWithdrawal({startedAt: 1000, now: () => clock,
    put: async () => {clock = 31000; throw denied();},
    get: async () => {throw denied();}}), /integration.storage_withdrawal_required/);
});

const selected = {organisationId: '11111111-1111-4111-8111-111111111111', venueId: '22222222-2222-4222-8222-222222222222'};
const saved = {...selected, publicKey: 'the-original-paired-key'};
const binding = {environment: 'test', service_plan: 'free', public_key: 'the-original-paired-key', revoked_at: null, superseded_by: null};
test('the retained reader proof keeps the original paired identity after the plan changes', async () => {
  const {checkStorageWithdrawalReader} = await load();
  assert.equal(typeof checkStorageWithdrawalReader, 'function', 'The retained reader binding check is missing');
  assert.equal(checkStorageWithdrawalReader(saved, binding, selected), true);
});
for (const [key, value] of [['environment', 'production'], ['service_plan', 'paid'], ['public_key', 'another-key'], ['revoked_at', new Date()], ['superseded_by', selected.venueId]]) {
  test('a retained read cannot qualify a changed '+key, async () => {
    const {checkStorageWithdrawalReader} = await load(); assert.equal(typeof checkStorageWithdrawalReader, 'function');
    assert.throws(() => checkStorageWithdrawalReader(saved, {...binding, [key]: value}, selected));
  });
}
for (const key of ['organisationId', 'venueId']) test('a retained reader from another '+key+' cannot qualify', async () => {
  const {checkStorageWithdrawalReader} = await load(); assert.equal(typeof checkStorageWithdrawalReader, 'function');
  assert.throws(() => checkStorageWithdrawalReader({...saved, [key]: '33333333-3333-4333-8333-333333333333'}, binding, selected));
});
const bucket = {endpoint: 'https://waitron.local:8333', region: 'local', bucket: 'venue-' + selected.venueId, prefix: 'streams/' + selected.venueId + '/'};
test('the old direct key is tested only against its canonical paired storage scope', async () => {
  const {checkStorageWithdrawalBucket} = await load(); assert.equal(typeof checkStorageWithdrawalBucket, 'function', 'The direct key scope check is missing');
  assert.equal(checkStorageWithdrawalBucket(bucket, selected.venueId), true);
});
for (const [key, value] of [['endpoint', 'http://waitron.local:8333'], ['region', 'another-region'], ['bucket', 'another-venue'], ['prefix', 'streams/another-venue/']]) {
  test('a substituted direct storage '+key+' cannot qualify', async () => {
    const {checkStorageWithdrawalBucket} = await load(); assert.equal(typeof checkStorageWithdrawalBucket, 'function');
    assert.throws(() => checkStorageWithdrawalBucket({...bucket, [key]: value}, selected.venueId));
  });
}

const beforeOperations = () => ({
  put: async () => ({$metadata: {httpStatusCode: 200}}),
  get: async () => ({$metadata: {httpStatusCode: 200}, Body: {transformToString: async () => 'paired integration retained storage'}}),
  putOutside: async () => {throw denied();}, putNeighbour: async () => {throw denied();},
});
test('the before-downgrade proof requires real accepted bytes and both scope refusals', async () => {
  const {proveStorageBefore} = await load(); assert.equal(typeof proveStorageBefore, 'function', 'The accepted direct storage proof is missing');
  assert.deepEqual(await proveStorageBefore(beforeOperations()), {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true});
});
for (const operation of ['put', 'get']) test('a missing accepted '+operation+' status refuses before-downgrade evidence', async () => {
  const {proveStorageBefore} = await load(); assert.equal(typeof proveStorageBefore, 'function');
  const ops = beforeOperations(); ops[operation] = async () => ({$metadata: {httpStatusCode: 204}, Body: {transformToString: async () => 'paired integration retained storage'}});
  await assert.rejects(proveStorageBefore(ops));
});
test('a different stored body cannot qualify the retained-byte check', async () => {
  const {proveStorageBefore} = await load(); assert.equal(typeof proveStorageBefore, 'function');
  const ops = beforeOperations(); ops.get = async () => ({$metadata: {httpStatusCode: 200}, Body: {transformToString: async () => 'another object'}});
  await assert.rejects(proveStorageBefore(ops));
});
for (const operation of ['putOutside', 'putNeighbour']) {
  test('an accepted '+operation+' refuses scope-isolation evidence', async () => {
    const {proveStorageBefore} = await load(); assert.equal(typeof proveStorageBefore, 'function');
    await assert.rejects(proveStorageBefore({...beforeOperations(), [operation]: async () => {}}));
  });
  test('a network failure at '+operation+' cannot count as an ownership refusal', async () => {
    const {proveStorageBefore} = await load(); assert.equal(typeof proveStorageBefore, 'function');
    const failure = Error('private transport detail');
    await assert.rejects(proveStorageBefore({...beforeOperations(), [operation]: async () => {throw failure;}}));
  });
}
