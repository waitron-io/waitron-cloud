import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {chmod, mkdir, readFile, realpath, symlink, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {parse, stringify} from 'yaml';
import {computeUiBuildEvidence, readUiGitTree} from './ui-build-inputs.mjs';
import {
  commit,
  createBuildFixture,
  fixtureEnv,
  git,
  gitExecutable,
  put,
  repository
} from './ui-build-fixtures.mjs';

const gitInput = (repo, args, input) =>
  execFileSync(gitExecutable, ['-C', repo, ...args], {env: fixtureEnv(), input})
    .toString()
    .trim();
const treeCommit = (repo, entries) =>
  gitInput(
    repo,
    [
      'commit-tree',
      gitInput(repo, ['hash-object', '-w', '-t', 'tree', '--literally', '--stdin'], entries)
    ],
    Buffer.from('tree fixture\n\nSigned-off-by: Build fixture <fixture@example.invalid>\n')
  );
const rawEntries = (names, blob) =>
  Buffer.concat(
    names.map((name) =>
      Buffer.concat([
        Buffer.from('100644 '),
        Buffer.from(name),
        Buffer.from([0]),
        Buffer.from(blob, 'hex')
      ])
    )
  );

test('tracked installed-package bytes cannot replace an admitted build executable', async (t) => {
  const f = await createBuildFixture(t);
  await put(
    f.sourceRepo,
    'packages/ui-core/scripts/node_modules/esbuild/index.js',
    'throw Error("shadow");'
  );
  git(f.sourceRepo, 'add', '-f', 'packages/ui-core/scripts/node_modules/esbuild/index.js');
  git(f.sourceRepo, 'commit', '-s', '-qm', 'tracked dependency shadow');
  f.source.commit = git(f.sourceRepo, 'rev-parse', 'HEAD').toString().trim();
  await assert.rejects(computeUiBuildEvidence(f), /tracked node_modules/);
});

for (const extension of ['mts', 'cts', 'jsx', 'cjs'])
  test('uninspected source extension refuses: ' + extension, async (t) => {
    const f = await createBuildFixture(t);
    await put(
      f.sourceRepo,
      'packages/ui-core/src/index.ts',
      'import "./escape.' + extension + '";'
    );
    await put(
      f.sourceRepo,
      'packages/ui-core/src/escape.' + extension,
      'import "../../../outside.mjs";'
    );
    f.source.commit = commit(f.sourceRepo);
    await assert.rejects(computeUiBuildEvidence(f), /unclassified source loader/);
  });

test('extension lookup refuses when tsx would shadow the scanned ts file', async (t) => {
  const f = await createBuildFixture(t);
  await put(f.sourceRepo, 'packages/ui-core/src/index.ts', 'export * from "./shadow";');
  await put(f.sourceRepo, 'packages/ui-core/src/shadow.ts', 'export const safe = 1;');
  await put(
    f.sourceRepo,
    'packages/ui-core/src/shadow.tsx',
    'export * from "../../../outside.ts";'
  );
  f.source.commit = commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f), /ambiguous source import/);
});

test('declaration reference spelling cannot evade the consumed-input check', async (t) => {
  const f = await createBuildFixture(t);
  await put(
    f.sourceRepo,
    'packages/ui-core/src/index.ts',
    '/// <REFERENCE path="../../../outside.ts" />\nexport {};'
  );
  f.source.commit = commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f), /unclassified declaration reference/);
});

test('UI build tools cannot be supplied by unclassified workspace programs', async (t) => {
  const f = await createBuildFixture(t),
    path = 'packages/ui-core/package.json';
  const ui = JSON.parse(await readFile(join(f.sourceRepo, path)));
  ui.devDependencies.esbuild = 'workspace:*';
  await put(f.sourceRepo, path, JSON.stringify(ui));
  await put(
    f.sourceRepo,
    'packages/another/package.json',
    '{"name":"esbuild","version":"0.28.2","main":"index.js"}'
  );
  await put(f.sourceRepo, 'packages/another/index.js', 'throw Error("workspace bundler");');
  const lock = parse(await readFile(join(f.sourceRepo, 'pnpm-lock.yaml'), 'utf8'));
  lock.importers['packages/ui-core'].devDependencies.esbuild = {
    specifier: 'workspace:*',
    version: 'link:../another'
  };
  await put(f.sourceRepo, 'pnpm-lock.yaml', stringify(lock));
  f.source.commit = commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f), /UI workspace build dependency/);
});

for (const path of [
  '.NPMRC',
  '.PNPMFILE.CJS',
  'Package-Lock.json',
  '.NPMIGNORE',
  'packages/ui-core/src/TSCONFIG.json'
])
  test('filesystem config aliases refuse: ' + path, async (t) => {
    const f = await createBuildFixture(t);
    await put(f.sourceRepo, path, '{}');
    f.source.commit = commit(f.sourceRepo);
    await assert.rejects(
      computeUiBuildEvidence(f),
      /unsupported install config|unclassified nested build configuration/
    );
  });

for (const pair of [
  ['ΑΣ', 'ασ'],
  ['ſrc', 'src']
])
  test('filesystem Unicode aliases cannot form distinct inputs: ' + pair.join(','), async (t) => {
    const f = await repository(t),
      blob = git(f.repo, 'rev-parse', 'HEAD:context.txt').toString().trim();
    const id = treeCommit(f.repo, rawEntries(pair, blob));
    await assert.rejects(
      readUiGitTree({repo: f.repo, commit: id, git: gitExecutable}),
      /path collision/
    );
  });

test('UTF-8 path decoding preserves a leading byte-order mark as part of the actual filename', async (t) => {
  const f = await repository(t),
    blob = git(f.repo, 'rev-parse', 'HEAD:context.txt').toString().trim();
  const id = treeCommit(f.repo, rawEntries(['\uFEFFcontext.txt'], blob));
  const result = await readUiGitTree({repo: f.repo, commit: id, git: gitExecutable});
  assert.deepEqual([...result.files.keys()], ['\uFEFFcontext.txt']);
});

test('a byte-order-mark filename cannot stand in for the required source notice', async (t) => {
  const f = await createBuildFixture(t);
  const raw = git(f.sourceRepo, 'cat-file', 'tree', f.source.commit + '^{tree}');
  const needle = Buffer.from('100644 LICENSE\0'),
    at = raw.indexOf(needle);
  assert(at >= 0);
  const bytes = Buffer.concat([
    raw.subarray(0, at),
    Buffer.from('100644 \uFEFFLICENSE\0'),
    raw.subarray(at + needle.length)
  ]);
  f.source.commit = treeCommit(f.sourceRepo, bytes);
  await assert.rejects(computeUiBuildEvidence(f), /missing build input: LICENSE/);
});

test('unknown call fields cannot masquerade as computed evidence', async (t) => {
  const f = await createBuildFixture(t);
  await assert.rejects(
    computeUiBuildEvidence({...f, inputsSha512: '0'.repeat(128)}),
    /unsupported build evidence call fields/
  );
});

test('a symlinked linked checkout resolves relative gitdir from its physical location', async (t) => {
  const f = await repository(t),
    physical = join(f.root, 'deep', 'checkout'),
    alias = join(f.root, 'alias');
  await mkdir(join(f.root, 'deep'));
  git(f.repo, 'worktree', 'add', '--detach', physical, f.commit);
  const gitdir = (await readFile(join(physical, '.git'), 'utf8')).slice(8).trim();
  await writeFile(
    join(physical, '.git'),
    'gitdir: ' + relative(await realpath(physical), gitdir) + '\n'
  );
  await symlink(physical, alias);
  const result = await readUiGitTree({repo: alias, commit: f.commit, git: gitExecutable});
  assert.equal(result.files.get('context.txt').bytes.toString(), 'original\n');
});

test('a CommonJS resolver cannot bypass the declared recipe import closure', async (t) => {
  const f = await createBuildFixture(t);
  await put(
    f.recipeRepo,
    'scripts/release/entry.mjs',
    'import {createRequire} from "node:module"; createRequire(import.meta.url)("../elsewhere.cjs");'
  );
  f.recipeCommit = commit(f.recipeRepo);
  await assert.rejects(computeUiBuildEvidence(f), /unclassified recipe builtin import/);
});

test('special executable permission bits refuse instead of disappearing from the identity', async (t) => {
  const f = await createBuildFixture(t);
  await chmod(f.tools.node.executable, 0o4755);
  await assert.rejects(computeUiBuildEvidence(f), /special tool permissions/);
});
