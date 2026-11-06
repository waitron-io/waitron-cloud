import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {appendReleaseEvent, validateLedger} from './ui-ledger.mjs';
import {releaseManifest} from './ui-manifest.mjs';

const sha512 = bytes => createHash('sha512').update(bytes).digest('hex');

function archiveFiles(archive) {
  const tar = gunzipSync(archive, {maxOutputLength: 32 * 1024 * 1024});
  assert(tar.length >= 1024 && tar.length % 512 === 0, 'invalid tar block framing');
  const files = new Map(), paths = new Map();
  const text = bytes => {
    const end = bytes.indexOf(0);
    assert(end < 0 || bytes.subarray(end).every(value => value === 0), 'invalid tar text field');
    return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
  };
  const number = bytes => {
    const field = bytes.toString('latin1');
    assert(/^[0-7]+[ \0]*$/.test(field), 'unsupported tar numeric field');
    return parseInt(field, 8);
  };
  let offset = 0, ended = false;
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      // Consumers disagree about a lone zero block; all remaining bytes must be zero.
      assert(tar.length - offset >= 1024 && tar.subarray(offset).every(value => value === 0), 'invalid tar end marker or hidden members');
      ended = true; break;
    }
    const checksum = [...header].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(number(header.subarray(148, 156)), checksum, 'invalid tar header checksum');
    assert.equal(header.subarray(257, 265).toString('binary'), 'ustar\0' + '00', 'unsupported tar format');
    const type = header[156];
    assert([0, 48, 53].includes(type), 'archive members must be regular files or directories');
    assert(header.subarray(157, 257).every(value => value === 0), 'unexpected tar link target');
    const prefix = text(header.subarray(345, 500)), name = (prefix ? prefix + '/' : '') + text(header.subarray(0, 100));
    const directory = type === 53, path = directory ? name.replace(/\/$/, '') : name;
    assert(/^[A-Za-z0-9@._/-]+$/.test(name) && (path.startsWith('package/') || directory && path === 'package') &&
      !path.split('/').some(part => !part || part === '.' || part === '..'), 'invalid archive member path');
    const key = path.toLowerCase();
    assert(!paths.has(key), 'duplicate archive member or case collision');
    assert(!key.endsWith('/binding.gyp'), 'implicit native builds are forbidden');
    paths.set(key, directory);
    const size = number(header.subarray(124, 136));
    assert(!directory || size === 0, 'directory member has file content');
    const end = offset + 512 + size, next = offset + 512 + Math.ceil(size / 512) * 512;
    assert(next <= tar.length, 'truncated archive member');
    assert(tar.subarray(end, next).every(value => value === 0), 'invalid tar member padding');
    if (!directory) files.set(path, tar.subarray(offset + 512, end));
    offset = next;
  }
  assert(ended, 'missing tar end marker');
  for (const path of paths.keys()) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length++) {
      assert(paths.get(parts.slice(0, length).join('/')) !== false, 'regular archive file cannot contain child members');
    }
  }
  return files;
}

export function recordReleaseArtifact(ledger, archive, {sourceManifest, notices, at}) {
  ledger = validateLedger(ledger);
  const last = ledger.events.at(-1);
  assert(last && ['reserved', 'prepared'].includes(last.type), 'artifact recording requires a reserved or prepared release');
  const reservation = ledger.events.findLast(event => event.type === 'reserved');
  assert(Buffer.isBuffer(archive) && archive.length <= 16 * 1024 * 1024, 'archive exceeds 16 MiB');
  const hash = sha512(archive);
  if (last.type === 'prepared') assert.equal(hash, last.artifact.sha512, 'prepared bytes are immutable');
  const files = archiveFiles(archive);
  const member = path => {
    assert(files.has(path), `missing regular archive member: ${path}`);
    return files.get(path);
  };
  const rawManifest = member('package/package.json');
  const manifest = JSON.parse(rawManifest.toString('utf8'));
  assert.equal(manifest.name, '@waitron-io/ui-core', 'unexpected release package name');
  assert.equal(manifest.version, reservation.version, 'release version differs from reservation');
  assert.equal(manifest.license, 'SEE LICENSE IN dist/LICENSE', 'release licence metadata differs');
  assert.deepEqual(manifest.optionalDependencies ?? {}, {}, 'runtime dependencies must remain external');
  assert(manifest.bin === undefined && manifest.gypfile === undefined, 'library manifest cannot declare executable entry points or native build hooks');
  assert(typeof manifest.peerDependencies?.lit === 'string' && manifest.peerDependencies.lit.trim(), 'external Lit peer required');
  const packedSource = {...sourceManifest, exports: sourceManifest.publishConfig?.exports ?? sourceManifest.exports};
  const expected = releaseManifest(packedSource, reservation.source, reservation.version);
  assert.deepEqual(manifest, expected, 'release manifest differs from reserved identity or contains build hooks');
  for (const target of Object.values(manifest.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))) {
    assert(files.has('package/' + target.slice(2)), `missing regular built export: ${target}`);
  }
  const noticeHashes = {};
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    assert(Buffer.isBuffer(notices[notice]), 'expected immutable source notice bytes');
    const bytes = member('package/dist/' + notice);
    assert.deepEqual(bytes, notices[notice], `notice differs from reserved source: ${notice}`);
    noticeHashes[notice] = sha512(bytes);
  }
  return appendReleaseEvent(ledger, {type: 'prepared', sourceCommit: reservation.source.commit,
    version: reservation.version, at, artifact: {sha512: hash, manifestSha512: sha512(rawManifest), notices: noticeHashes}});
}
