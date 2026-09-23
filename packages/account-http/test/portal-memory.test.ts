import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
test('concurrent static responses share the built asset instead of copying it for every connection', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', 'test/fixtures/portal-memory.ts'], {encoding: 'utf8', timeout: 15000}));
  assert.equal(result.size, 4 * 1024 * 1024); assert.equal(result.first, 97);
  assert.deepEqual(result.statuses, Array(24).fill(200));
  assert.deepEqual(result.lengths,Array(32).fill(4 * 1024 * 1024));
  assert.ok(result.networkAllocated < 48 * 1024 * 1024, `${result.networkAllocated} bytes allocated with 32 slow clients`);
  assert.ok(result.allocated < 48 * 1024 * 1024, `${result.allocated} bytes allocated for 24 held responses`);
});
