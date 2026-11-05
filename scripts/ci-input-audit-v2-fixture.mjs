import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditInputMode} from './ci-input-audit.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

export const marker = 'scripts/ci-input-audit-v2.json', policy = 'scripts/ci-input-audit.json';
const recordRoot = 'scripts/ci-input-audit.d/';
export const modes = ['docs', 'identity', 'gateway', 'lock'];
const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const gateway = ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'];
const manifestPath = 'packages/stock/package.json';
const manifest = {name: 'stock', scripts: {test: 'node --test'}, dependencies: {adapter: '^1'}};
const hash = source => createHash('sha256').update(source).digest('hex');
export const recordPath = (mode, path) => `${recordRoot}${mode}/${hash(path)}.json`;
export const canonical = record => JSON.stringify(record) + '\n';

// Literal fixture membership deliberately does not call production projection/writer code.
export function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-audit-v2-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
      {cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'],
    {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']}));
  const put = (path, content) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), content);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Independent v2 audit fixture'); return git('rev-parse', 'HEAD').trim();};
  const exclusions = {
    docs: [policy, marker, 'README.md', 'docs/backlog.md'],
    identity: [policy, marker, ...identity], gateway: [policy, marker, ...gateway],
    lock: [policy, marker, 'pnpm-lock.yaml', manifestPath],
  };
  const seed = () => {
    git('add', '-A');
    const rows = git('ls-tree', '-rz', '--full-tree', git('write-tree').trim()).split('\0').filter(Boolean);
    for (const mode of modes) {
      for (const raw of rows) {
        const [, gitMode, gitType, objectId, path] = raw.match(/^(\d+) (\w+) (\w+)\t([\s\S]+)$/);
        if (path.startsWith(recordRoot) || exclusions[mode].includes(path)) continue;
        put(recordPath(mode, path), canonical({version: 2, mode, path, state: 'present', gitMode, gitType, objectId}));
      }
    }
    put(recordPath('lock', manifestPath), canonical({version: 2, mode: 'lock', path: manifestPath,
      state: 'manifest', sha256: hash('{"name":"stock","scripts":{"test":"node --test"}}')}));
  };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put(policy, JSON.stringify({version: 1, docsInputSha256: '0'.repeat(64), identityInputSha256: '0'.repeat(64),
      gatewayInputSha256: '0'.repeat(64), lockInputSha256: '0'.repeat(64), manifests: {[manifestPath]: '0'.repeat(64)}}));
    put(marker, '{"version":2}\n'); put('README.md', '# Cloud\n'); put('docs/backlog.md', '# Backlog\n');
    put('docs/waitron-integration-contract.md', '# Contract\n'); put('docs/cloud-cost-model.md', '# Cost\n');
    put('package.json', '{"private":true}\n'); put(manifestPath, JSON.stringify(manifest) + '\n');
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n"); put('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    for (const path of [...identity, ...gateway, 'scripts/gateway-reconnection-receipt.mjs', 'packages/stock/src/index.mjs']) put(path, 'export const value = 1;\n');
    seed(); const base = commit();
    run({root, git, put, commit, seed, base, audit: (mode, sha = git('rev-parse', 'HEAD').trim()) => auditInputMode(mode, sha, git, [manifestPath])});
  } finally {rmSync(root, {recursive: true, force: true});}
}

