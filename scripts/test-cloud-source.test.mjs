import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm, symlink, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const reader = resolve('scripts/test-cloud-image-source.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-source-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    await mkdir(join(root, 'packages/account/src'), {recursive: true});
    await writeFile(join(root, 'packages/account/src/app.ts'), 'export const ready = true;\n');
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Source fixture');
    await run({root, git});
  } finally {await rm(root, {recursive: true, force: true});}
}
const load = () => import('../deploy/test-cloud/test-fixtures/integration-source.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-source.mjs')) return {};
  throw error;
});

// Trusting an image label or a current working file instead of committed bytes breaks these checks.
test('source evidence measures committed runtime files and refuses dirty or changed checkouts', async () => {
  const {captureIntegrationSource, checkIntegrationSource} = await load();
  assert.equal(typeof captureIntegrationSource, 'function', 'Clean source evidence is missing');
  await fixture(async ({root, git}) => {
    const source = await captureIntegrationSource(root);
    assert.equal(source.head, git('rev-parse', 'HEAD')); assert.equal(source.tree, git('rev-parse', 'HEAD^{tree}'));
    assert.equal(source.dirty, false);
    assert.deepEqual(source.files, [
      {path: 'package.json', sha256: sha('{"type":"module"}\n')},
      {path: 'packages/account/src/app.ts', sha256: sha('export const ready = true;\n')},
    ]);
    assert.equal(await checkIntegrationSource(root, source), true);
    await writeFile(join(root, 'packages/account/src/app.ts'), 'export const ready = false;\n');
    await assert.rejects(captureIntegrationSource(root), /integration.source_dirty/);
    git('add', '.'); git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Changed source');
    await assert.rejects(checkIntegrationSource(root, source), /integration.source_changed/);
    await writeFile(join(root, 'packages/account/src/untracked.ts'), 'uncommitted');
    await assert.rejects(captureIntegrationSource(root), /integration.source_dirty/);
  });
});

test('the image reader measures actual files and refuses altered, missing or unsafe inputs without exposing them', async () => {
  await fixture(async ({root}) => {
    const files = [{path: 'package.json', sha256: sha('{"type":"module"}\n')},
      {path: 'packages/account/src/app.ts', sha256: sha('export const ready = true;\n')}];
    const run = input => spawnSync(process.execPath, [reader], {cwd: root, input: JSON.stringify(input), encoding: 'utf8'});
    const result = run({files});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {files: 2, runtimeSha256: sha(JSON.stringify(files))});
    for (const input of [{files: []}, {files: [...files, files[0]]}, {files: [...files].reverse()},
      {files: [{path: '../PRIVATE_SOURCE_CANARY', sha256: '0'.repeat(64)}]}, {files, extra: 'PRIVATE_SOURCE_CANARY'},
      {files: [{path: 'packages/../package.json', sha256: sha('{"type":"module"}\n')}]},
      {files: [{path: 'packages/account/src/missing.ts', sha256: '0'.repeat(64)}]},
      {files: [{...files[0], sha256: '0'.repeat(64)}]}]) {
      const refused = run(input); assert.equal(refused.status, 1);
      assert.equal(refused.stdout, ''); assert.equal(refused.stderr, 'Integration image source refused\n');
    }
    const oversized = spawnSync(process.execPath, [reader], {cwd: root, input: ' '.repeat(2 * 1024 * 1024) + JSON.stringify({files}), encoding: 'utf8'});
    assert.equal(oversized.status, 1); assert.equal(oversized.stdout + oversized.stderr, 'Integration image source refused\n');
    await writeFile(join(root, files[1].path), 'PRIVATE_SOURCE_CANARY');
    const refused = run({files}); assert.equal(refused.status, 1);
    assert.equal(refused.stdout + refused.stderr, 'Integration image source refused\n');
    await writeFile(join(root, files[1].path), 'export const ready = true;\n');
    await rename(join(root, 'packages/account'), join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, 'packages/account'));
    const linked = run({files}); assert.equal(linked.status, 1, 'An image must contain the measured files at their actual runtime paths');
    assert.equal(linked.stdout + linked.stderr, 'Integration image source refused\n');
  });
});
