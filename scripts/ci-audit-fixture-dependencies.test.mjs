import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const helper = new URL('./ci-audit-fixture-dependencies.mjs', import.meta.url).pathname;
const env = {...process.env};
delete env.NODE_TEST_CONTEXT;

for (const kind of ['missing source', 'empty source', 'file instead of dependencies']) {
  test(`dependency preparation refuses ${kind}`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'cloud-audit-no-installed-deps-'));
    const source = join(scratch, 'source');
    try {
      if (kind !== 'missing source') mkdirSync(source);
      if (kind === 'file instead of dependencies') writeFileSync(join(source, 'node_modules'), 'not installed');
      const result = spawnSync(process.execPath, [helper, source, join(scratch, 'candidate')], {env, encoding: 'utf8'});
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /node_modules/);
    } finally {rmSync(scratch, {recursive: true, force: true});}
  });
}

// Omitting dependency preparation must fail even when the runner's download store is empty.
test('the real translation audit reaches its mismatch and restoration checks with an empty download store', {timeout: 60_000}, () => {
  const store = mkdtempSync(join(tmpdir(), 'cloud-audit-empty-store-'));
  try {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
      '--test-name-pattern=a changed published translation vector', 'scripts/ci-input-audit-integration.test.mjs'],
    {env: {...env, npm_config_store_dir: store, npm_config_registry: 'http://127.0.0.1:9'}, encoding: 'utf8', timeout: 55_000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 1\b/);
    assert.match(result.stdout, /# fail 0\b/);
  } finally {rmSync(store, {recursive: true, force: true});}
});

// Resolving copied links through the parent checkout would conceal candidate source changes.
test('copied dependencies resolve candidate workspace source and isolate dependency mutations', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-audit-dependency-copy-'));
  const source = join(scratch, 'source'), candidate = join(scratch, 'candidate');
  const write = (root, path, text) => writeFileSync(join(root, path), text);
  try {
    for (const root of [source, candidate]) {
      for (const path of ['node_modules', 'packages/caller', 'packages/peer', 'apps/portal']) {
        mkdirSync(join(root, path), {recursive: true});
      }
      write(root, 'packages/peer/package.json', '{"main":"index.cjs"}\n');
      write(root, 'packages/peer/index.cjs', `module.exports = '${root === source ? 'parent' : 'candidate'}';\n`);
    }
    mkdirSync(join(source, 'node_modules/.pnpm/external/node_modules/external'), {recursive: true});
    write(source, 'node_modules/.pnpm/external/node_modules/external/package.json', '{"main":"index.cjs"}\n');
    write(source, 'node_modules/.pnpm/external/node_modules/external/index.cjs', "module.exports = 'original dependency';\n");
    for (const directory of ['packages/caller', 'apps/portal']) {
      mkdirSync(join(source, directory, 'node_modules'), {recursive: true});
      symlinkSync('../../../node_modules/.pnpm/external/node_modules/external', join(source, directory, 'node_modules/external'));
    }
    symlinkSync('../../peer', join(source, 'packages/caller/node_modules/peer'));
    const copied = spawnSync(process.execPath, [helper, source, candidate], {env, encoding: 'utf8'});
    assert.equal(copied.status, 0, copied.stdout + copied.stderr);
    for (const directory of ['packages/caller', 'apps/portal']) {
      const resolved = realpathSync(join(candidate, directory, 'node_modules/external'));
      assert.equal(resolved, realpathSync(join(candidate, 'node_modules/.pnpm/external/node_modules/external')));
      const loaded = spawnSync(process.execPath, ['-e', "console.log(require('external'))"], {cwd: join(candidate, directory), env, encoding: 'utf8'});
      assert.equal(loaded.status, 0, loaded.stderr);
      assert.equal(loaded.stdout.trim(), 'original dependency');
    }
    const peer = spawnSync(process.execPath, ['-e', "console.log(require('peer'))"], {cwd: join(candidate, 'packages/caller'), env, encoding: 'utf8'});
    assert.equal(peer.status, 0, peer.stderr);
    assert.equal(peer.stdout.trim(), 'candidate');
    write(candidate, 'node_modules/.pnpm/external/node_modules/external/index.cjs', "module.exports = 'candidate mutation';\n");
    assert.equal(readFileSync(join(source, 'node_modules/.pnpm/external/node_modules/external/index.cjs'), 'utf8'), "module.exports = 'original dependency';\n");
  } finally {rmSync(scratch, {recursive: true, force: true});}
});
