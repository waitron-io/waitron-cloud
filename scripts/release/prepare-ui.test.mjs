import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {reserveRelease} from './ui-ledger.mjs';

const script = resolve('scripts/release/prepare-ui.mjs');
const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
const run = (cwd, file, args) => execFileSync(file, args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ui-preparation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const checkout = join(root, 'source');
  const packageDir = join(checkout, 'packages/ui-core');
  await mkdir(join(packageDir, 'dist'), {recursive: true});
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: '@waitron/ui-core', version: '0.1.0', private: true, type: 'module', files: ['dist'],
    exports: {'.': {import: './dist/index.js'}}, license: 'SEE LICENSE IN dist/LICENSE', peerDependencies: {lit: '^3.2.0'},
  }));
  await writeFile(join(packageDir, 'dist/index.js'), 'export const prepared = true;\n');
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    await writeFile(join(checkout, notice), notice + '\n');
    await writeFile(join(packageDir, 'dist', notice), notice + '\n');
  }
  run(checkout, 'git', ['init']);
  run(checkout, 'git', ['config', 'user.name', 'Preparation test']);
  run(checkout, 'git', ['config', 'user.email', 'preparation@example.invalid']);
  run(checkout, 'git', ['add', '.']);
  run(checkout, 'git', ['commit', '-s', '-m', 'Create source fixture']);
  const commit = run(checkout, 'git', ['rev-parse', 'HEAD']);
  const ledger = reserveRelease({schema: 1, events: []}, {
    source: {repository: 'clintongormley/waitron', commit, version: '0.1.0'},
    inputsSha512: 'b'.repeat(128), recipeSha512: 'c'.repeat(128), sourceChecksSha512: 'd'.repeat(128),
    registryVersions: ['0.1.0'], at: '2026-11-05T20:00:00.000Z',
  });
  const ledgerFile = join(root, 'releases.json');
  await writeFile(ledgerFile, JSON.stringify(ledger));
  const output = join(root, 'output');
  const prepare = (...args) => spawnSync(process.execPath, [script, checkout, output, '--ledger', ledgerFile, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 30000,
  });
  return {root, checkout, commit, ledger, ledgerFile, output, prepare};
}

test('prepares the reserved release from the exact source while preserving notices and source identity', async t => {
  const f = await fixture(t);
  const before = await readFile(f.ledgerFile, 'utf8');
  const result = f.prepare();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(f.output), ['waitron-io-ui-core-0.2.0.tgz']);
  const archive = join(f.output, 'waitron-io-ui-core-0.2.0.tgz');
  const manifest = JSON.parse(run(f.root, 'tar', ['-xOf', archive, 'package/package.json']));
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.name, '@waitron-io/ui-core');
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(manifest.waitronSource, {repository: 'clintongormley/waitron', commit: f.commit, version: '0.1.0'});
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    assert.equal(run(f.root, 'tar', ['-xOf', archive, 'package/dist/' + notice]), notice);
  }
  assert.equal(await readFile(f.ledgerFile, 'utf8'), before);
  assert.equal(run(f.checkout, 'git', ['status', '--porcelain']), '');
});

test('refuses an empty or invalid ledger before creating output', async t => {
  const f = await fixture(t);
  for (const ledger of [{schema: 1, events: []}, {...f.ledger, schema: 2}]) {
    await writeFile(f.ledgerFile, JSON.stringify(ledger));
    const result = f.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reservation|ledger schema/);
    assert(!((await readdir(f.root)).includes('output')));
  }
});

test('refuses prepared or uncertain uploads before rebuilding', async t => {
  const f = await fixture(t);
  const reservation = f.ledger.events[0];
  const prepared = {type: 'prepared', sourceCommit: f.commit, version: '0.2.0', at: reservation.at,
    artifact: {sha512: 'e'.repeat(128), manifestSha512: 'f'.repeat(128),
      notices: {LICENSE: '1'.repeat(128), 'LICENSE-GRANTS.md': '2'.repeat(128)}}};
  for (const extra of [[prepared], [prepared, {type: 'uploading', sourceCommit: f.commit, version: '0.2.0', at: reservation.at}]]) {
    await writeFile(f.ledgerFile, JSON.stringify({...f.ledger, events: [...f.ledger.events, ...extra]}));
    const result = f.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reservation/);
    assert(!((await readdir(f.root)).includes('output')));
  }
});

test('refuses wrong source identity and a dirty source', async t => {
  const f = await fixture(t);
  for (const source of [{...f.ledger.events[0].source, commit: 'a'.repeat(40)}, {...f.ledger.events[0].source, version: '0.9.0'}]) {
    await writeFile(f.ledgerFile, JSON.stringify({...f.ledger, events: [{...f.ledger.events[0], source}]}));
    const result = f.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checkout must match|package version/);
  }
  await writeFile(f.ledgerFile, JSON.stringify(f.ledger));
  await writeFile(join(f.checkout, 'unrelated'), 'dirty');
  const result = f.prepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source must be clean/);
});

test('refuses unknown, incomplete or repeated options', async t => {
  const f = await fixture(t);
  for (const args of [['--release-version', '0.9.0'], ['--ledger'], ['--ledger', f.ledgerFile]]) {
    const result = f.prepare(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage/);
    assert(!((await readdir(f.root)).includes('output')));
  }
});

test('refuses a nonempty output directory without changing its contents', async t => {
  const f = await fixture(t);
  await mkdir(f.output);
  await writeFile(join(f.output, 'retained.tgz'), 'owned bytes');
  const result = f.prepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output.*empty/);
  assert.equal(await readFile(join(f.output, 'retained.tgz'), 'utf8'), 'owned bytes');
  assert.deepEqual(await readdir(f.output), ['retained.tgz']);
});
