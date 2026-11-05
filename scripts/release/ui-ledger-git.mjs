import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, rmdir, realpath, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateLedger} from './ui-ledger.mjs';

const ref = 'refs/heads/ui-release-ledger';
function runGit(checkout, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let failure, termination, cleanupError, size = 0;
    const output = [], diagnostics = [];
    const child = spawn('git', args, {cwd: checkout, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'}});
    const signal = name => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, name); return true; }
      catch (error) { if (error.code !== 'ESRCH') cleanupError = error; return false; }
    };
    const stop = () => termination ??= (async () => {
      if (!signal('SIGTERM')) return;
      await new Promise(done => setTimeout(done, 250));
      signal('SIGKILL');
    })();
    const collect = chunks => chunk => {
      size += chunk.length;
      if (size <= 16 * 1024 * 1024) chunks.push(chunk);
      else if (!failure) {
        failure = new Error(`Git command output exceeded 16 MiB: ${args[0]}`);
        void stop();
      }
    };
    child.stdout.on('data', collect(output));
    child.stderr.on('data', collect(diagnostics));
    child.on('error', error => { failure ??= error; });
    const timer = setTimeout(() => {
      failure ??= Object.assign(new Error(`Git command timed out: ${args[0]}`), {code: 'ETIMEDOUT'});
      void stop();
    }, timeoutMs);
    child.on('close', (code, killedBy) => {
      clearTimeout(timer);
      void (async () => {
        if (failure || code !== 0) {
          await stop();
          failure ??= new Error(`Git command failed: ${args[0]}\n${Buffer.concat(diagnostics).toString('utf8')}`);
          failure.exitCode = code;
          failure.signal = killedBy;
          if (cleanupError) {
            failure = new AggregateError([failure, cleanupError], 'Git command and process cleanup failed');
            failure.retainLedgerLock = true;
          }
          reject(failure);
        } else resolve(Buffer.concat(output).toString('utf8').trim());
      })().catch(reject);
    });
  });
}
const git = (checkout, ...args) => runGit(checkout, args);

export async function readLedger(checkout) {
  checkout = await realpath(checkout);
  assert.equal(await realpath(await git(checkout, 'rev-parse', '--show-toplevel')), checkout, 'use the dedicated checkout root');
  assert.equal(await git(checkout, 'symbolic-ref', 'HEAD'), ref, 'use the dedicated ui-release-ledger branch');
  assert.equal(await git(checkout, 'status', '--porcelain', '--untracked-files=all', '--ignored'), '', 'ledger checkout must be clean');
  assert.equal(await git(checkout, 'ls-files', '-v'), 'H releases.json', 'ledger must track only releases.json without hidden index flags');
  assert.match(await git(checkout, 'ls-files', '--stage'), /^100644 [a-f0-9]{40} 0\treleases\.json$/, 'ledger must be a regular file');
  const head = await git(checkout, 'rev-parse', 'HEAD');
  const ledger = validateLedger(JSON.parse(await git(checkout, 'show', `${head}:releases.json`)));
  return {head, ledger};
}

export async function persistLedger(checkout, snapshot, next, {commandTimeoutMs = 30000} = {}) {
  assert(Number.isInteger(commandTimeoutMs) && commandTimeoutMs > 0 && commandTimeoutMs <= 30000, 'invalid command timeout');
  const gitDir = await git(checkout, 'rev-parse', '--absolute-git-dir');
  const lock = join(gitDir, 'ui-release-ledger.lock');
  await mkdir(lock);
  let operationError;
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
    await runGit(checkout, ['commit', '-s', '-m', `Record UI release ${next.events.at(-1).version} ${next.events.at(-1).type}`], commandTimeoutMs);
    const committed = await readLedger(checkout);
    assert.deepEqual(committed.ledger, next, 'commit hooks changed the ledger');
    assert.equal(await git(checkout, 'rev-parse', 'HEAD^'), snapshot.head, 'ledger parent changed');
    const committer = await git(checkout, 'log', '-1', '--format=%cn <%ce>');
    const message = await git(checkout, 'log', '-1', '--format=%B');
    assert(message.split('\n').includes(`Signed-off-by: ${committer}`), 'commit hook removed the committer sign-off');
    // A rejected push leaves its signed local commit for investigation, never a reset or retry.
    await runGit(checkout, ['push', `--force-with-lease=${ref}:${snapshot.head}`, 'origin', `HEAD:${ref}`], commandTimeoutMs);
    assert.equal(await git(checkout, 'ls-remote', '--refs', 'origin', ref), `${committed.head}\t${ref}`, 'remote ledger readback differs');
    return committed;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try { if (!operationError?.retainLedgerLock) await rmdir(lock); }
    catch (cleanupError) {
      if (operationError) throw new AggregateError([operationError, cleanupError],
        `${operationError.message}; ledger lock cleanup also failed`, {cause: operationError});
      throw cleanupError;
    }
  }
}
