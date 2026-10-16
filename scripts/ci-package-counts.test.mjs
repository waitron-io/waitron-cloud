import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const members = ['@waitron-cloud/identity', '@waitron-cloud/operations'];

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-package-counts-'));
  try {
    const source = join(root, 'venue.test.mjs');
    writeFileSync(source, `import test from 'node:test'; test('retains venue identity', () => {}); test.skip('optional platform', () => {}); test.todo('future check');\n`);
    const calls = join(root, 'calls');
    writeFileSync(join(root, 'pnpm'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$PACKAGE_CALLS"\nif [ "$2" = "$EMPTY_PACKAGE" ]; then exit 0; fi\nif [ "$2" = "$FORGED_PACKAGE" ]; then printf '%s\\n' "$FORGED_SUMMARY"; exit 0; fi\nexec "$COUNT_NODE" --test --test-reporter="$COUNT_REPORTER" "$COUNT_SOURCE"\n`, {mode: 0o700});
    const execute = (extra = {}) => {
      const env = {...process.env, PATH: `${root}:${process.env.PATH}`, PACKAGE_CALLS: calls,
        COUNT_NODE: process.execPath, COUNT_SOURCE: source, COUNT_REPORTER: 'tap',
        CI_PACKAGE_GROUP: JSON.stringify({package: members.join(' + '), members, shard: 1}), ...extra};
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, ['scripts/ci-run-package-group.mjs'], {encoding: 'utf8', timeout: 10_000, env});
    };
    run({execute, calls: () => readFileSync(calls, 'utf8').trim().split('\n')});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('a zero exit without executed tests fails its package and still runs the next package', () => {
  fixture(({execute, calls}) => {
    const result = execute({EMPTY_PACKAGE: members[0]});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(calls(), members.map(name => `--filter ${name} test`));
    assert.match(result.stdout, /Package @waitron-cloud\/identity: FAIL/);
    assert.match(result.stdout, /Package @waitron-cloud\/operations: PASS/);
    assert.match(result.stderr, /test summary/i);
  });
});

test('real TAP and spec summaries report per-package counts while retaining test output', () => {
  for (const COUNT_REPORTER of ['tap', 'spec']) fixture(({execute, calls}) => {
    const result = execute({COUNT_REPORTER});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls(), members.map(name => `--filter ${name} test`));
    for (const name of members) assert.ok(result.stdout.includes(`Package ${name}: PASS (3 tests, 1 passed, 1 skipped, 1 todo;`), result.stdout);
    assert.match(result.stdout, /retains venue identity/);
    assert.match(result.stdout, /optional platform/);
  });
});

test('zero, incomplete, duplicate, failed and inconsistent summaries cannot pass with a zero exit', () => {
  const summary = '# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  for (const FORGED_SUMMARY of [
    summary.replaceAll('3', '0'), summary.replace('# pass 3\n', ''), summary + '# pass 3\n',
    summary.replace('# pass 3', '# pass 2'), summary.replace('# tests 3', '# tests 3.5'),
    summary.replaceAll('3', '9007199254740993'),
    summary.replace('# pass 3', '# pass 2').replace('# fail 0', '# fail 1'),
    summary.replace('# pass 3', '# pass 2').replace('# cancelled 0', '# cancelled 1'),
    summary.replace('# pass 3', '# pass 0').replace('# skipped 0', '# skipped 3'),
  ]) fixture(({execute, calls}) => {
    const result = execute({FORGED_PACKAGE: members[0], FORGED_SUMMARY});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(calls(), members.map(name => `--filter ${name} test`));
    assert.match(result.stdout, /Package @waitron-cloud\/operations: PASS/);
    assert.match(result.stderr, /test summary/i);
  });
});
