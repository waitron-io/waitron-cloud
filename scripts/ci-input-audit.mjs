import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

import {auditDescriptor, auditRecordRoot, readModeRecords, verifyModeRecords, assertRecordRetention} from './ci-input-audit-records.mjs';

const immutableAudits = new WeakMap();

const policyPath = 'scripts/ci-input-audit.json';
const digestPattern = /^[a-f0-9]{64}$/;
const digestFields = {
  docs: 'docsInputSha256', identity: 'identityInputSha256',
  gateway: 'gatewayInputSha256', lock: 'lockInputSha256',
};
const targets = {
  identity: ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'],
  gateway: ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const manifestPath = path => typeof path === 'string' && /^(apps|packages)\/[^/\\]+\/package\.json$/.test(path) &&
  !path.includes('\0') && !['.', '..'].includes(path.split('/')[1]);
const digest = value => createHash('sha256').update(value).digest('hex');
export const unreadMarkdown = path => typeof path === 'string' && path !== 'docs/cloud-cost-model.md' &&
  path !== 'docs/waitron-integration-contract.md' &&
  /^(?:docs\/(?!receipts\/)(?:[^/]+\/)*[^/]+\.md|[^/]+\.md)$/.test(path) &&
  !path.split('/').some(part => part === '.' || part === '..' || part.includes('\\'));

function parsePolicy(source) {
  const policy = JSON.parse(source);
  // JSON.parse overwrites duplicate members. Check decoded keys before trusting
  // the parsed object so escaped spellings cannot hide contradictory evidence.
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
  const string = () => {
    const match = /^"(?:[^"\\]|\\[\s\S])*"/.exec(source.slice(offset));
    assert.ok(match, 'Malformed audit string');
    offset += match[0].length;
    return JSON.parse(match[0]);
  };
  const visit = () => {
    whitespace();
    if (source[offset] === '{') {
      offset++; whitespace();
      const keys = new Set();
      if (source[offset] !== '}') while (true) {
        whitespace();
        const key = string();
        assert.ok(!keys.has(key), `Duplicate audit member: ${key}`);
        keys.add(key);
        whitespace(); offset++; visit(); whitespace();
        if (source[offset] !== ',') break;
        offset++;
      }
      offset++;
    } else if (source[offset] === '[') {
      offset++; whitespace();
      if (source[offset] !== ']') while (true) {
        visit(); whitespace();
        if (source[offset] !== ',') break;
        offset++;
      }
      offset++;
    } else if (source[offset] === '"') string();
    else {
      while (offset < source.length && !/[\s,}\]]/.test(source[offset])) offset++;
    }
  };
  visit();
  assert.ok(object(policy), 'Invalid input audit policy');
  assert.deepEqual(Object.keys(policy).sort(), ['version', ...Object.values(digestFields), 'manifests'].sort(), 'Invalid input audit fields');
  assert.equal(policy.version, 1, 'Unsupported input audit version');
  for (const field of Object.values(digestFields)) {
    assert.ok(typeof policy[field] === 'string' && digestPattern.test(policy[field]), `Invalid input audit digest: ${field}`);
  }
  assert.ok(object(policy.manifests), 'Invalid manifest audit map');
  for (const [path, value] of Object.entries(policy.manifests)) {
    assert.ok(manifestPath(path), `Invalid manifest audit path: ${path}`);
    assert.ok(typeof value === 'string' && digestPattern.test(value), `Invalid manifest audit digest: ${path}`);
  }
  return policy;
}

function regular(entries, path) {
  const entry = entries.find(entry => entry.path === path);
  assert.ok(entry?.mode === '100644' && entry.type === 'blob', `Missing regular audit input: ${path}`);
}

export function readInputAudit(revision, git) {
  const cached = immutableAudits.get(git)?.get(revision);
  if (cached) return cached;
  const records = git('ls-tree', '-rz', '--full-tree', revision).split('\0');
  assert.equal(records.pop(), '', 'Incomplete input audit inventory');
  const paths = new Set();
  const entries = records.map(raw => {
    const match = raw.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match, 'Malformed input audit inventory');
    const [, mode, type, objectId, path] = match;
    assert.ok(!paths.has(path), `Duplicate input audit path: ${path}`);
    paths.add(path);
    return {mode, type, objectId, path, raw: raw + '\0'};
  });
  regular(entries, policyPath);
  const policy = parsePolicy(git('show', `${revision}:${policyPath}`));
  if (entries.some(entry => entry.path === auditDescriptor || entry.path.startsWith(auditRecordRoot))) {
    const rawTree = git('ls-tree', '-rz', '--full-tree', revision, {binary: true});
    assert.ok(Buffer.isBuffer(rawTree), 'V2 audit requires raw tree bytes');
    let treeText;
    try { treeText = new TextDecoder('utf-8', {fatal: true}).decode(rawTree); }
    catch { throw new Error('Invalid UTF-8 audit tree bytes'); }
    assert.equal(treeText, entries.map(entry => entry.raw).join(''), 'Audit tree bytes do not roundtrip');
    const records = readModeRecords(revision, git, entries);
    const {kind} = assertRecordRetention(revision, git, entries);
    const result = {policy: {version: 2}, entries, records};
    if (kind === 'commit') {
      if (!immutableAudits.has(git)) immutableAudits.set(git, new Map());
      immutableAudits.get(git).set(revision, result);
    }
    return result;
  }
  return {policy, entries};
}

export function fingerprintInputMode(mode, revision, git, entries, manifestPaths = []) {
  assert.ok(Object.hasOwn(digestFields, mode), 'Unknown input audit mode');
  regular(entries, policyPath);
  for (const path of targets[mode] ?? []) regular(entries, path);
  const documents = new Set(), manifests = {}, inputs = [];
  if (mode === 'lock') {
    regular(entries, 'pnpm-lock.yaml');
    assert.ok(Array.isArray(manifestPaths) && manifestPaths.every(manifestPath) &&
      new Set(manifestPaths).size === manifestPaths.length, 'Invalid manifest paths');
    assert.deepEqual(entries.filter(entry => manifestPath(entry.path)).map(entry => entry.path).sort(),
      [...manifestPaths].sort(), 'Incomplete manifest inventory');
    for (const path of manifestPaths) regular(entries, path);
  }
  for (const entry of entries) {
    const {path, type, mode: fileMode} = entry;
    if (path === policyPath) continue;
    if (mode === 'docs' && fileMode === '100644' && type === 'blob' && unreadMarkdown(path)) documents.add(path);
    else if (targets[mode]?.includes(path)) continue;
    else if (mode === 'lock' && path === 'pnpm-lock.yaml') continue;
    else if (mode === 'lock' && manifestPaths.includes(path)) {
      const manifest = JSON.parse(git('show', `${revision}:${path}`));
      assert.ok(object(manifest), `Invalid manifest: ${path}`);
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (!Object.hasOwn(manifest, field)) continue;
        assert.ok(object(manifest[field]) && Object.values(manifest[field]).every(value => typeof value === 'string'),
          `Invalid manifest dependencies: ${path}`);
        delete manifest[field];
      }
      const projected = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en'))));
      manifests[path] = digest(projected);
    } else inputs.push(entry.raw);
  }
  return {inputSha256: digest(inputs.join('')), documents, manifests};
}

export function projectInputMode(mode, revision, git, entries, manifestPaths = []) {
  assert.ok(Object.hasOwn(digestFields, mode), 'Unknown input audit mode');
  regular(entries, policyPath);
  for (const path of targets[mode] ?? []) regular(entries, path);
  const documents = new Set(), manifests = {}, inputs = [];
  if (mode === 'lock') {
    regular(entries, 'pnpm-lock.yaml');
    assert.ok(Array.isArray(manifestPaths) && manifestPaths.every(manifestPath) &&
      new Set(manifestPaths).size === manifestPaths.length, 'Invalid manifest paths');
    assert.deepEqual(entries.filter(entry => manifestPath(entry.path)).map(entry => entry.path).sort(),
      [...manifestPaths].sort(), 'Incomplete manifest inventory');
    for (const path of manifestPaths) regular(entries, path);
  }
  for (const entry of entries) {
    const {path, type, mode: fileMode} = entry;
    if (path === policyPath || path === auditDescriptor || path.startsWith(auditRecordRoot)) continue;
    if (mode === 'docs' && fileMode === '100644' && type === 'blob' && unreadMarkdown(path)) documents.add(path);
    else if (targets[mode]?.includes(path)) continue;
    else if (mode === 'lock' && path === 'pnpm-lock.yaml') continue;
    else if (mode === 'lock' && manifestPaths.includes(path)) {
      const manifest = JSON.parse(git('show', `${revision}:${path}`));
      assert.ok(object(manifest), `Invalid manifest: ${path}`);
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (!Object.hasOwn(manifest, field)) continue;
        assert.ok(object(manifest[field]) && Object.values(manifest[field]).every(value => typeof value === 'string'),
          `Invalid manifest dependencies: ${path}`);
        delete manifest[field];
      }
      const projected = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en'))));
      manifests[path] = digest(projected);
    } else inputs.push(entry);
  }
  return {rows: inputs, documents, manifests};
}

export function auditInputMode(mode, revision, git, manifestPaths = []) {
  const {policy, entries, records} = readInputAudit(revision, git);
  if (policy.version === 2) {
    const projection = projectInputMode(mode, revision, git, entries, manifestPaths);
    const {ancestor, kind} = assertRecordRetention(revision, git, entries);
    for (const record of records[mode]?.values() ?? []) {
      if (record.state !== 'absent') continue;
      try {
        assert.ok(kind !== 'commit' || record.previousRevision !== revision, 'Tombstone must name a prior ancestor');
        git('merge-base', '--is-ancestor', record.previousRevision, ancestor);
        const previous = readInputAudit(record.previousRevision, git);
        assert.equal(previous.policy.version, 2, 'Tombstone ancestor requires v2 evidence');
        const paths = mode === 'lock' ? workspaceManifests(record.previousRevision, git, previous.entries) : [];
        const priorProjection = projectInputMode(mode, record.previousRevision, git, previous.entries, paths);
        const prior = previous.records[mode].get(record.path);
        assert.ok(prior && prior.state !== 'absent', 'Missing present tombstone ancestor record');
        const row = priorProjection.rows.find(entry => entry.path === record.path);
        assert.ok(prior.state === 'present' ? row && row.mode === prior.gitMode && row.type === prior.gitType && row.objectId === prior.objectId :
          priorProjection.manifests[record.path] === prior.sha256, 'Stale tombstone ancestor evidence');
      } catch (error) { throw new Error(`Invalid audit tombstone for ${record.path}: ${error.message}`); }
    }
    return verifyModeRecords(mode, projection, records);
  }
  const result = fingerprintInputMode(mode, revision, git, entries, manifestPaths);
  const message = mode === 'docs' ? 'Executable inputs changed since the document audit' :
    mode === 'lock' ? 'Inputs changed since the lock reader audit' : 'Inputs changed since the root-script consumer audit';
  assert.equal(result.inputSha256, policy[digestFields[mode]], message);
  if (mode === 'lock') assert.deepEqual(result.manifests, policy.manifests, 'Manifest readers changed since audit');
  return result;
}


export function auditAllInputModes(revision, git) {
  const {entries} = readInputAudit(revision, git);
  const manifests = workspaceManifests(revision, git, entries);
  return Object.fromEntries(Object.keys(digestFields).map(mode => [mode, auditInputMode(mode, revision, git, manifests)]));
}

function workspaceManifests(revision, git, entries) {
  regular(entries, 'pnpm-workspace.yaml');
  assert.match(git('show', `${revision}:pnpm-workspace.yaml`),
    /^packages:\s*\n  - 'packages\/\*'\s*\n  - 'apps\/\*'\s*$/,
    'Unsupported workspace discovery policy');
  const paths = entries.filter(entry => manifestPath(entry.path)).map(entry => entry.path);
  assert.ok(paths.length > 0, 'Missing workspace manifests');
  const directories = new Set(entries.map(entry => /^(apps|packages)\/([^/]+)(?:\/|$)/.exec(entry.path))
    .filter(Boolean).map(match => `${match[1]}/${match[2]}/package.json`));
  assert.deepEqual([...paths].sort(), [...directories].sort(), 'Incomplete workspace manifest inventory');
  const names = new Set();
  for (const path of paths) {
    regular(entries, path);
    const manifest = JSON.parse(git('show', `${revision}:${path}`));
    assert.ok(object(manifest) && typeof manifest.name === 'string' && manifest.name.trim().length > 0 &&
      !names.has(manifest.name), `Invalid or duplicate package identity: ${path}`);
    assert.ok(object(manifest.scripts) && typeof manifest.scripts.test === 'string' && manifest.scripts.test.trim().length > 0,
      `Missing package test command: ${path}`);
    names.add(manifest.name);
  }
  return paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const write = args.length === 1 && args[0] === '--write-staged';
    const check = args.length === 2 && args[0] === '--check' && /^[a-f0-9]{40}$/.test(args[1]);
    assert.ok(write || check, 'Usage: ci-input-audit.mjs --write-staged | --check <commit>');
    const git = (...args) => execFileSync('git', args, {encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe']});
    if (write) {
      assert.equal(git('rev-parse', '--is-inside-work-tree').trim(), 'true', 'Generate input audits from the repository root');
      assert.equal(git('rev-parse', '--show-prefix').trim(), '', 'Generate input audits from the repository root');
    }
    const revision = write ? git('write-tree').trim() : args[1];
    if (check) assert.equal(git('cat-file', '-t', revision).trim(), 'commit', 'Check requires an immutable commit');
    const {policy, entries} = readInputAudit(revision, git);
    const manifests = workspaceManifests(revision, git, entries);
    const generated = {...policy};
    for (const mode of Object.keys(digestFields)) {
      const result = write ? fingerprintInputMode(mode, revision, git, entries, manifests) : auditInputMode(mode, revision, git, manifests);
      generated[digestFields[mode]] = result.inputSha256;
      if (mode === 'lock') generated.manifests = result.manifests;
      if (check) console.log(`${mode}: current`);
    }
    if (write) {
      const content = JSON.stringify(generated, null, 2) + '\n';
      parsePolicy(content);
      assert.ok(lstatSync('scripts').isDirectory(), 'Audit output directory must be a real directory');
      const output = lstatSync(policyPath);
      assert.ok(output.isFile(), 'Audit output must be a regular file');
      assert.equal(output.nlink, 1, 'Audit output must have exactly one hard link');
      writeFileSync(policyPath, content);
      console.log(`Wrote ${policyPath} from staged inputs; inspect and stage it explicitly`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
