import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
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

const ui = 'packages/ui-core';
const gitInput = (repo, args, input) =>
  execFileSync(gitExecutable, ['-C', repo, ...args], {env: fixtureEnv(), input})
    .toString()
    .trim();
const refusal = (message) => (error) => {
  assert.equal(error.message.split('\n')[0], message);
  return true;
};
async function editJson(f, path, edit) {
  const value = JSON.parse(await readFile(join(f.sourceRepo, path), 'utf8'));
  edit(value);
  await put(f.sourceRepo, path, JSON.stringify(value));
}
async function editLock(f, edit) {
  const lock = parse(await readFile(join(f.sourceRepo, 'pnpm-lock.yaml'), 'utf8'));
  edit(lock);
  await put(f.sourceRepo, 'pnpm-lock.yaml', stringify(lock));
}
async function rejectSource(t, edit, message) {
  const f = await createBuildFixture(t);
  await edit(f);
  f.source.commit = commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f), refusal(message));
}

for (const name of ['alternates', 'http-alternates']) {
  test(`reader refuses nonempty ${name} even when its own objects suffice`, async (t) => {
    const f = await repository(t);
    await put(f.repo, `.git/objects/info/${name}`, '/nowhere\n');
    await assert.rejects(
      readUiGitTree({repo: f.repo, commit: f.commit, git: gitExecutable}),
      refusal('external object alternates are unsupported')
    );
  });
}

for (const [label, name] of [
  ['decomposed Unicode', 'e\u0301'],
  ['colon', 'a:b'],
  ['control character', 'a\u0001b'],
  ['Git metadata component', '.GIT']
]) {
  test(`reader refuses a raw tree with ${label}`, async (t) => {
    const f = await repository(t);
    const blob = git(f.repo, 'rev-parse', 'HEAD:context.txt').toString().trim();
    const raw = Buffer.concat([Buffer.from('100644 ' + name + '\0'), Buffer.from(blob, 'hex')]);
    const tree = gitInput(
      f.repo,
      ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'],
      raw
    );
    const id = gitInput(
      f.repo,
      ['commit-tree', tree],
      Buffer.from('unsafe tree\n\nSigned-off-by: Build fixture <fixture@example.invalid>\n')
    );
    await assert.rejects(
      readUiGitTree({repo: f.repo, commit: id, git: gitExecutable}),
      refusal('unsafe Git input path')
    );
  });
}

test('reader refuses a tree nested beyond 128 levels', async (t) => {
  const f = await repository(t);
  const blob = git(f.repo, 'rev-parse', 'HEAD:context.txt').toString().trim();
  let tree = gitInput(f.repo, ['mktree'], Buffer.from(`100644 blob ${blob}\tleaf\n`));
  for (let i = 0; i < 129; i++) {
    tree = gitInput(f.repo, ['mktree'], Buffer.from(`040000 tree ${tree}\td\n`));
  }
  const id = gitInput(
    f.repo,
    ['commit-tree', tree],
    Buffer.from('deep tree\n\nSigned-off-by: Build fixture <fixture@example.invalid>\n')
  );
  await assert.rejects(
    readUiGitTree({repo: f.repo, commit: id, git: gitExecutable}),
    refusal('Git tree depth limit')
  );
});

for (const path of ['.gitmodules', `${ui}/.npmignore`]) {
  test(`source refuses install configuration ${path}`, (t) =>
    rejectSource(
      t,
      (f) => put(f.sourceRepo, path, 'x\n'),
      `unsupported install config input: ${path}`
    ));
}

for (const [label, raw, message] of [
  ['integer beyond exact JSON range', '9007199254740992', 'unsafe JSON number'],
  ['unpaired Unicode surrogate', '"\\ud800"', 'invalid JSON Unicode']
]) {
  test(`source refuses ${label} in otherwise supported root metadata`, (t) =>
    rejectSource(
      t,
      async (f) => {
        const path = join(f.sourceRepo, 'package.json');
        const text = (await readFile(path, 'utf8')).trimEnd();
        await writeFile(path, text.slice(0, -1) + ',"extra":' + raw + '}');
      },
      message
    ));
}

test('lock refuses YAML aliases even in otherwise unconstrained snapshot metadata', (t) =>
  rejectSource(
    t,
    async (f) => {
      const lock = parse(await readFile(join(f.sourceRepo, 'pnpm-lock.yaml'), 'utf8'));
      lock.settings = {autoInstallPeers: true};
      lock.snapshots['lit@3.2.0'] = lock.settings;
      const text = stringify(lock);
      assert.match(text, /\*a1/);
      await put(f.sourceRepo, 'pnpm-lock.yaml', text);
    },
    'Alias resolution is disabled'
  ));

for (const [label, edit, message] of [
  [
    'overrides absent from the root manifest',
    (l) => {
      l.overrides = {lit: '3.2.0'};
    },
    'unsupported lock overrides'
  ],
  [
    'unknown top-level fields',
    (l) => {
      l.patchedDependencies = {};
    },
    'unsupported lock fields'
  ],
  [
    'specifier differing from the manifest',
    (l) => {
      l.importers[ui].devDependencies.lit.specifier = '^3.0.0';
    },
    'lock dependency specifier differs'
  ],
  [
    'tarball resolution',
    (l) => {
      l.packages['lit@3.2.0'].resolution.tarball = 'https://example.invalid/x.tgz';
    },
    'unsupported package resolution fields'
  ],
  [
    'weak package integrity',
    (l) => {
      l.packages['lit@3.2.0'].resolution.integrity = 'md5-AAAA';
    },
    'unsupported dependency integrity'
  ],
  [
    'URL package identity',
    (l) => {
      l.packages['https://example.invalid/x.tgz'] = {
        resolution: {integrity: l.packages['lit@3.2.0'].resolution.integrity}
      };
    },
    'unsupported locked package'
  ]
]) {
  test(`lock refuses ${label}`, (t) => rejectSource(t, (f) => editLock(f, edit), message));
}

test('lock refuses a workspace link escaping its named package', (t) =>
  rejectSource(
    t,
    async (f) => {
      await editLock(f, (l) => {
        l.importers['.'].devDependencies = {
          other: {specifier: 'workspace:*', version: 'link:../outside'}
        };
      });
      await editJson(f, 'package.json', (p) => {
        p.devDependencies = {other: 'workspace:*'};
      });
      await put(f.sourceRepo, 'packages/another/package.json', '{"name":"other"}');
    },
    'escaping workspace dependency'
  ));

for (const [label, path, edit, message] of [
  [
    'CommonJS module type',
    `${ui}/package.json`,
    (p) => {
      p.type = 'commonjs';
    },
    'unsupported source module type'
  ],
  [
    'unbounded Lit peer',
    `${ui}/package.json`,
    (p) => {
      p.peerDependencies = {lit: '*'};
    },
    'unsupported Lit peer'
  ],
  [
    'package-local workspaces',
    `${ui}/package.json`,
    (p) => {
      p.workspaces = ['x'];
    },
    'unclassified package imports or workspace resolution'
  ],
  [
    'package-local resolutions',
    `${ui}/package.json`,
    (p) => {
      p.resolutions = {lit: '1'};
    },
    'unclassified package imports or workspace resolution'
  ],
  [
    'duplicate workspace name',
    'package.json',
    (p) => {
      p.name = '@waitron/ui-core';
    },
    'unsupported workspace identity'
  ]
]) {
  test(`source refuses ${label}`, (t) => rejectSource(t, (f) => editJson(f, path, edit), message));
}

test('recipe refuses policy bytes differing from the supported policy', async (t) => {
  const f = await createBuildFixture(t);
  await put(f.recipeRepo, 'scripts/release/ui-build-policy.json', '{}\n');
  f.recipeCommit = commit(f.recipeRepo);
  await assert.rejects(computeUiBuildEvidence(f), refusal('unsupported recipe policy'));
});

test('tool distribution refuses a decomposed Unicode filename', async (t) => {
  const f = await createBuildFixture(t);
  await put(f.tools.node.distributionRoot, 'e\u0301', 'x');
  await assert.rejects(computeUiBuildEvidence(f), refusal('tool path collision'));
});

for (const [label, body] of [
  ['require call', "export const external = require('../../../outside');\n"],
  ['TypeScript import-equals', "import external = require('../../../outside');\n"],
  ['TypeScript import type', "export type External = import('../../../outside').X;\n"]
]) {
  test(`source refuses escaping ${label}`, (t) =>
    rejectSource(
      t,
      (f) => put(f.sourceRepo, `${ui}/src/index.ts`, body),
      'escaping source import'
    ));
}

test('source accepts a static import type whose target stays in the compiled closure', async (t) => {
  const f = await createBuildFixture(t);
  await put(
    f.sourceRepo,
    `${ui}/src/index.ts`,
    "export type Local = import('./local.js').Local;\n"
  );
  await put(f.sourceRepo, `${ui}/src/local.ts`, 'export interface Local { value: string }\n');
  f.source.commit = commit(f.sourceRepo);
  const result = await computeUiBuildEvidence(f);
  assert(result.inputs.some(([role, path]) => role === 'build' && path === `${ui}/src/local.ts`));
});
