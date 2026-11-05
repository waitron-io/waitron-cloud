import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, lstatSync, readdirSync, mkdirSync, openSync, closeSync, fstatSync, ftruncateSync, writeFileSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';

export const auditDescriptor = 'scripts/ci-input-audit-v2.json';
export const auditRecordRoot = 'scripts/ci-input-audit.d/';
export const auditModes = ['docs', 'identity', 'gateway', 'lock'];
export const recordFilename = (mode, path) => `${auditRecordRoot}${mode}/${createHash('sha256').update(path).digest('hex')}.json`;
export const serializeRecord = record => JSON.stringify(record) + '\n';
const sha256 = source => createHash('sha256').update(source).digest('hex');

const immutableHistory = new WeakMap();

export function assertRecordRetention(revision, git, entries) {
  const cached = immutableHistory.get(git)?.get(revision);
  if (cached) return cached;
  assert.equal(git('rev-parse', '--is-shallow-repository').trim(), 'false', 'Audit retention requires complete history');
  const kind = git('cat-file', '-t', revision).trim();
  assert.ok(['commit', 'tree'].includes(kind), 'Invalid audit revision type');
  const ancestor = kind === 'commit' ? revision : git('rev-parse', '--verify', 'HEAD').trim();
  // Full merged ancestry retains every introduced name, including a deletion
  // hidden behind unrelated children or a temporarily missing activation marker.
  const history = git('log', '--full-history', '-m', '--root', '--format=', '--name-only', '-z', '--diff-filter=A', ancestor, '--', auditRecordRoot);
  const names = history.split('\0');
  assert.equal(names.pop(), '', 'Incomplete audit record history');
  const current = new Set(entries.map(entry => entry.path));
  for (const path of names) if (path) assert.ok(current.has(path), `Audit record must be retained: ${path}`);
  const result = {ancestor, kind};
  if (kind === 'commit') {
    if (!immutableHistory.has(git)) immutableHistory.set(git, new Map());
    immutableHistory.get(git).set(revision, result);
  }
  return result;
}

export function readModeRecords(revision, git, entries) {
  assert.equal(typeof git.readBlobs, 'function', 'V2 audit requires batched blob reads');
  const metadata = entries.filter(entry => entry.path === auditDescriptor || entry.path.startsWith(auditRecordRoot));
  const blobs = git.readBlobs(metadata.map(entry => entry.objectId));
  assert.ok(blobs instanceof Map, 'Missing batched audit metadata');
  const records = Object.fromEntries(auditModes.map(mode => [mode, new Map()]));
  for (const entry of metadata) {
    assert.ok(entry.mode === '100644' && entry.type === 'blob', `Nonregular audit metadata: ${entry.path}`);
    const source = blobs.get(entry.objectId);
    assert.equal(typeof source, 'string', 'Missing audit metadata blob');
    if (entry.path === auditDescriptor) {
      assert.equal(source, '{"version":2}\n', 'Invalid v2 audit descriptor');
      continue;
    }
    const record = JSON.parse(source);
    assert.ok(record && typeof record === 'object' && !Array.isArray(record), 'Invalid audit record');
    assert.equal(record.version, 2, 'Invalid audit record version');
    assert.ok(auditModes.includes(record.mode), 'Unknown audit record mode');
    assert.ok(typeof record.path === 'string' && record.path.length > 0 && !record.path.includes('\0') &&
      !record.path.startsWith('/') && !record.path.split('/').some(part => part === '.' || part === '..' || part === '') &&
      Buffer.from(record.path).toString('utf8') === record.path, 'Invalid audit source path');
    const keys = ['version', 'mode', 'path', 'state'];
    if (record.state === 'present') {
      keys.push('gitMode', 'gitType', 'objectId');
      assert.match(record.gitMode ?? '', /^[0-7]{6}$/, 'Invalid audit Git mode');
      assert.ok(['blob', 'commit'].includes(record.gitType), 'Invalid audit Git type');
      assert.match(record.objectId ?? '', /^[a-f0-9]{40}$/, 'Invalid audit object ID');
    } else if (record.state === 'manifest') {
      keys.push('sha256');
      assert.equal(record.mode, 'lock', 'Manifest record outside lock mode');
      assert.match(record.path, /^(apps|packages)\/[^/\\]+\/package\.json$/, 'Invalid manifest record path');
      assert.match(record.sha256 ?? '', /^[a-f0-9]{64}$/, 'Invalid manifest record digest');
    } else if (record.state === 'absent') {
      keys.push('previousRevision');
      assert.match(record.previousRevision ?? '', /^[a-f0-9]{40}$/, 'Invalid tombstone revision');
    } else assert.fail('Unknown audit record state');
    assert.deepEqual(Object.keys(record), keys, 'Invalid audit record fields/order');
    assert.equal(source, serializeRecord(record), 'Noncanonical audit record');
    assert.equal(entry.path, recordFilename(record.mode, record.path), 'Audit record path does not match filename');
    assert.ok(!records[record.mode].has(record.path), 'Duplicate logical audit record');
    records[record.mode].set(record.path, record);
  }
  assert.ok(metadata.some(entry => entry.path === auditDescriptor), 'Missing v2 audit descriptor');
  return records;
}

export function verifyModeRecords(mode, projection, records) {
  const selected = records[mode];
  assert.ok(selected instanceof Map, 'Unknown input audit mode');
  const expected = new Map(projection.rows.map(entry => [entry.path, entry]));
  const reconstructed = [];
  for (const [path, entry] of expected) {
    const record = selected.get(path);
    assert.ok(record?.state === 'present' && record.gitMode === entry.mode && record.gitType === entry.type &&
      record.objectId === entry.objectId, `Unreviewed audit input: ${path}`);
    reconstructed.push(`${record.gitMode} ${record.gitType} ${record.objectId}\t${record.path}\0`);
  }
  for (const [path, digest] of Object.entries(projection.manifests)) {
    const record = selected.get(path);
    assert.ok(record?.state === 'manifest' && record.sha256 === digest, `Unreviewed manifest input: ${path}`);
  }
  for (const [path, record] of selected) {
    if (record.state === 'absent') {
      assert.ok(!expected.has(path) && !Object.hasOwn(projection.manifests, path), `Present audit input has a tombstone: ${path}`);
    } else assert.ok(expected.has(path) || Object.hasOwn(projection.manifests, path), `Removed audit input needs a tombstone: ${path}`);
  }
  const inputSha256 = sha256(projection.rows.map(entry => entry.raw).join(''));
  assert.equal(sha256(reconstructed.join('')), inputSha256, 'Reconstructed audit inventory differs');
  return {inputSha256, documents: projection.documents, manifests: projection.manifests};
}


export function writeAuditRecords(outputs, allowedRecords = []) {
  const allowed = new Set([...allowedRecords, ...outputs.keys()]);
  const stat = path => {
    try { return lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const directories = new Set();
  const validateDirectory = path => {
    if (path === '.') return;
    validateDirectory(dirname(path));
    const info = stat(path);
    assert.ok(!info || info.isDirectory(), `Audit output directory must be a real directory: ${path}`);
    directories.add(path);
  };
  const validateFile = path => {
    const info = stat(path);
    assert.ok(!info || info.isFile() && info.nlink === 1, `Audit output must be a regular single-link file: ${path}`);
    return info;
  };
  const scan = directory => {
    const info = stat(directory);
    if (!info) return;
    assert.ok(info.isDirectory(), `Audit output directory must be a real directory: ${directory}`);
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        assert.ok(auditModes.some(mode => path === auditRecordRoot + mode), `Unknown audit output directory: ${path}`);
        scan(path);
      } else {
        assert.ok(allowed.has(path), `Unknown audit output collision: ${path}`);
        validateFile(path);
      }
    }
  };
  // Complete preflight precedes directory creation or the first write. Refusal
  // must not partly renew the evidence or follow a linked output's target.
  for (const [path, content] of outputs) {
    validateDirectory(dirname(path));
    validateFile(path);
    assert.equal(typeof content, 'string', 'Invalid audit output bytes');
  }
  scan(auditRecordRoot.slice(0, -1));
  for (const directory of directories) mkdirSync(directory, {recursive: true});
  for (const [path, content] of outputs) {
    const before = validateFile(path);
    if (before && readFileSync(path, 'utf8') === content) continue;
    const fd = openSync(path, before ? constants.O_WRONLY | constants.O_NOFOLLOW : 'wx');
    try {
      const actual = fstatSync(fd);
      assert.ok(actual.isFile() && actual.nlink === 1 && (!before || actual.ino === before.ino && actual.dev === before.dev), 'Audit output changed during write');
      writeFileSync(fd, content);
      // Existing canonical records may shrink when a source becomes a tombstone.
      if (before) {
        // ftruncate applies to the verified descriptor, never a second path lookup.
        ftruncateSync(fd, Buffer.byteLength(content));
      }
    } finally {closeSync(fd);}
  }
}
