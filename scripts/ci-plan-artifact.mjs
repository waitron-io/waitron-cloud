import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {crc32, inflateRawSync} from 'node:zlib';

// Only the expected regular JSON member is decoded; no archive path reaches disk.
export function decodePlanArchive(bytes, limit) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= limit + 2048, 'Invalid plan archive size');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'Missing ZIP end record');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'Split ZIP archive');
  assert.equal(bytes.readUInt16LE(end + 6), 0, 'Split ZIP directory');
  assert.equal(bytes.readUInt16LE(end + 8), 1, 'Expected one archive member');
  assert.equal(bytes.readUInt16LE(end + 10), 1, 'Expected one archive member');
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'ZIP comments are unsupported');
  const directorySize = bytes.readUInt32LE(end + 12);
  const directory = bytes.readUInt32LE(end + 16);
  assert.ok(directory >= 30 && directory + directorySize === end && directorySize >= 46, 'Invalid ZIP directory');
  assert.equal(bytes.readUInt32LE(directory), 0x02014b50, 'Missing ZIP member');
  const flags = bytes.readUInt16LE(directory + 8);
  const method = bytes.readUInt16LE(directory + 10);
  assert.ok([0, 8, 0x800, 0x808].includes(flags), 'Encrypted or unsupported ZIP flags');
  assert.ok([0, 8].includes(method), 'Unsupported ZIP compression');
  const crc = bytes.readUInt32LE(directory + 16);
  const compressedSize = bytes.readUInt32LE(directory + 20);
  const size = bytes.readUInt32LE(directory + 24);
  assert.ok(size > 0 && size <= limit && compressedSize > 0 && compressedSize <= limit + 1024, 'Invalid member size');
  const nameLength = bytes.readUInt16LE(directory + 28);
  const extraLength = bytes.readUInt16LE(directory + 30);
  const commentLength = bytes.readUInt16LE(directory + 32);
  assert.equal(46 + nameLength + extraLength + commentLength, directorySize, 'Invalid member directory size');
  assert.equal(bytes.readUInt16LE(directory + 34), 0, 'Split archive member');
  assert.equal(bytes.readUInt32LE(directory + 42), 0, 'Unexpected member offset');
  const attrs = bytes.readUInt32LE(directory + 38);
  const mode = attrs >>> 16;
  assert.ok(!(attrs & 0x10) && (mode === 0 || (mode & 0o170000) === 0o100000), 'Nonregular archive member');
  const name = bytes.subarray(directory + 46, directory + 46 + nameLength);
  assert.ok(name.equals(Buffer.from('plan.json')), 'Unexpected archive member name');
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'Missing local member');
  assert.equal(bytes.readUInt16LE(6), flags, 'Conflicting ZIP flags');
  assert.equal(bytes.readUInt16LE(8), method, 'Conflicting ZIP compression');
  assert.equal(bytes.readUInt16LE(26), nameLength, 'Conflicting member name');
  assert.ok(bytes.subarray(30, 30 + nameLength).equals(name), 'Conflicting member name');
  const dataStart = 30 + nameLength + bytes.readUInt16LE(28);
  const dataEnd = dataStart + compressedSize;
  assert.ok(dataStart <= directory && dataEnd <= directory, 'Truncated member');
  if (flags & 8) {
    const signed = dataEnd + 4 <= directory && bytes.readUInt32LE(dataEnd) === 0x08074b50;
    const descriptor = dataEnd + (signed ? 4 : 0);
    assert.equal(descriptor + 12, directory, 'Invalid data descriptor');
    assert.equal(bytes.readUInt32LE(descriptor), crc, 'Conflicting descriptor CRC');
    assert.equal(bytes.readUInt32LE(descriptor + 4), compressedSize, 'Conflicting descriptor size');
    assert.equal(bytes.readUInt32LE(descriptor + 8), size, 'Conflicting descriptor size');
  } else {
    assert.equal(dataEnd, directory, 'Unindexed archive data');
    assert.equal(bytes.readUInt32LE(14), crc, 'Conflicting local CRC');
    assert.equal(bytes.readUInt32LE(18), compressedSize, 'Conflicting local size');
    assert.equal(bytes.readUInt32LE(22), size, 'Conflicting local size');
  }
  const compressed = bytes.subarray(dataStart, dataEnd);
  const result = method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: limit, info: true});
  const decoded = method === 0 ? result : result.buffer;
  if (method === 8) assert.equal(result.engine.bytesWritten, compressedSize, 'Trailing compressed data');
  assert.equal(decoded.length, size, 'Incorrect decoded member size');
  assert.equal(crc32(decoded), crc, 'Corrupt archive member');
  return decoded;
}

export function assertArtifactMetadata(artifact, bytes, identity, limit, kind = 'plan') {
  const {workflowPath, runId, attempt, head, repositoryId} = identity;
  assert.ok(Number.isSafeInteger(artifact?.id) && artifact.id > 0, 'Invalid artifact identity');
  const key = workflowPath.match(/^\.github\/workflows\/([a-z-]+)\.yml$/)?.[1];
  assert.ok(key && Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0, 'Invalid artifact binding');
  assert.ok(['plan', 'decision'].includes(kind), 'Unsupported artifact kind');
  assert.equal(artifact.name, `ci-${kind}-v1-${key}-${runId}-${attempt}`, 'Wrong artifact name or attempt');
  assert.equal(artifact.expired, false, 'Expired artifact');
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= limit + 2048 && bytes.length > 0, 'Invalid artifact size');
  assert.equal(artifact.size_in_bytes, bytes.length, 'Wrong artifact size');
  assert.equal(artifact.digest, 'sha256:' + createHash('sha256').update(bytes).digest('hex'), 'Wrong artifact digest');
  assert.equal(artifact.workflow_run?.id, runId, 'Wrong artifact run');
  assert.equal(artifact.workflow_run.head_sha, head, 'Wrong artifact head');
  assert.equal(artifact.workflow_run.repository_id, repositoryId, 'Wrong artifact repository');
  assert.equal(artifact.workflow_run.head_repository_id, repositoryId, 'Wrong artifact head repository');
}
