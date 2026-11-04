import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';

const id = 'a'.repeat(64);

test('a completed verifier disappearing before inspect is accepted only after confirmed absence', async () => {
  assert.equal(typeof capacity.inspectCapacityVerifier, 'function', 'Transient verifier inspection is not implemented');
  const calls = [];
  const result = await capacity.inspectCapacityVerifier(async args => {
    calls.push(args);
    if (args[0] === 'inspect') throw Error('docker.missing');
    assert.deepEqual(args, ['ps', '-aq', '--no-trunc', '--filter', 'id=' + id]); return '';
  }, id);
  assert.equal(result, undefined);
  assert.deepEqual(calls, [['inspect', id], ['ps', '-aq', '--no-trunc', '--filter', 'id=' + id]]);
});

test('an inspect failure for a still present child or an unavailable daemon remains a failure', async () => {
  assert.equal(typeof capacity.inspectCapacityVerifier, 'function', 'Transient verifier inspection is not implemented');
  for (const present of [true, false]) {
    await assert.rejects(capacity.inspectCapacityVerifier(async args => {
      if (args[0] === 'inspect') throw Error('docker.inspect_refused');
      if (present) return id;
      throw Error('docker.daemon_unavailable');
    }, id), {message: present ? 'docker.inspect_refused' : 'docker.daemon_unavailable'});
  }
});

test('a successful inspect returns exactly the requested child and does not hide malformed output', async () => {
  assert.equal(typeof capacity.inspectCapacityVerifier, 'function', 'Transient verifier inspection is not implemented');
  const row = {Id: id, State: {Running: true}};
  assert.deepEqual(await capacity.inspectCapacityVerifier(async args => {
    assert.deepEqual(args, ['inspect', id]); return JSON.stringify([row]);
  }, id), row);
  for (const output of ['[]', '{}', JSON.stringify([{...row, Id: 'b'.repeat(64)}]), JSON.stringify([row, row])]) {
    await assert.rejects(capacity.inspectCapacityVerifier(async args => {
      assert.equal(args[0], 'inspect'); return output;
    }, id));
  }
});
