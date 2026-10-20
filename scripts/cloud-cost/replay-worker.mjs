// The host controller invokes this only after effective network isolation and source-copy checks.
import { readFileSync, writeFileSync, mkdirSync, renameSync, lstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { replayPrivateDay } from './private-replay.mjs';

async function run() {
  const source = '/state/source', root = '/state/private';
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { path: root + '/journal.json', token };
  writeFileSync(root + '/.cloud-cost-owner', token, { mode: 0o600, flag: 'wx' });
  const database = root + '/venue-copy.db'; renameSync('/state/input.db', database);
  const identity = lstatSync(database);
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token,
    localResources: [{ kind: 'database-copy', state: 'ready', path: database, ino: identity.ino, dev: identity.dev }] }), { mode: 0o600, flag: 'wx' });
  const options = JSON.parse(readFileSync('/state/config.json', 'utf8'));
  const result = await replayPrivateDay({ ...options, source, root, journal, database, codeRoot: '/code', stateRoot: root + '/replay' });
  writeFileSync('/state/result.json', JSON.stringify(result), { mode: 0o600, flag: 'wx' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { process.exitCode = 1; });
}
