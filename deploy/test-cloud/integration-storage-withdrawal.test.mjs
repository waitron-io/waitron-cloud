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
    pause: async ms => {clock += ms;}, put: async () => {}, get: async () => {throw denied();}}), /integration.storage_withdrawal_required/);
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
