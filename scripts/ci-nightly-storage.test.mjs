import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const storage = await import('./ci-nightly-storage.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./ci-nightly-storage.mjs', import.meta.url).href) return {};
  throw error;
});
const settings = {workload: 'paced-207-v1', sales: 207, cadenceFactor: 100,
  startupSeconds: 2, idleSeconds: 2, replayWindowSeconds: 120, streamWindowSeconds: 150};
const runtime = {waitron: 'a'.repeat(40), litestream: '0.5.17', node: 'v26.11.1', platform: 'linux', arch: 'x64'};
const sample = () => ({storage: {status: 'measured', byteSeconds: {low: 5000, high: 6000}},
  retainedStorage: {status: 'measured', byteSeconds: {low: 4096, high: 8192}}});

// Losing the cleanup tail or selecting a midpoint changes these hand-derived bounds.
test('producer retains independent storage bounds including cleanup', () => {
  assert.equal(typeof storage.storageObservation, 'function', 'the nightly needs the observed storage interval');
  const result = storage.storageObservation(sample(), settings, runtime);
  assert.deepEqual(result, {status: 'measured', bounds: {low: 9096, high: 14192}, gaps: [], settings, runtime});
  settings.sales = 1;
  try { assert.equal(result.settings.sales, 207); } finally {settings.sales = 207;}
});

for (const field of ['storage', 'retainedStorage']) {
  for (const [name, change] of [
    ['unknown', value => {value.status = 'unknown';}],
    ['null bound', value => {value.byteSeconds.low = null;}],
    ['negative bound', value => {value.byteSeconds.low = -1;}],
    ['nonfinite bound', value => {value.byteSeconds.high = Infinity;}],
    ['reversed bounds', value => {value.byteSeconds.low = 9000;}],
    ['gap', value => {value.gaps = ['PRIVATE_CANARY'];}],
    ['missing bounds', value => {delete value.byteSeconds;}],
  ]) test(`producer reports unusable ${field} ${name} without leaking its input`, () => {
    const input = sample(); change(input[field]);
    const result = storage.storageObservation(input, settings, runtime);
    assert.equal(result.status, 'unusable');
    assert.equal(result.bounds, null);
    assert.deepEqual(result.gaps, ['storage-unavailable']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY/);
  });
}
test('producer refuses overflow of the combined interval', () => {
  const input = sample(); input.storage.byteSeconds = {low: Number.MAX_SAFE_INTEGER, high: Number.MAX_SAFE_INTEGER};
  assert.equal(storage.storageObservation(input, settings, runtime).status, 'unusable');
});
test('a zero lower bound remains an observed bound', () => {
  const input = sample(); input.storage.byteSeconds.low = input.retainedStorage.byteSeconds.low = 0;
  assert.deepEqual(storage.storageObservation(input, settings, runtime).bounds, {low: 0, high: 14192});
});
test('producer exports only the named aggregate settings and runtime pins', () => {
  const result = storage.storageObservation(sample(), {...settings, raw: 'PRIVATE_CANARY'}, {...runtime, raw: 'PRIVATE_CANARY'});
  assert.deepEqual(result.settings, settings);
  assert.deepEqual(result.runtime, runtime);
});

test('producer opt-in writes the aggregate while unset leaves no output', () => {
  assert.equal(typeof storage.exportStorageObservation, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nightly-storage-test-'));
  const messages = [];
  try {
    const input = {stream: sample(), settings, runtime, diagnostic: value => messages.push(value)};
    storage.exportStorageObservation({...input, output: ''});
    assert.deepEqual(readdirSync(root), []);
    assert.deepEqual(messages, []);
    storage.exportStorageObservation({...input, output: join(root, 'observation.json')});
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'observation.json'), 'utf8')).bounds, {low: 9096, high: 14192});
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('an optional export failure reports a fixed message and does not fail the caller', () => {
  assert.equal(typeof storage.exportStorageObservation, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nightly-storage-test-'));
  try {
    const messages = [];
    assert.doesNotThrow(() => storage.exportStorageObservation({output: join(root, 'PRIVATE_CANARY', 'missing.json'),
      stream: sample(), settings, runtime, diagnostic: value => messages.push(value)}));
    assert.deepEqual(messages, ['Cloud cost advisory: storage export unavailable.']);
    assert.doesNotThrow(() => storage.exportStorageObservation({output: root, stream: sample(), settings, runtime,
      diagnostic: () => {throw Error('diagnostic failure');}}));
  } finally {rmSync(root, {recursive: true, force: true});}
});
