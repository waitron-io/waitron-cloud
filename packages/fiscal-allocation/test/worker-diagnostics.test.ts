import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWorkerResults } from './worker-diagnostics.ts';
import { randomUUID } from 'node:crypto';
import { authorityFixture } from './continuity-fixture.ts';
import { reserve } from './fixtures.ts';

test('a missing worker receipt reports its refusal and rethrows the identical allocation assertion', () => {
  const results = [
    { receipt: { payload: { allocation: { installationIdentity: 'C000001' } } } },
    { code: 'continuity_unavailable' },
  ];
  let failure: unknown;
  try {
    assert.deepEqual(results.map(r => r.receipt?.payload.allocation.installationIdentity).sort(),
      ['C000001', 'C000002']);
  } catch (error) { failure = error; }
  assert.ok(failure);
  const lines: string[] = [];
  assert.throws(() => assertWorkerResults('reserve', results, () => { throw failure; },
    line => { lines.push(line); }), error => error === failure);
  assert.deepEqual(lines.map(line => JSON.parse(line)), [{
    fiscalWorkers: 'reserve',
    results: [{ code: 'none', receipt: true }, { code: 'continuity_unavailable', receipt: false }],
  }]);
});

for (const code of ['invalid_input', 'permission_denied', 'entitlement_unavailable',
  'custody_unavailable', 'continuity_unavailable', 'history_uncertain', 'binding_conflict',
  'allocation_unavailable', 'space_exhausted', 'reservation_untrusted', 'unexpected_error',
  '57014', '40P01', '40001', 'session_unavailable', 'session_expired', 'csrf_invalid']) {
  test(`a refused retry reports the fixed worker code ${code}`, () => {
    const failure = Error('original retry failure');
    const lines: string[] = [];
    assert.throws(() => assertWorkerResults('retry', [{ code }], () => { throw failure; },
      line => { lines.push(line); }), error => error === failure);
    assert.deepEqual(lines.map(line => JSON.parse(line)), [{
      fiscalWorkers: 'retry', results: [{ code, receipt: false }],
    }]);
  });
}

test('worker failure reporting omits private fields, arbitrary codes, accessors and inherited values', () => {
  let reads = 0;
  const privateResult = {
    code: { toString() { reads++; return 'permission_denied'; } },
    token: 'private session', csrf: 'private csrf', connection: 'private database',
    receipt: { payload: 'private fiscal data', toJSON() { reads++; throw Error('private'); } },
    toJSON() { reads++; throw Error('private result'); },
  };
  const accessor = Object.create({ code: 'permission_denied', receipt: {} }, {
    code: { get() { reads++; throw Error('private code'); } },
    receipt: { get() { reads++; throw Error('private receipt'); } },
  });
  const lines: string[] = [];
  const failure = Error('original refusal');
  const check = () => { throw failure; };
  for (const results of [[privateResult, accessor],
    [{ code: 'private arbitrary error' }, Object.create({ code: 'binding_conflict', receipt: {} })]]) {
    assert.throws(() => assertWorkerResults('reserve', results, check,
      line => { lines.push(line); }), error => error === failure);
  }
  assert.equal(reads, 0);
  assert.deepEqual(lines.map(line => JSON.parse(line)), [
    { fiscalWorkers: 'reserve', results: [{ code: 'unknown', receipt: true }, { code: 'none', receipt: false }] },
    { fiscalWorkers: 'reserve', results: [{ code: 'unknown', receipt: false }, { code: 'none', receipt: false }] },
  ]);
});

test('worker failure diagnostics inspect at most the two expected workers', () => {
  const results: unknown[] = [{ code: 'history_uncertain' }, null];
  Object.defineProperty(results, 2, { get() { throw Error('must not inspect extra response'); } });
  results.length = 10000;
  const failure = Error('original count failure');
  const lines: string[] = [];
  assert.throws(() => assertWorkerResults('reserve', results, () => { throw failure; },
    line => { lines.push(line); }), error => error === failure);
  assert.deepEqual(lines.map(line => JSON.parse(line)), [{
    fiscalWorkers: 'reserve', results: [{ code: 'history_uncertain', receipt: false }, { code: 'none', receipt: false }],
  }]);
  assert.ok(lines[0]!.length < 256);
});

for (const broken of ['sink', 'inspection'] as const) {
  test(`a broken diagnostic ${broken} cannot replace the original worker failure`, () => {
    const failure = Error('original allocation assertion');
    const results = broken === 'inspection'
      ? [new Proxy({}, { getOwnPropertyDescriptor() { throw Error('inspection failed'); } })]
      : [{ code: 'continuity_unavailable' }];
    let emitted = false;
    assert.throws(() => assertWorkerResults('reserve', results, () => { throw failure; }, () => {
      emitted = true;
      throw Error('sink failed');
    }), error => error === failure);
    assert.equal(emitted, broken === 'sink');
  });
}

test('successful worker checks return their exact result without inspecting or logging worker data', () => {
  const value = {};
  const results = new Proxy([], { get() { throw Error('success must not inspect results'); } });
  assert.equal(assertWorkerResults('reserve', results, () => value, () => {
    assert.fail('success must not log');
  }), value);
});

test('an actual independent worker refusal reaches the failed receipt assertion without private output', async () => {
  const authority = await authorityFixture();
  try {
    const original = await authority.worker('fence', {});
    await authority.worker('fence', {});
    const result = await authority.worker('reserve', {
      input: reserve(), accountId: randomUUID(), grant: original.grant,
    });
    const lines: string[] = [];
    assert.throws(() => assertWorkerResults('reserve', [result], () => {
      assert.ok(result.receipt, 'the worker must retain its receipt');
    }, line => { lines.push(line); }), { code: 'ERR_ASSERTION' });
    assert.deepEqual(lines.map(line => JSON.parse(line)), [{
      fiscalWorkers: 'reserve', results: [{ code: 'history_uncertain', receipt: false }],
    }]);
  } finally {
    await authority.close();
  }
});
