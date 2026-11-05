import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, rmdir, realpath, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateLedger} from './ui-ledger.mjs';

const exec = promisify(execFile);
const ref = 'refs/heads/ui-release-ledger';
async function git(checkout, ...args) {
  const {stdout} = await exec('git', args, {cwd: checkout, encoding: 'utf8', timeout: 30000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    maxBuffer: 16 * 1024 * 1024});
  return stdout.trim();
}

export async function readLedger(checkout) {
  checkout = await realpath(checkout);
  assert.equal(await realpath(await git(checkout, 'rev-parse', '--show-toplevel')), checkout, 'use the dedicated checkout root');
  assert.equal(await git(checkout, 'symbolic-ref', 'HEAD'), ref, 'use the dedicated ui-release-ledger branch');
  assert.equal(await git(checkout, 'status', '--porcelain', '--untracked-files=all'), '', 'ledger checkout must be clean');
  assert.equal(await git(checkout, 'ls-files', '-v'), 'H releases.json', 'ledger must track only releases.json without hidden index flags');
  assert.match(await git(checkout, 'ls-files', '--stage'), /^100644 [a-f0-9]{40} 0\treleases\.json$/, 'ledger must be a regular file');
  const head = await git(checkout, 'rev-parse', 'HEAD');
  const ledger = validateLedger(JSON.parse(await git(checkout, 'show', `${head}:releases.json`)));
  return {head, ledger};
}

export async function persistLedger(checkout, snapshot, next) {
  const gitDir = await git(checkout, 'rev-parse', '--absolute-git-dir');
  const lock = join(gitDir, 'ui-release-ledger.lock');
  await mkdir(lock);
  try {
    const actual = await readLedger(checkout);
    assert.deepEqual(snapshot, actual, 'ledger snapshot is stale or differs from committed bytes');
    const remoteHead = await git(checkout, 'ls-remote', '--refs', 'origin', ref);
    assert.equal(remoteHead, `${snapshot.head}\t${ref}`, 'remote ledger snapshot is stale or missing');
    next = validateLedger(next);
    assert(next.events.length >= actual.ledger.events.length && next.events.length <= actual.ledger.events.length + 1,
      'append-only persistence permits one transition at a time');
    assert.deepEqual(next.events.slice(0, actual.ledger.events.length), actual.ledger.events, 'ledger history is append-only');
    if (next.events.length === actual.ledger.events.length) return actual;
    await writeFile(join(checkout, 'releases.json'), JSON.stringify(next, null, 2) + '\n');
    await git(checkout, 'add', '--', 'releases.json');
    await git(checkout, 'commit', '-s', '-m', `Record UI release ${next.events.at(-1).version} ${next.events.at(-1).type}`);
    const committed = await readLedger(checkout);
    assert.deepEqual(committed.ledger, next, 'commit hooks changed the ledger');
    assert.equal(await git(checkout, 'rev-parse', 'HEAD^'), snapshot.head, 'ledger parent changed');
    // A rejected push leaves its signed local commit for investigation, never a reset or retry.
    await git(checkout, 'push', `--force-with-lease=${ref}:${snapshot.head}`, 'origin', `HEAD:${ref}`);
    assert.equal(await git(checkout, 'ls-remote', '--refs', 'origin', ref), `${committed.head}\t${ref}`, 'remote ledger readback differs');
    return committed;
  } finally {
    await rmdir(lock);
  }
}
