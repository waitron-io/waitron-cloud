import assert from 'node:assert/strict';
import test from 'node:test';

const helper = await import('./storage-admin-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const decode = message => JSON.parse(message.slice('storage_admin_progress='.length));

// Removing pending reports hides the operation that outlives the test deadline.
test('a waiting admin operation reports elapsed time before it settles', async t => {
  assert.equal(typeof helper.storageAdminOperations, 'function');
  t.mock.timers.enable({apis:['setInterval']});
  let current = 100, finish;
  t.mock.method(performance, 'now', () => current);
  const messages = [], result = {endpoint:'PRIVATE_ENDPOINT'};
  const run = helper.storageAdminOperations(message => messages.push(message));
  const waiting = run('start-exhausted', () => new Promise(resolve => {finish = resolve;}));
  assert.deepEqual(messages.map(decode), [{operation:'start-exhausted', state:'started', elapsedMs:0, operationElapsedMs:0}]);
  current = 5100;
  t.mock.timers.tick(5000);
  assert.deepEqual(messages.map(decode).at(-1), {operation:'start-exhausted', state:'waiting', elapsedMs:5000, operationElapsedMs:5000});
  finish(result);
  assert.equal(await waiting, result);
  assert.deepEqual(messages.map(decode).at(-1), {operation:'start-exhausted', state:'completed', elapsedMs:5000, operationElapsedMs:5000});
  const count = messages.length;
  current = 10100;
  t.mock.timers.tick(5000);
  assert.equal(messages.length, count, 'settled operations must release their timer');
  assert.ok(!messages.join('').includes('PRIVATE_ENDPOINT'));
});

for (const operation of ['reserve-admin', 'start-exhausted', 'bucket-exhausted', 'stop-exhausted',
  'verify-owners', 'release-admin', 'start-recovered', 'bucket-recovered', 'stop-recovered', 'cleanup']) {
  test('a refused admin operation retains its original error: ' + operation, async t => {
    assert.equal(typeof helper.storageAdminOperations, 'function');
    t.mock.timers.enable({apis:['setInterval']});
    const messages = [], refusal = Object.freeze(Error('PRIVATE_CREDENTIAL'));
    const run = helper.storageAdminOperations(message => messages.push(message));
    await assert.rejects(run(operation, () => {throw refusal;}), error => error === refusal);
    assert.deepEqual(messages.map(decode).map(({operation,state}) => ({operation,state})),
      [{operation,state:'started'}, {operation,state:'refused'}]);
    t.mock.timers.tick(15000);
    assert.equal(messages.length, 2, 'refused operations must release their timer');
    assert.ok(!messages.join('').includes('PRIVATE_CREDENTIAL'));
  });
}

test('an asynchronous rejection and a throwing reporter preserve the exact refusal', async t => {
  assert.equal(typeof helper.storageAdminOperations, 'function');
  t.mock.timers.enable({apis:['setInterval']});
  const refusal = Object.freeze(Error('PRIVATE_ASYNC')), messages = [];
  const run = helper.storageAdminOperations(message => {messages.push(message); throw Error('PRIVATE_REPORTER');});
  let reject;
  const waiting = run('bucket-exhausted', () => new Promise((resolve, refuse) => {reject = refuse;}));
  t.mock.timers.tick(5000);
  reject(refusal);
  await assert.rejects(waiting, error => error === refusal);
  assert.deepEqual(messages.map(decode).map(record => record.state), ['started','waiting','refused']);
  t.mock.timers.tick(5000);
  assert.equal(messages.length, 3);
});

test('the case clock spans operations and the operation clock restarts', async t => {
  assert.equal(typeof helper.storageAdminOperations, 'function');
  let current = 100;
  t.mock.method(performance, 'now', () => current);
  const messages = [], run = helper.storageAdminOperations(message => messages.push(message));
  await run('reserve-admin', () => {current = 400;});
  current = 700;
  await run('start-exhausted', () => {current = 1000;});
  assert.deepEqual(messages.map(decode).at(-1), {operation:'start-exhausted',state:'completed',elapsedMs:900,operationElapsedMs:300});
});

test('unknown labels and rejected values cannot disclose data through diagnostics', async () => {
  assert.equal(typeof helper.storageAdminOperations, 'function');
  let inspections = 0;
  const trapped = new Proxy({}, {get() {inspections++; throw Error('PRIVATE_GETTER');}});
  const messages = [], run = helper.storageAdminOperations(message => messages.push(message));
  for (const operation of ['PRIVATE_ENDPOINT', trapped, null]) {
    const result = await run(operation, () => {throw trapped;})
      .then(() => ({rejected:false}), error => ({rejected:true,error}));
    assert.equal(result.rejected, true);
    assert.equal(result.error, trapped);
  }
  assert.equal(inspections, 0);
  assert.deepEqual(messages, []);
});

// A stuck native child must not turn its diagnostic into unbounded output.
test('a permanently waiting operation caps reports and releases its diagnostic timer', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const messages = [], run = helper.storageAdminOperations(message => messages.push(message));
  let finish;
  const waiting = run('cleanup', () => new Promise(resolve => {finish = resolve;}));
  t.mock.timers.tick(80000);
  assert.equal(messages.length, 17);
  assert.equal(decode(messages.at(-1)).state, 'waiting-limit');
  t.mock.timers.tick(80000);
  assert.equal(messages.length, 17);
  finish();
  await waiting;
  assert.equal(decode(messages.at(-1)).state, 'completed');
});

test('a throwing reporter cannot replace a successful operation result', async () => {
  const result = Object.freeze({ready:true});
  assert.equal(await helper.storageAdminOperations(() => {throw Error('PRIVATE_REPORTER');})('start-recovered', () => result), result);
});

test('a known operation does not inspect an opaque rejection', async () => {
  let inspections = 0;
  const refusal = new Proxy({}, {get() {inspections++; throw Error('PRIVATE_GETTER');}});
  const messages = [];
  const result = await helper.storageAdminOperations(message => messages.push(message))('cleanup', () => {throw refusal;})
    .then(() => ({rejected:false}), error => ({rejected:true,error}));
  assert.equal(result.rejected, true);
  assert.equal(result.error, refusal);
  assert.equal(inspections, 0);
  assert.equal(decode(messages.at(-1)).state, 'refused');
});
