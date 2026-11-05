import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {auditInputMode, unreadMarkdown} from './ci-input-audit.mjs';
import {auditDescriptor, auditRecordRoot, inputRecordFilename, serializeRecord, assertInputRecordRetention, inputRecordHistory, writeAuditRecords} from './ci-input-audit-records.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

export const rootRegistryPath = 'scripts/ci-root-inputs.json';
export const rootRecordRoot = 'scripts/ci-root-review.d/';
export const rootRecordFilename = path => inputRecordFilename(path, rootRecordRoot);
const sha = /^[a-f0-9]{40}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names, message) => {
  assert.ok(object(value), message);
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), message);
};
const pathValid = path => typeof path === 'string' && path.length > 0 && !/[\0\\\r\n]/.test(path) &&
  !path.split('/').some(part => ['', '.', '..'].includes(part));

// Parsing alone loses duplicate keys, including escaped spellings. The token
// walk rejects them before a registry can supply conflicting review claims.
function parseJson(source, context = 'root registry') {
  const result = JSON.parse(source);
  let offset = 0;
  const space = () => {while (offset < source.length && /\s/.test(source[offset])) offset++;};
  const string = () => {
    const match = /^"(?:[^"\\]|\\[\s\S])*"/.exec(source.slice(offset));
    assert.ok(match, `Malformed ${context} string`); offset += match[0].length; return JSON.parse(match[0]);
  };
  const value = () => {
    space();
    if (source[offset] === '{') {
      offset++; space(); const keys = new Set();
      if (source[offset] !== '}') while (true) {
        space(); const key = string();
        assert.ok(!keys.has(key), `Duplicate ${context} member: ${key}`); keys.add(key);
        space(); offset++; value(); space(); if (source[offset] !== ',') break; offset++;
      }
      offset++;
    } else if (source[offset] === '[') {
      offset++; space();
      if (source[offset] !== ']') while (true) {value(); space(); if (source[offset] !== ',') break; offset++;}
      offset++;
    } else if (source[offset] === '"') string();
    else while (offset < source.length && !/[\s,}\]]/.test(source[offset])) offset++;
  };
  value(); return result;
}

const candidates = {
  'root-partition-contract': {path: 'scripts/ci-root-shards.test.mjs', rootTests: true, receipts: []},
  'capacity-verifier-test': {path: 'scripts/verify-backup-capacity-receipt.test.mjs', rootTests: false, receipts: ['test:backup-capacity']},
  'local-health-test': {path: 'deploy/local-stack/operations-health.test.mjs', rootTests: false, receipts: ['test:local-stack']},
};

function registryFrom(source, entries) {
  const registry = parseJson(source);
  fields(registry, ['version', 'entries'], 'Invalid root registry fields');
  assert.equal(registry.version, 1, 'Invalid root registry version');
  assert.ok(Array.isArray(registry.entries) && registry.entries.length > 0, 'Empty root registry');
  const seen = new Set();
  for (const entry of registry.entries) {
    fields(entry, ['id', 'paths', 'owners', 'sites'], 'Invalid root registry entry');
    assert.ok(Object.hasOwn(candidates, entry.id) && !seen.has(entry.id), 'Unknown or duplicate root registry ID'); seen.add(entry.id);
    const candidate = candidates[entry.id];
    assert.ok(Array.isArray(entry.paths) && entry.paths.every(pathValid), 'Invalid root path');
    assert.deepEqual(entry.paths, [candidate.path], 'Invalid root registry paths');
    fields(entry.owners, ['rootTests', 'receipts'], 'Invalid root owner fields');
    assert.deepEqual(entry.owners, {rootTests: candidate.rootTests, receipts: candidate.receipts}, 'Invalid root owners');
    assert.ok(Array.isArray(entry.sites) && entry.sites.length > 0, 'Missing root registry sites');
    const sites = new Set();
    for (const site of entry.sites) {
      fields(site, ['reader', 'site', 'kind', 'boundary', 'role'], 'Invalid root registry site');
      assert.ok(pathValid(site.reader) && entries.some(e => e.path === site.reader && e.type === 'blob' && e.mode === '100644'), 'Invalid root registry reader');
      assert.ok(['import', 'file', 'directory', 'command', 'inventory'].includes(site.kind), 'Invalid root registry site kind');
      assert.ok(['execution', 'syntax-only', 'metadata validation', 'saved-fixture input', 'dependency preparation'].includes(site.role), 'Invalid root registry site role');
      assert.ok([site.site, site.boundary].every(v => typeof v === 'string' && v.trim().length > 0 && !v.includes('\0')), 'Invalid root registry boundary');
      const key = JSON.stringify([site.reader, site.site, site.kind, site.boundary, site.role]);
      assert.ok(!sites.has(key), 'Duplicate root registry site'); sites.add(key);
    }
    assert.ok(entries.some(e => e.path === candidate.path && e.mode === '100644' && e.type === 'blob'), `Missing regular root registry target: ${candidate.path}`);
  }
  return registry;
}

function inventory(revision, git) {
  assert.match(revision, sha, 'Root review requires an immutable revision');
  const bytes = git('ls-tree', '-rz', '--full-tree', revision, {binary: true});
  assert.ok(Buffer.isBuffer(bytes), 'Root review requires raw inventory bytes');
  const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes), rows = source.split('\0');
  assert.equal(rows.pop(), '', 'Incomplete root review inventory');
  const seen = new Set();
  return rows.map(raw => {
    const match = /^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(raw);
    assert.ok(match, 'Malformed root review inventory');
    const [, mode, type, objectId, path] = match;
    assert.ok(pathValid(path) && !seen.has(path), 'Invalid or duplicate root review path'); seen.add(path);
    return {path, mode, type, objectId};
  });
}

function readBlobs(entries, git) {
  assert.equal(typeof git.readBlobs, 'function', 'Root review requires batched blob reads');
  const blobs = git.readBlobs([...new Set(entries.map(e => e.objectId))]);
  assert.ok(blobs instanceof Map, 'Missing root review blobs');
  for (const entry of entries) {
    assert.ok(entry.mode === '100644' && entry.type === 'blob', `Nonregular root review metadata: ${entry.path}`);
    const source = blobs.get(entry.objectId);
    assert.equal(typeof source, 'string', `Missing root review blob: ${entry.path}`);
    const bytes = Buffer.from(source);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.objectId, 'Invalid root review blob bytes');
  }
  return blobs;
}

function projectionAt(revision, git) {
  const entries = inventory(revision, git), entry = entries.find(e => e.path === rootRegistryPath);
  assert.ok(entry, 'Missing root registry');
  assert.ok(entries.some(e => e.path === 'scripts/ci-root-review.mjs' && e.mode === '100644' && e.type === 'blob'),
    'Missing regular root review checker');
  const registry = registryFrom(readBlobs([entry], git).get(entry.objectId), entries);
  const inputs = entries.filter(e => e.path !== 'scripts/ci-input-audit.json' && e.path !== auditDescriptor &&
    !e.path.startsWith(auditRecordRoot) && !e.path.startsWith(rootRecordRoot) &&
    !(e.mode === '100644' && e.type === 'blob' && unreadMarkdown(e.path)));
  return {entries, registry, registryObjectId: entry.objectId, inputs};
}

export function rootReviewProjection(revision, git) {
  const {registryObjectId, inputs} = projectionAt(revision, git);
  return {registryObjectId, inputs};
}

export function rootReviewActivated(revision, git) {
  assert.match(revision, sha, 'Root activation requires an immutable revision');
  return inputRecordHistory(revision, git, rootRegistryPath).activations.length > 0;
}

function readRecords(entries, git) {
  const metadata = entries.filter(e => e.path.startsWith(rootRecordRoot)), blobs = readBlobs(metadata, git), records = new Map();
  for (const entry of metadata) {
    const source = blobs.get(entry.objectId), record = parseJson(source, 'root review');
    const keys = ['version', 'path', 'state', ...(record.state === 'absent' ? ['previousRevision'] : ['mode', 'type', 'objectId']),
      'registryObjectId', 'reviewer', 'reference'];
    fields(record, keys, 'Invalid root record fields');
    assert.ok(record.version === 1 && ['present', 'absent'].includes(record.state) && pathValid(record.path), 'Invalid root record identity');
    assert.deepEqual(Object.keys(record), keys, 'Noncanonical root review field order');
    assert.match(record.registryObjectId ?? '', sha, 'Invalid root review registry identity');
    if (record.state === 'absent') assert.match(record.previousRevision ?? '', sha, 'Invalid root review removal identity');
    else {
      assert.match(record.mode ?? '', /^[0-7]{6}$/, 'Invalid root review mode');
      assert.ok(['blob', 'commit'].includes(record.type), 'Invalid root review type');
      assert.match(record.objectId ?? '', sha, 'Invalid root review object identity');
    }
    assert.ok([record.reviewer, record.reference].every(v => typeof v === 'string' && v.trim().length > 0 && !v.includes('\0')), 'Invalid root provenance');
    assert.equal(source, serializeRecord(record), 'Noncanonical root review record');
    assert.equal(entry.path, rootRecordFilename(record.path), 'Invalid root record filename');
    assert.ok(!records.has(record.path), 'Duplicate root record'); records.set(record.path, record);
  }
  return records;
}

const retention = (revision, git, entries) => assertInputRecordRetention(revision, git, entries, {
  descriptor: rootRegistryPath, root: rootRecordRoot, canonical: /^scripts\/ci-root-review\.d\/[a-f0-9]{64}\.json$/,
});

export function checkRootReview(revision, git) {
  const {entries, registry, registryObjectId, inputs} = projectionAt(revision, git);
  const {ancestor, kind} = retention(revision, git, entries);
  // Prose and existing evidence are excluded only by their independent authority.
  auditInputMode('docs', revision, git);
  const records = readRecords(entries, git);
  for (const input of inputs) {
    assert.ok(input.type === 'blob' && ['100644', '100755'].includes(input.mode), `Unsupported root input mode: ${input.path}`);
    const record = records.get(input.path);
    assert.ok(record?.state === 'present' && record.mode === input.mode && record.type === input.type && record.objectId === input.objectId &&
      record.registryObjectId === registryObjectId, `Unreviewed root input: ${input.path}`);
  }
  const expected = new Set(inputs.map(e => e.path));
  for (const [path, record] of records) {
    if (record.state === 'present') assert.ok(expected.has(path), `Removed root input needs a tombstone: ${path}`);
    else {
      assert.ok(!expected.has(path) && record.registryObjectId === registryObjectId, `Invalid root review tombstone: ${path}`);
      assert.ok(kind !== 'commit' || record.previousRevision !== revision, 'Root tombstone must name a prior ancestor');
      git('merge-base', '--is-ancestor', record.previousRevision, ancestor);
      const prior = projectionAt(record.previousRevision, git), evidence = readRecords(prior.entries, git).get(path);
      assert.ok(prior.inputs.some(input => input.path === path && evidence?.state === 'present' &&
        evidence.mode === input.mode && evidence.type === input.type && evidence.objectId === input.objectId &&
        evidence.registryObjectId === prior.registryObjectId), `Unreviewed root tombstone ancestor: ${path}`);
    }
  }
  return registry;
}

function stableReviewBase(git) {
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) {
    let target;
    try {target = git('rev-parse', '--verify', `${ref}^{commit}`).trim();} catch {continue;}
    return git('merge-base', 'HEAD', target).trim();
  }
  throw Error('Root removal review requires a main or master target reference');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const git = (...args) => {
      const binary = typeof args.at(-1) === 'object' && args.pop().binary;
      return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    };
    git.readBlobs = readGitBlobs;
    const args = process.argv.slice(2);
    if (args.length === 2 && args[0] === '--check' && sha.test(args[1])) {
      assert.equal(git('cat-file', '-t', args[1]).trim(), 'commit', 'Root check requires an immutable commit');
      checkRootReview(args[1], git); console.log('Root input review is current');
    } else {
      assert.equal(args.shift(), '--write-staged', 'Usage: --check <commit> | --write-staged --input <path> ... --reviewer <name> --reference <review>');
      const inputs = [], provenance = {};
      while (args.length) {
        const flag = args.shift(), value = args.shift();
        assert.ok(typeof value === 'string' && value.trim().length > 0 && !value.includes('\0'), 'Missing explicit root review value');
        if (flag === '--input') {assert.ok(pathValid(value) && !inputs.includes(value), 'Invalid or duplicate explicit root input'); inputs.push(value);}
        else {
          assert.ok(['--reviewer', '--reference'].includes(flag) && !Object.hasOwn(provenance, flag.slice(2)), 'Unknown or duplicate root review option');
          provenance[flag.slice(2)] = value;
        }
      }
      assert.ok(inputs.length > 0 && provenance.reviewer && provenance.reference, 'Explicit inputs, reviewer and reference are required');
      assert.equal(git('rev-parse', '--show-prefix').trim(), '', 'Renew root reviews from the repository root');
      const revision = git('write-tree').trim(), projection = projectionAt(revision, git);
      retention(revision, git, projection.entries);
      const records = readRecords(projection.entries, git), outputs = new Map();
      for (const path of inputs) {
        const input = projection.inputs.find(input => input.path === path);
        let record;
        if (input) record = {version: 1, path, state: 'present', mode: input.mode, type: input.type, objectId: input.objectId};
        else {
          assert.ok(records.has(path), `Unknown root input removal: ${path}`);
          const base = stableReviewBase(git);
          const candidates = git('--literal-pathspecs', 'rev-list', '--topo-order', base, '--', path, rootRecordFilename(path), rootRegistryPath).trim().split('\n').filter(Boolean);
          const previousRevision = candidates.find(candidate => {
            const prior = projectionAt(candidate, git), evidence = readRecords(prior.entries, git).get(path);
            return prior.inputs.some(input => input.path === path && evidence?.state === 'present' &&
              evidence.mode === input.mode && evidence.type === input.type && evidence.objectId === input.objectId && evidence.registryObjectId === prior.registryObjectId);
          });
          assert.ok(previousRevision, `No reviewed target ancestor for root removal: ${path}`);
          record = {version: 1, path, state: 'absent', previousRevision};
        }
        outputs.set(rootRecordFilename(path), serializeRecord({...record, registryObjectId: projection.registryObjectId, ...provenance}));
      }
      writeAuditRecords(outputs, projection.entries.filter(e => e.path.startsWith(rootRecordRoot)).map(e => e.path), {root: rootRecordRoot, directories: []});
      console.log(`Wrote ${outputs.size} explicitly reviewed root records from staged inputs; inspect and stage explicitly`);
    }
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
