import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {realpathSync} from 'node:fs';

export const gitExecutable = realpathSync(execFileSync('/usr/bin/which', ['git'], {encoding: 'utf8'}).trim());
export const fixtureEnv = () => ({PATH: '/usr/bin:/bin', HOME: '/nonexistent', LC_ALL: 'C',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Build fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Build fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'});
export const git = (repo, ...args) => execFileSync(gitExecutable, ['-C', repo, ...args],
  {env: fixtureEnv(), timeout: 10000, maxBuffer: 32 * 1024 * 1024});
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'ui-build-fixture-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}
export async function put(repo, path, bytes, mode = 0o644) {
  const file = join(repo, path);
  await mkdir(join(file, '..'), {recursive: true});
  await writeFile(file, bytes, {mode});
}
export function commit(repo, message = 'fixture') {
  git(repo, 'add', '-A');
  git(repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-s', '-qm', message);
  return git(repo, 'rev-parse', 'HEAD').toString().trim();
}
export async function repository(t, files = {'context.txt': 'original\n'}) {
  const root = await temporary(t), repo = join(root, 'repo');
  await mkdir(repo);
  git(root, 'init', '-q', '--object-format=sha1', '--initial-branch=main', repo);
  for (const [path, bytes] of Object.entries(files)) await put(repo, path, bytes);
  return {root, repo, commit: commit(repo)};
}

import {cp, copyFile, chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function createBuildFixture(t) {
  const root=await temporary(t),sourceRepo=join(root,'source'),recipeRepo=join(root,'recipe');
  await cp(fileURLToPath(new URL('./fixtures/ui-build-source/source/',import.meta.url)),sourceRepo,{recursive:true});
  git(root,'init','-q','--object-format=sha1','--initial-branch=main',sourceRepo);
  const source={repository:'clintongormley/waitron',commit:commit(sourceRepo),version:'0.1.0'};
  await mkdir(recipeRepo);git(root,'init','-q','--object-format=sha1','--initial-branch=main',recipeRepo);
  for(const [path,bytes] of Object.entries({'package.json':'{"type":"module"}\n','pnpm-lock.yaml':'lockfileVersion: "9.0"\n',
    'pnpm-workspace.yaml':"packages: ['packages/*', 'apps/*']\n",'.github/workflows/ui-release.yml':'name: fixture\n',
    'scripts/ci-setup-pnpm.mjs':'import fs from "node:fs";\n','scripts/ci-pnpm-bootstrap-lock.json':'{}\n',
    'scripts/ci-pnpm-diagnostics.cjs':'// diagnostic\n','scripts/release/entry.mjs':'import "./support.mjs";\n',
    'scripts/release/support.mjs':'export const recipe = 1;\n','scripts/release/ui-source.json':'{"legacy":true}\n',
    'scripts/release/ui-build-policy.json':await readFile(new URL('./ui-build-policy.json',import.meta.url))}))await put(recipeRepo,path,bytes);
  const recipeCommit=commit(recipeRepo),tools={};
  for(const name of ['node','pnpm','npm','git','tar','sh']){
    const distributionRoot=join(root,'tools',name),executable=join(distributionRoot,name);
    await mkdir(distributionRoot,{recursive:true});
    if(name==='git')await copyFile(gitExecutable,executable);
    else await writeFile(executable,'#!/bin/sh\nprintf "%s\\n" "'+name+' fixture-v1"\n');
    await chmod(executable,0o755);tools[name]={executable,distributionRoot};
  }
  return {root,sourceRepo,recipeRepo,source,recipeCommit,tools,sourceChecks:Buffer.from('opaque source checks\n')};
}
