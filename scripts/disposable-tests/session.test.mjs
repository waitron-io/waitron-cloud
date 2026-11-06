import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';

test('the trusted host transfer binds the lease and refuses altered, escaping or credential payloads', () => {
  const result = spawnSync('python3', ['-B', new URL('../../deploy/disposable-tests/session.test.py', import.meta.url).pathname], {encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 5 tests/);
});
