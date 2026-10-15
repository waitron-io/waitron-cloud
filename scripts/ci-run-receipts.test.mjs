import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-grouped-receipts-'));
  const log = join(root, 'calls');
  try {
    writeFileSync(join(root, 'pnpm'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$RECEIPT_CALLS"\nprintf "suite-output:%s\\n" "$1"\n[ "$1" != "$FAIL_SUITE" ]\n', {mode: 0o700});
    const execute = (receipts, extra = {}) => spawnSync(process.execPath, ['scripts/ci-run-receipts.mjs'], {
      encoding: 'utf8', env: {...process.env, PATH: `${root}:${process.env.PATH}`, RECEIPT_CALLS: log, CI_PLAN: JSON.stringify({receipts}), ...extra},
    });
    run({execute, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('grouped runner executes exactly the selected receipt commands once and retains their output', () => {
  fixture(({execute, calls}) => {
    const result = execute(['test:backup-capacity', 'test:database-recovery-receipt']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), ['test:backup-capacity', 'test:database-recovery-receipt']);
    assert.match(result.stdout, /suite-output:test:backup-capacity/);
    assert.match(result.stdout, /suite-output:test:database-recovery-receipt/);
  });
});

test('a failed receipt fails the grouped job and still runs later selected suites', () => {
  fixture(({execute, calls}) => {
    const result = execute(['test:backup-capacity', 'test:local-stack'], {FAIL_SUITE: 'test:backup-capacity'});
    assert.equal(result.status, 1);
    assert.deepEqual(calls(), ['test:backup-capacity', 'test:local-stack']);
    assert.match(result.stderr, /test:backup-capacity/);
    assert.match(result.stdout, /suite-output:test:local-stack/);
  });
});

test('malformed, empty, duplicate and unknown receipt lists fail before starting any command', () => {
  for (const receipts of [undefined, null, [], 'test:local-stack', ['test:local-stack', 'test:local-stack'], ['test:local-stack', 'proof:local-stack'], ['test:local-stack; echo injected'], [1]]) {
    fixture(({execute, calls}) => {
      const result = execute(receipts);
      assert.equal(result.status, 1);
      assert.deepEqual(calls(), []);
      assert.match(result.stderr, /receipt/i);
    });
  }
  fixture(({execute, calls}) => {
    assert.equal(execute([], {CI_PLAN: '{'}).status, 1);
    assert.deepEqual(calls(), []);
  });
});
