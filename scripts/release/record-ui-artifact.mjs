import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {open, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateLedger} from './ui-ledger.mjs';
import {recordReleaseArtifact} from './ui-artifact.mjs';

try {
  const [checkoutArg, archiveArg, ledgerFlag, ledgerArg, atFlag, at, ...extra] = process.argv.slice(2);
  assert(checkoutArg && archiveArg && ledgerArg && at && !extra.length && ledgerFlag === '--ledger' && atFlag === '--at' &&
    [checkoutArg, archiveArg, ledgerArg, at].every(value => !value.startsWith('--')),
  'Usage: node scripts/release/record-ui-artifact.mjs <Waitron checkout> <archive.tgz> --ledger <releases.json> --at <UTC time>');
  const ledger = validateLedger(JSON.parse(await readFile(resolve(ledgerArg), 'utf8')));
  assert(['reserved', 'prepared'].includes(ledger.events.at(-1)?.type), 'artifact recording requires a reserved or prepared release');
  const reservation = ledger.events.findLast(event => event.type === 'reserved');
  const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1'};
  const git = args => execFileSync('git', args, {cwd: resolve(checkoutArg), env, timeout: 30000, maxBuffer: 1024 * 1024});
  const blob = path => {
    assert.match(git(['ls-tree', reservation.source.commit, '--', path]).toString('utf8'), /^100644 blob [a-f0-9]{40}\t/,
      `source input must be a regular immutable blob: ${path}`);
    return git(['show', `${reservation.source.commit}:${path}`]);
  };
  const sourceManifest = JSON.parse(blob('packages/ui-core/package.json').toString('utf8'));
  assert.equal(sourceManifest.name, '@waitron/ui-core', 'unexpected source package name');
  assert.equal(sourceManifest.version, reservation.source.version, 'source package version differs');
  const notices = Object.fromEntries(['LICENSE', 'LICENSE-GRANTS.md'].map(name => [name, blob(name)]));
  const file = await open(resolve(archiveArg), 'r');
  let archive;
  try {
    const stat = await file.stat();
    assert(stat.isFile() && stat.size <= 16 * 1024 * 1024, 'archive must be a regular file no larger than 16 MiB');
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert(length <= 16 * 1024 * 1024, 'archive exceeds 16 MiB');
    archive = bytes.subarray(0, length);
  } finally {await file.close();}
  console.log(JSON.stringify(recordReleaseArtifact(ledger, archive, {notices, at}), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
