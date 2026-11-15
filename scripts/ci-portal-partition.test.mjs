import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, workPlan} from './ci-scope.mjs';

function prepareRunner(root) {
  mkdirSync(join(root, 'scripts'));
  for (const file of ['ci-run-portal-shard.mjs', 'ci-measured-shards.mjs', 'ci-portal-durations.json', 'ci-required-cases.mjs']) {
    cpSync(new URL(file, import.meta.url), join(root, 'scripts', file));
  }
  writeFileSync(join(root, 'scripts/ci-required-cases.json'), '{}\n');
  mkdirSync(join(root, 'apps/portal/test'), {recursive: true});
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
}

test('six portal partitions discover current and future files exactly once without overlapping fixtures', () => {
  const workspace = loadWorkspace();
  const rows = workPlan({full: false, packages: ['@waitron-cloud/portal']}, workspace).packages;
  assert.equal(rows.length, 6);
  const files = readdirSync(new URL('../apps/portal/test/', import.meta.url))
    .filter(name => name.endsWith('.test.ts')).concat('zz-future-portal.test.ts').sort();
  assert.equal(new Set(files).size, files.length);
  const root = mkdtempSync(join(tmpdir(), 'cloud-portal-shards-'));
  try {
    prepareRunner(root);
    for (const name of files) writeFileSync(join(root, 'apps/portal/test', name), `import test from 'node:test';
import {mkdirSync, rmdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
test(${JSON.stringify(name)}, async () => {
  assert.ok(process.cwd().endsWith('/apps/portal'));
  assert.ok(process.execArgv.includes('--test-timeout=120000'));
  mkdirSync(${JSON.stringify('active-' + name)});
  try {await delay(5);} finally {rmdirSync(${JSON.stringify('active-' + name)});}
});
`);
    writeFileSync(join(root, 'apps/portal/test/.hidden.test.ts'), "throw Error('HIDDEN_FIXTURE_RAN');\n");
    mkdirSync(join(root, 'apps/portal/test/fixtures'));
    writeFileSync(join(root, 'apps/portal/test/fixtures/unrelated.test.ts'), "throw Error('UNRELATED_FIXTURE_RAN');\n");
    const seen = [];
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    for (const row of rows) {
      const output = execFileSync(process.execPath, ['scripts/ci-run-portal-shard.mjs', String(row.shard)],
        {cwd: root, env, encoding: 'utf8', timeout: 30_000});
      const selected = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
      assert.ok(selected.length > 0, `Empty portal shard ${row.shard}`);
      for (const kind of ['fail', 'cancelled', 'skipped']) assert.match(output, new RegExp(`^# ${kind} 0$`, 'm'));
      seen.push(...selected);
    }
    assert.deepEqual(seen.sort(), files);
    for (const shard of ['', '0', '7', '1.5', 'invalid']) {
      const result = spawnSync(process.execPath, ['scripts/ci-run-portal-shard.mjs', shard],
        {cwd: root, env, encoding: 'utf8', timeout: 10_000});
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Invalid portal shard/);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('the portal duration table contains sorted, finite nonnegative millisecond weights', () => {
  const durations = JSON.parse(readFileSync(new URL('./ci-portal-durations.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(durations), Object.keys(durations).sort());
  assert.ok(Object.keys(durations).length > 0);
  for (const [file, duration] of Object.entries(durations)) {
    assert.match(file, /^[^/]+\.test\.ts$/);
    assert.ok(Number.isFinite(duration) && duration >= 0, file);
  }
});

for (const empty of [true, false]) test(empty ? 'an empty portal job refuses unrelated discovery' : 'a selected portal failure fails the runner', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-portal-refusal-'));
  try {
    prepareRunner(root);
    writeFileSync(join(root, empty ? 'apps/portal/unrelated.test.ts' : 'apps/portal/test/a.test.ts'), empty
      ? "import test from 'node:test'; test('unrelated',()=>console.log('UNRELATED_DISCOVERY_RAN'));\n"
      : "import test from 'node:test'; test('selected failure',()=>{throw Error('CONTROLLED_SELECTED_FAILURE')});\n");
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['scripts/ci-run-portal-shard.mjs', '1'],
      {cwd: root, env, encoding: 'utf8', timeout: 10_000});
    assert.equal(result.status, 1, result.stderr + result.stdout);
    if (empty) {
      assert.match(result.stderr, /Empty portal shard/);
      assert.doesNotMatch(result.stdout, /UNRELATED_DISCOVERY_RAN/);
    } else assert.match(result.stderr + result.stdout, /CONTROLLED_SELECTED_FAILURE/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
