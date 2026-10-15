import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

for (const file of ['ci-capacity-receipt.test.mjs', 'ci-database-receipt.test.mjs', 'ci-gateway-receipt.test.mjs', 'ci-local-stack-receipt.test.mjs']) {
  test(`${file} leaves no automatic Git maintenance writer for cleanup`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-receipt-maintenance-'));
    const trace = join(root, 'git-trace.json');
    const env = {...process.env, GIT_TRACE2_EVENT: trace};
    delete env.NODE_TEST_CONTEXT;
    try {
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^unrelated package changes omit', `scripts/${file}`],
        {env, encoding: 'utf8', timeout: 30_000});
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^# tests 1$/m);
      assert.match(result.stdout, /^# pass 1$/m);
      const events = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(events.some(event => event.event === 'start' && event.argv?.includes('commit')), 'The real fixture commit must execute and be traced');
      const maintenance = events.filter(event => event.event === 'child_start' && event.argv?.includes('maintenance'));
      assert.deepEqual(maintenance, [], 'Disposable receipt repositories must not start automatic maintenance that can write during cleanup');
    } finally {rmSync(root, {recursive: true, force: true});}
  });
}
