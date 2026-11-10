import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';

test('read-only CI status distinguishes slot admission from worker execution and preserves its input files', () => {
  const result = spawnSync('python3', ['-B', new URL('../../deploy/disposable-tests/ci-status.test.py', import.meta.url).pathname], {encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 25 tests/);
});
