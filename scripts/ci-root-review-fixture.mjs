import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fingerprintInputMode} from './ci-input-audit.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
const registryPath = 'scripts/ci-root-inputs.json';
const recordRoot = 'scripts/ci-root-review.d/';
const recordPath = path => recordRoot + createHash('sha256').update(path).digest('hex') + '.json';
const targets = ['scripts/ci-root-shards.test.mjs', 'scripts/verify-backup-capacity-receipt.test.mjs', 'deploy/local-stack/operations-health.test.mjs'];

export function rootReviewFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-root-review-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
      {cwd: root, encoding: binary ? undefined : 'utf8', stdio: 'pipe'});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const entries = revision => git('ls-tree', '-rz', '--full-tree', revision).split('\0').filter(Boolean).map(raw => {
    const [, mode, type, objectId, path] = /^(\d+) (\w+) (\w+)\t([\s\S]+)$/.exec(raw);
    return {mode, type, objectId, path, raw: raw + '\0'};
  });
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-s', '-qm', 'Save root review control'); return git('rev-parse', 'HEAD').trim();};
  const docs = () => {
    git('add', '-A');
    const tree = git('write-tree').trim();
    const policy = JSON.parse(readFileSync(join(root, 'scripts/ci-input-audit.json')));
    policy.docsInputSha256 = fingerprintInputMode('docs', tree, git, entries(tree)).inputSha256;
    write('scripts/ci-input-audit.json', policy);
  };
  const renew = (paths, reviewer = 'CI reviewer', reference = 'review/control') => {
    git('add', '-A');
    const tree = git('write-tree').trim(), all = entries(tree), registryObjectId = all.find(e => e.path === registryPath).objectId;
    for (const path of paths) {
      const {mode, type, objectId} = all.find(e => e.path === path);
      write(recordPath(path), {version: 1, path, state: 'present', mode, type, objectId, registryObjectId, reviewer, reference});
    }
  };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    for (const path of [...targets, 'scripts/reader.mjs', 'scripts/ci-root-review.mjs', 'package.json', 'docs/explanation.md']) write(path, path + '\n');
    write('scripts/ci-input-audit.json', {version: 1, docsInputSha256: '0'.repeat(64), identityInputSha256: '0'.repeat(64), gatewayInputSha256: '0'.repeat(64), lockInputSha256: '0'.repeat(64), manifests: {}});
    const ids = ['root-partition-contract', 'capacity-verifier-test', 'local-health-test'];
    write(registryPath, {version: 1, entries: targets.map((path, i) => ({id: ids[i], paths: [path],
      owners: {rootTests: i === 0, receipts: i === 1 ? ['test:backup-capacity'] : i === 2 ? ['test:local-stack'] : []},
      sites: [{reader: 'package.json', site: 'scripts.test:1', kind: 'command', boundary: path, role: 'execution'}]}))});
    git('add', '-A'); const tree = git('write-tree').trim();
    renew(entries(tree).filter(e => e.path !== 'scripts/ci-input-audit.json' && !e.path.endsWith('.md')).map(e => e.path));
    docs(); const base = commit();
    const cli = args => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-review.mjs', import.meta.url)), ...args],
      {cwd: root, encoding: 'utf8', timeout: 30_000});
    run({root, git, write, entries, commit, docs, renew, base, cli});
  } finally {rmSync(root, {recursive: true, force: true});}
}
