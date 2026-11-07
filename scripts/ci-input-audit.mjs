import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync, writeFileSync, readFileSync} from 'node:fs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {pathToFileURL} from 'node:url';

import {auditDescriptor, auditRecordRoot, readModeRecords, verifyModeRecords, assertRecordRetention, assertHistoricalV1, auditModes, recordFilename, serializeRecord, writeAuditRecords} from './ci-input-audit-records.mjs';

const immutableAudits = new WeakMap();
const parsedPolicyBlobs = new WeakMap();
const verifiedTombstoneAncestry = new WeakMap();
const blobId = source => createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
function rememberPolicy(git, objectId) {
  if (!parsedPolicyBlobs.has(git)) parsedPolicyBlobs.set(git, new Set());
  parsedPolicyBlobs.get(git).add(objectId);
}

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

function parseEntries(source) {
  const records = source.split('\0');
  assert.equal(records.pop(), '', 'Incomplete input audit inventory');
  const paths = new Set();
  return records.map(raw => {
    const match = raw.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match, 'Malformed input audit inventory');
    const [, mode, type, objectId, path] = match;
    assert.ok(!paths.has(path), `Duplicate input audit path: ${path}`);
    paths.add(path);
    return {mode, type, objectId, path, raw: raw + '\0'};
  });
}

export const inertCIRecord = path => ['scripts/ci-input-audit.json', 'scripts/ci-input-audit-v2.json',
  'scripts/ci-root-inputs.json'].includes(path) || path.endsWith('.json') &&
  (path.startsWith('scripts/ci-input-audit.d/') || path.startsWith('scripts/ci-root-review.d/'));

export function readInputInventory(revision, git) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Input inventory requires an immutable revision');
  const source = git('ls-tree', '-rz', '--full-tree', revision);
  // A replacement character could conceal undecodable Git path bytes.
  assert.ok(!source.includes('\ufffd'), 'Unclassified input path encoding');
  const entries = parseEntries(source);
  assert.ok(entries.every(({path}) => !/[\\\r\n]/.test(path) &&
    !path.split('/').some(part => ['', '.', '..'].includes(part))), 'Unclassified input path');
  return entries;
}

export function readInputAudit(revision, git) {
  const cached = immutableAudits.get(git)?.get(revision);
  if (cached) return cached;
  const entries = parseEntries(git('ls-tree', '-rz', '--full-tree', revision));
  regular(entries, policyPath);
  const policy = parsePolicy(git('show', `${revision}:${policyPath}`));
  rememberPolicy(git, entries.find(entry => entry.path === policyPath).objectId);
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
    if (kind === 'commit' && /^[a-f0-9]{40}$/.test(revision)) {
      if (!immutableAudits.has(git)) immutableAudits.set(git, new Map());
      immutableAudits.get(git).set(revision, result);
    }
    return result;
  }
  assertHistoricalV1(revision, git);
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
        if (!verifiedTombstoneAncestry.has(git)) verifiedTombstoneAncestry.set(git, new Set());
        const ancestors = verifiedTombstoneAncestry.get(git), key = `${record.previousRevision}\0${ancestor}`;
        if (!ancestors.has(key)) {
          git('merge-base', '--is-ancestor', record.previousRevision, ancestor);
          ancestors.add(key);
        }
        assert.ok(currentRecord(mode, record.path, record.previousRevision, git), 'Stale tombstone ancestor evidence');
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

const proofTrees = new WeakMap();
const priorRecords = new WeakMap();

function currentRecord(mode, path, revision, git) {
  const key = `${revision}\0${mode}\0${path}`;
  if (priorRecords.get(git)?.has(key)) return priorRecords.get(git).get(key);
  if (!proofTrees.has(git)) proofTrees.set(git, new Map());
  const trees = proofTrees.get(git);
  // One immutable inventory supplies every removed path and mode at this ancestor.
  if (!trees.has(revision)) {
    const bytes = git('ls-tree', '-rz', '--full-tree', revision, {binary: true});
    assert.ok(Buffer.isBuffer(bytes), 'Prior audit tree requires raw bytes');
    trees.set(revision, parseEntries(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
  }
  const entries = trees.get(revision);
  const policyEntry = entries.find(entry => entry.path === policyPath);
  const descriptor = entries.find(entry => entry.path === auditDescriptor);
  const recordEntry = entries.find(entry => entry.path === recordFilename(mode, path));
  let result = null;
  if (policyEntry && descriptor && recordEntry) try {
    regular(entries, policyPath);
    regular(entries, auditDescriptor);
    regular(entries, recordFilename(mode, path));
    assert.equal(descriptor.objectId, blobId('{"version":2}\n'), 'Invalid prior v2 descriptor');
    if (!parsedPolicyBlobs.get(git)?.has(policyEntry.objectId)) {
      parsePolicy(git('show', `${revision}:${policyPath}`));
      rememberPolicy(git, policyEntry.objectId);
    }
    const source = entries.find(entry => entry.path === path);
    const manifest = mode === 'lock' && manifestPath(path);
    for (const target of targets[mode] ?? []) regular(entries, target);
    if (mode === 'lock') regular(entries, 'pnpm-lock.yaml');
    const included = source && path !== policyPath && path !== auditDescriptor && !path.startsWith(auditRecordRoot) &&
      !(mode === 'docs' && source.mode === '100644' && source.type === 'blob' && unreadMarkdown(path)) &&
      !targets[mode]?.includes(path) && !(mode === 'lock' && path === 'pnpm-lock.yaml');
    if (included && manifest) {
      regular(entries, path);
      const value = JSON.parse(git('show', `${revision}:${path}`));
      assert.ok(object(value), 'Invalid prior manifest');
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (!Object.hasOwn(value, field)) continue;
        assert.ok(object(value[field]) && Object.values(value[field]).every(value => typeof value === 'string'), 'Invalid prior manifest dependencies');
        delete value[field];
      }
      const sha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')))));
      const record = {version: 2, mode, path, state: 'manifest', sha256};
      if (recordEntry.objectId === blobId(serializeRecord(record))) result = record;
    } else if (included) {
      // The canonical record hash authenticates the same bytes without one read per path.
      const record = {version: 2, mode, path, state: 'present', gitMode: source.mode, gitType: source.type, objectId: source.objectId};
      if (recordEntry.objectId === blobId(serializeRecord(record))) result = record;
    }
  } catch (error) {
    if (error.code !== 'ERR_ASSERTION' && !(error instanceof SyntaxError)) throw error;
  }
  if (!priorRecords.has(git)) priorRecords.set(git, new Map());
  priorRecords.get(git).set(key, result);
  return result;
}

function stableReviewBase(git) {
  // A squash or rebase does not retain branch-only commits. Removal proofs must
  // already belong to the target's common history before a branch can land.
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) {
    let target;
    try { target = git('rev-parse', '--verify', `${ref}^{commit}`).trim(); }
    catch { continue; }
    return git('merge-base', 'HEAD', target).trim();
  }
  throw new Error('Removal review requires a main or master target reference');
}

function generateRecords(modes, revision, git, entries, existing, manifests) {
  const outputs = new Map([[auditDescriptor, '{"version":2}\n']]);
  let ancestors, proofBase;
  for (const mode of modes) {
    const projection = projectInputMode(mode, revision, git, entries, manifests);
    const records = new Map();
    for (const {path, mode: gitMode, type: gitType, objectId} of projection.rows) {
      records.set(path, {version: 2, mode, path, state: 'present', gitMode, gitType, objectId});
    }
    for (const [path, sha256] of Object.entries(projection.manifests)) records.set(path, {version: 2, mode, path, state: 'manifest', sha256});
    for (const [path, record] of existing?.[mode] ?? []) {
      if (records.has(path)) continue;
      proofBase ??= stableReviewBase(git);
      ancestors ??= git('rev-list', '--topo-order', proofBase).trim().split('\n');
      if (record.state === 'absent' && ancestors.includes(record.previousRevision) && currentRecord(mode, path, record.previousRevision, git)) {
        records.set(path, record); continue;
      }
      const candidates = git('--literal-pathspecs', 'rev-list', '--topo-order', proofBase, '--',
        path, recordFilename(mode, path), auditDescriptor).trim().split('\n').filter(Boolean);
      const previousRevision = candidates.find(ancestor => currentRecord(mode, path, ancestor, git));
      assert.ok(previousRevision, `No reviewed target ancestor for audit tombstone (consolidate unlanded additions/removals first): ${path}`);
      records.set(path, {version: 2, mode, path, state: 'absent', previousRevision});
    }
    for (const [path, record] of records) outputs.set(recordFilename(mode, path), serializeRecord(record));
  }
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const init = args.length === 1 && args[0] === '--init-v2-staged';
    const write = args[0] === '--write-staged' && (args.length === 1 || args.length === 3 && args[1] === '--mode' && [...auditModes, 'all'].includes(args[2]));
    const check = args.length === 2 && args[0] === '--check' && /^[a-f0-9]{40}$/.test(args[1]);
    const checkMode = args.length === 3 && args[0] === '--check-mode' && auditModes.includes(args[1]) && /^[a-f0-9]{40}$/.test(args[2]);
    assert.ok(init || write || check || checkMode, 'Usage: ci-input-audit.mjs --init-v2-staged | --write-staged [--mode docs|identity|gateway|lock|all] | --check <commit> | --check-mode <mode> <commit>');
    const git = (...args) => {
      const binary = typeof args.at(-1) === 'object' && args.pop().binary;
      return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    };
    git.readBlobs = readGitBlobs;
    if (write || init) {
      assert.equal(git('rev-parse', '--is-inside-work-tree').trim(), 'true', 'Generate input audits from the repository root');
      assert.equal(git('rev-parse', '--show-prefix').trim(), '', 'Generate input audits from the repository root');
    }
    const revision = write || init ? git('write-tree').trim() : args.at(-1);
    if (check || checkMode) assert.equal(git('cat-file', '-t', revision).trim(), 'commit', 'Check requires an immutable commit');
    const {policy, entries, records} = readInputAudit(revision, git);
    const needsManifests = policy.version === 1 || init || check || args[2] === 'all' ||
      (write ? args[2] : checkMode ? args[1] : null) === 'lock';
    const manifests = needsManifests ? workspaceManifests(revision, git, entries) : [];
    if (init || policy.version === 2 && write) {
      assert.ok(!init || policy.version === 1, 'V2 is already staged; use --write-staged');
      const modes = init || args[2] === 'all' ? auditModes : [args[2] ?? 'docs'];
      const outputs = generateRecords(modes, revision, git, entries, records, manifests);
      if (init) {
        let existingOutputs = 0;
        for (const [path, content] of outputs) {
          try {
            const info = lstatSync(path);
            assert.ok(info.isFile() && info.nlink === 1 && readFileSync(path, 'utf8') === content, `Audit initialization collision: ${path}`);
            existingOutputs++;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        assert.ok(existingOutputs === 0 || existingOutputs === outputs.size, 'Partial audit initialization output; inspect and remove only your incomplete outputs');
      }
      writeAuditRecords(outputs, entries.filter(entry => entry.path.startsWith(auditRecordRoot)).map(entry => entry.path));
      console.log(`Wrote ${modes.join(', ')} audit records from staged inputs; inspect and stage explicitly`);
    } else if (write) {
      assert.equal(args.length, 1, 'Explicit mode renewal requires v2');
      const generated = {...policy};
      for (const mode of auditModes) {
        const result = fingerprintInputMode(mode, revision, git, entries, manifests);
        generated[digestFields[mode]] = result.inputSha256;
        if (mode === 'lock') generated.manifests = result.manifests;
      }
      const content = JSON.stringify(generated, null, 2) + '\n';
      parsePolicy(content);
      assert.ok(lstatSync('scripts').isDirectory(), 'Audit output directory must be a real directory');
      const output = lstatSync(policyPath);
      assert.ok(output.isFile(), 'Audit output must be a regular file');
      assert.equal(output.nlink, 1, 'Audit output must have exactly one hard link');
      writeFileSync(policyPath, content);
      console.log(`Wrote ${policyPath} from staged inputs; inspect and stage it explicitly`);
    } else {
      assert.ok(!checkMode || policy.version === 2, 'Selected-mode checking requires v2');
      for (const mode of checkMode ? [args[1]] : auditModes) {
        try { auditInputMode(mode, revision, git, manifests); console.log(`${mode}: current`); }
        catch (error) { console.error(`${mode}: ${error.message}`); process.exitCode = 1; }
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
