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
    run({execute, pnpm: join(root, 'pnpm'), calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []});
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

test('a command killed by a signal and a command that cannot start fail the grouped job', () => {
  fixture(({execute, calls, pnpm}) => {
    writeFileSync(pnpm, '#!/bin/sh\nkill -TERM $$\n', {mode: 0o700});
    const signalled = execute(['test:local-stack']);
    assert.equal(signalled.status, 1);
    assert.match(signalled.stderr, /test:local-stack failed: SIGTERM/);
    assert.deepEqual(calls(), []);
    rmSync(pnpm);
    const missing = execute(['test:local-stack'], {PATH: pnpm});
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /test:local-stack failed:.*ENOENT/);
  });
});

test('two receipt workers overlap independent suites, drain failures and never admit a third early', () => {
  fixture(({execute, calls, pnpm}) => {
    writeFileSync(pnpm, `#!/bin/sh
printf '%s\\n' "$1" >> "$RECEIPT_CALLS"
case "$1" in
  test:backup-capacity|test:local-stack)
    touch "$RECEIPT_CALLS.$1"
    deadline=$(( $(date +%s) + 5 ))
    until [ -f "$RECEIPT_CALLS.test:backup-capacity" ] && [ -f "$RECEIPT_CALLS.test:local-stack" ]; do
      [ "$(date +%s)" -lt "$deadline" ] || exit 21
      sleep 0.02
    done
    touch "$RECEIPT_CALLS.$1.done"
    [ "$1" != test:backup-capacity ] || exit 7
    ;;
  test:database-recovery-receipt)
    [ -f "$RECEIPT_CALLS.test:backup-capacity.done" ] || [ -f "$RECEIPT_CALLS.test:local-stack.done" ] || exit 22
    ;;
esac
printf 'suite-output:%s\\n' "$1"
`, {mode: 0o700});
    const result = execute(['test:backup-capacity', 'test:local-stack', 'test:database-recovery-receipt'], {CI_RECEIPT_CONCURRENCY: '2'});
    assert.equal(result.status, 1);
    assert.deepEqual(calls().sort(), ['test:backup-capacity', 'test:database-recovery-receipt', 'test:local-stack']);
    assert.match(result.stderr, /test:backup-capacity failed: 7/);
    assert.doesNotMatch(result.stderr, /failed: (?:21|22)/);
    assert.match(result.stdout, /suite-output:test:local-stack/);
    assert.match(result.stdout, /suite-output:test:database-recovery-receipt/);
  });
});

test('invalid receipt worker counts fail before any command starts', () => {
  for (const value of ['', '0', '3', '1.5', 'two']) fixture(({execute, calls}) => {
    const result = execute(['test:backup-capacity'], {CI_RECEIPT_CONCURRENCY: value});
    assert.equal(result.status, 1);
    assert.deepEqual(calls(), []);
    assert.match(result.stderr, /concurrency/i);
  });
});
