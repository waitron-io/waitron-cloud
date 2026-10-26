import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerFailureTrace } from './worker-diagnostic.mjs';

const bad = { message: 'Invalid cloud cost worker diagnostic' };
const native = flags => ({ kind: 'native', operation: 'replicate', code: 1,
  signal: null, stderrBytes: 12, stderrFlags: flags });

// Index accessors can change a validated keyword into private text during copying.
for (const location of ['trace', 'flags']) {
  for (const shape of ['sparse', 'accessor', 'extra', 'symbol', 'nonenumerable',
    'prototype', 'iterator', 'every', 'proxy', 'revokedProxy']) {
    test(`workerTraceRejectsNonDataArray_${location}_${shape}`, () => {
      let calls = 0;
      let array = location === 'trace' ? [native(['error'])] : ['error'];
      if (shape === 'sparse') delete array[0];
      if (shape === 'accessor') Object.defineProperty(array, 0, {
        enumerable: true, get() { calls++; return calls < 3 ? 'error' : 'PRIVATE_FLAG_CANARY'; },
      });
      if (shape === 'extra') array.privateText = 'PRIVATE_ARRAY_CANARY';
      if (shape === 'symbol') array[Symbol('PRIVATE_ARRAY_CANARY')] = true;
      if (shape === 'nonenumerable') Object.defineProperty(array, 'privateText', { value: 'PRIVATE_ARRAY_CANARY' });
      if (shape === 'prototype') Object.setPrototypeOf(array, Object.create(Array.prototype));
      if (shape === 'iterator') Object.defineProperty(array, Symbol.iterator, {
        value: function* () { calls++; yield location === 'trace' ? native(['error']) : 'error'; },
      });
      if (shape === 'every') Object.defineProperty(array, 'every', {
        value() { calls++; return true; },
      });
      if (shape === 'proxy') array = new Proxy(array, {
        get(target, key, receiver) { calls++; return Reflect.get(target, key, receiver); },
        getPrototypeOf(target) { calls++; return Reflect.getPrototypeOf(target); },
        ownKeys(target) { calls++; return Reflect.ownKeys(target); },
      });
      if (shape === 'revokedProxy') {
        const revocable = Proxy.revocable(array, {}); revocable.revoke(); array = revocable.proxy;
      }
      const trace = location === 'trace' ? array : [native(array)];
      assert.throws(() => workerFailureTrace(trace), bad);
      assert.equal(calls, 0, 'reject executable array properties without calling them');
    });
  }
}

test('workerTraceRejectsChangingFlagAccessorsBeforePrivateTextCanEscape', () => {
  let reads = 0;
  const flags = ['error'];
  Object.defineProperty(flags, 0, { enumerable: true,
    get() { return ++reads < 3 ? 'error' : 'PRIVATE_FLAG_CANARY'; } });
  assert.throws(() => workerFailureTrace([native(flags)]), bad);
  assert.equal(reads, 0);
});

test('workerTraceRejectsProxyRecordsWithoutReadingThem', () => {
  let reads = 0;
  const record = new Proxy(native(['error']), {
    get(target, key) { reads++; return target[key]; },
    getPrototypeOf(target) { reads++; return Object.getPrototypeOf(target); },
  });
  assert.throws(() => workerFailureTrace([record]), bad);
  assert.equal(reads, 0);
});

test('workerTraceKeepsDenseBoundaryArraysAndReturnsAnIndependentCopy', () => {
  assert.deepEqual(workerFailureTrace([]), []);
  assert.deepEqual(workerFailureTrace([native([])]), [native([])]);
  const flags = ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction'];
  const source = Array.from({ length: 32 }, () => native([...flags]));
  const result = workerFailureTrace(source);
  assert.equal(result.length, 32);
  assert.deepEqual(result[0], { kind: 'native', operation: 'replicate', code: 1,
    signal: null, stderrBytes: 12, stderrFlags: ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction'] });
  source[0].stderrFlags[0] = 'PRIVATE_LATER_VALUE'; source.length = 0;
  assert.equal(result.length, 32);
  assert.deepEqual(result[0].stderrFlags, ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction']);
});
