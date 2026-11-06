import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {appendReleaseEvent, validateLedger} from './ui-ledger.mjs';
import {releaseManifest} from './ui-manifest.mjs';

const sha512 = bytes => createHash('sha512').update(bytes).digest('hex');

export function recordReleaseArtifact(ledger, archive, {notices, at}) {
  ledger = validateLedger(ledger);
  const last = ledger.events.at(-1);
  assert(last && ['reserved', 'prepared'].includes(last.type), 'artifact recording requires a reserved or prepared release');
  const reservation = ledger.events.findLast(event => event.type === 'reserved');
  assert(Buffer.isBuffer(archive) && archive.length <= 16 * 1024 * 1024, 'archive exceeds 16 MiB');
  const hash = sha512(archive);
  if (last.type === 'prepared') assert.equal(hash, last.artifact.sha512, 'prepared bytes are immutable');
  // Read one immutable byte snapshot; tar never extracts paths onto the filesystem.
  const tar = gunzipSync(archive, {maxOutputLength: 32 * 1024 * 1024});
  const readTar = args => execFileSync('tar', args, {input: tar, env: {PATH: process.env.PATH, LC_ALL: 'C'}, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  const names = readTar(['-tf', '-']).toString('utf8').trimEnd().split('\n');
  const rows = readTar(['-tvf', '-']).toString('utf8').trimEnd().split('\n');
  assert.equal(rows.length, names.length, 'ambiguous archive member inventory');
  const files = new Set(), paths = new Set();
  for (let i = 0; i < names.length; i++) {
    const name = names[i], type = rows[i][0], path = name.replace(/\/$/, '');
    assert(/^[A-Za-z0-9@._/-]+$/.test(name) && (path === 'package' || path.startsWith('package/')) &&
      !path.split('/').some(part => !part || part === '.' || part === '..'), 'invalid archive member path');
    assert(!paths.has(path), 'duplicate archive member');
    paths.add(path);
    assert(type === '-' || type === 'd', 'archive members must be regular files or directories');
    if (type === '-') files.add(path);
  }
  const member = path => {
    assert(files.has(path), `missing regular archive member: ${path}`);
    return readTar(['-xOf', '-', '--', path]);
  };
  const rawManifest = member('package/package.json');
  const manifest = JSON.parse(rawManifest.toString('utf8'));
  assert.equal(manifest.name, '@waitron-io/ui-core', 'unexpected release package name');
  assert.equal(manifest.version, reservation.version, 'release version differs from reservation');
  const expected = releaseManifest({...manifest, name: '@waitron/ui-core', version: reservation.source.version},
    reservation.source, reservation.version);
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
