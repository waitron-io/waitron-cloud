// Generated workers only. No venue, credentials or downloaded runtime is used here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import * as local from '../local.mjs';

const docker = argv => execFileSync('docker', argv, { env: { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' },
  encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const bad = { message: 'Invalid cloud cost local run' };
async function fixture(t, body, { unsafe = false, temporary = true, pinned = true, user = `${process.getuid()}:${process.getgid()}`, readonly = true, drop = true, secure = true, logging = 'none' } = {}) {
  assert.equal(typeof local.runForegroundContainer, 'function', 'supervise the owned container, not just its attached client');
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-foreground-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  for (const p of [source, root]) mkdirSync(p, { mode: 0o700 });
  const codeRoot = join(root, 'code'), stateRoot = join(root, 'state');
  for (const p of [codeRoot, stateRoot]) mkdirSync(p, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') };
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(join(codeRoot, 'worker.mjs'), body, { mode: 0o600 });
  writeFileSync(join(source, 'sentinel'), 'source unchanged', { mode: 0o600 });
  const name = 'cloud-cost-foreground-' + token.slice(0, 12);
  let networkId, containerId;
  t.after(() => {
    if (containerId && docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + containerId])) docker(['rm', '-f', '-v', containerId]);
    if (networkId) docker(['network', 'rm', networkId]);
    rmSync(parent, { recursive: true });
  });
  const image = docker(['image', 'inspect', 'node:26.11.1-slim', '--format', '{{.Id}}']);
  networkId = docker(['network', 'create', '--internal', '--label', 'io.waitron.cloud-cost.owner=' + token, name]);
  containerId = docker(['create', '--pull=never', '--name', name,
    '--user', user, '--network', networkId,
    '--label', 'io.waitron.cloud-cost.owner=' + token, '--label', 'io.waitron.cloud-cost.role=replay',
    '--dns', '127.0.0.1', ...(readonly ? ['--read-only'] : []), ...(drop ? ['--cap-drop', 'ALL'] : []),
    ...(secure ? ['--security-opt', 'no-new-privileges:true'] : []),
    ...(unsafe ? ['--env', 'PRIVATE_SYNTHETIC_EXTERNAL_ENDPOINT=unsafe'] : []),
    ...(temporary ? ['--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'] : []), '--log-driver', logging,
    '--mount', `type=bind,src=${codeRoot},dst=/code,readonly`, '--mount', `type=bind,src=${stateRoot},dst=/state`,
    pinned ? image : 'node:26.11.1-slim', 'node', '-e', 'setInterval(()=>{},1000)']);
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token,
    localResources: [{ kind: 'network', state: 'started', id: networkId }, { kind: 'container', state: 'started', id: containerId }] }), { mode: 0o600 });
  docker(['start', containerId]);
  return { source, root, codeRoot, stateRoot, journal, networkId, containerId,
    argv: ['node', '/code/worker.mjs'], windowSeconds: 7200 };
}
function gone(f) {
  assert.equal(docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + f.containerId]), '');
  assert.equal(readFileSync(join(f.source, 'sentinel'), 'utf8'), 'source unchanged');
  assert.equal(docker(['network', 'inspect', f.networkId, '--format', '{{.Id}}']), f.networkId);
  const entries = JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources;
  const cleanup = entries.findIndex(e => e.kind === 'container' && e.state === 'cleanup-intent');
  const removed = entries.findIndex(e => e.kind === 'container' && e.state === 'removed');
  assert.ok(cleanup >= 0 && removed > cleanup, 'journal removal before changing the owned container');
  const child = entries.find(e => e.kind === 'process' && e.state === 'started');
  if (child) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
}

// Refusing a two-hour budget or deleting only the Docker client breaks the actual worker's lifecycle.
test('foregroundWorkerAcceptsFullWindowAndCollectsItsContainerWithoutRawOutput', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs';
    console.log('PRIVATE_SYNTHETIC_OUTPUT'); console.error('PRIVATE_SYNTHETIC_OUTPUT');
    writeFileSync('/state/completed','done');`);
  const result = await local.runForegroundContainer(f);
  assert.deepEqual(result, { exitCode: 0, cleanup: { workerContainers: 0 } });
  assert.equal(readFileSync(join(f.stateRoot, 'completed'), 'utf8'), 'done');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC'), false);
  gone(f);
});

test('foregroundWorkerFailureIsSanitizedAndStillRemovesItsContainer', async t => {
  const f = await fixture(t, `throw Error('PRIVATE_SYNTHETIC_FAILURE')`);
  await assert.rejects(local.runForegroundContainer(f), e => e.message === bad.message
    && !e.stack.includes('PRIVATE_SYNTHETIC') && e.cause === undefined);
  gone(f);
});

// Ignoring SIGTERM or terminating the client alone must not leave the container's worker alive.
test('foregroundDeadlineStopsAnUnresponsiveContainerWorker', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs';
    process.on('SIGTERM',()=>{}); writeFileSync('/state/started','yes'); setInterval(()=>{},10);`);
  let fallbackUsed = false;
  const fallback = setTimeout(() => { fallbackUsed = true; docker(['kill', f.containerId]); }, 5000);
  try { await assert.rejects(local.runForegroundContainer({ ...f, windowSeconds: 0.5 }), bad); }
  finally { clearTimeout(fallback); }
  assert.equal(fallbackUsed, false, 'deadline must collect the worker before the independent fallback');
  assert.equal(readFileSync(join(f.stateRoot, 'started'), 'utf8'), 'yes');
  gone(f);
});

test('foregroundCancellationWaitsForOwnedWorkerCleanup', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs';
    process.on('SIGTERM',()=>{}); writeFileSync('/state/started','yes'); setInterval(()=>{},10);`);
  const controller = new AbortController();
  const running = local.runForegroundContainer({ ...f, signal: controller.signal });
  const deadline = Date.now() + 10000;
  while (!existsSync(join(f.stateRoot, 'started')) && Date.now() < deadline) await delay(25);
  assert.equal(existsSync(join(f.stateRoot, 'started')), true);
  let fallbackUsed = false;
  const fallback = setTimeout(() => { fallbackUsed = true; docker(['kill', f.containerId]); }, 5000);
  controller.abort();
  try { await assert.rejects(running, bad); }
  finally { clearTimeout(fallback); }
  assert.equal(fallbackUsed, false, 'cancellation must collect the worker before the independent fallback');
  gone(f);
});

// A recorded Docker ID alone is insufficient ownership, and no refusal may delete a foreign worker.
test('foregroundRefusesUnrecordedRemovedOrForeignContainerWithoutTouchingIt', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/entered','yes');`);
  const original = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  for (const entries of [[], original.localResources.filter(e => e.kind !== 'network'),
    [...original.localResources, {kind:'container',id:f.containerId,state:'removed'}]]) {
    writeFileSync(f.journal.path, JSON.stringify({ ...original, localResources: entries }), { mode: 0o600 });
    await assert.rejects(local.runForegroundContainer(f), bad);
    assert.equal(docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + f.containerId]), f.containerId, 'refusal must preserve the existing worker');
    assert.equal(docker(['inspect', f.containerId, '--format', '{{.State.Running}}']), 'true');
    assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
  }
  const foreign = 'e'.repeat(64);
  writeFileSync(join(f.root, '.cloud-cost-owner'), foreign, {mode:0o600});
  writeFileSync(f.journal.path, JSON.stringify({...original,ownershipToken:foreign}), {mode:0o600});
  await assert.rejects(local.runForegroundContainer({...f,journal:{...f.journal,token:foreign}}), bad);
  assert.equal(docker(['inspect', f.containerId, '--format', '{{.State.Running}}']), 'true');
  assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
});

test('foregroundRefusesUnsafeEffectiveEnvironmentAndCollectsOnlyItsWorker', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/entered','yes');`, {unsafe:true});
  await assert.rejects(local.runForegroundContainer(f), bad);
  assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
  gone(f);
});

test('foregroundPrecancelledRunCollectsOwnedWorkerWithoutExecutingIt', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/entered','yes');`);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(local.runForegroundContainer({...f,signal:controller.signal}), bad);
  assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
  gone(f);
});

test('foregroundInvalidWindowCannotRunOrRemoveTheRecordedWorker', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/entered','yes');`);
  for (const windowSeconds of [0,-1,7200.001,NaN,Infinity,'7200']) {
    await assert.rejects(local.runForegroundContainer({...f,windowSeconds}), bad);
    assert.equal(docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + f.containerId]), f.containerId, 'refusal must preserve the existing worker');
    assert.equal(docker(['inspect', f.containerId, '--format', '{{.State.Running}}']), 'true');
    assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
  }
  assert.deepEqual(await local.runForegroundContainer(f), {exitCode:0,cleanup:{workerContainers:0}});
  assert.equal(readFileSync(join(f.stateRoot, 'entered'),'utf8'),'yes');
  gone(f);
});

// A mutable image, root user or absent scratch /tmp must be refused before private work starts.
for (const [name, options] of [['floating image',{pinned:false}], ['root user',{user:'0:0'}], ['missing temp',{temporary:false}],
  ['writable image',{readonly:false}], ['capabilities',{drop:false}],
  ['privilege escalation',{secure:false}], ['retained logs',{logging:'json-file'}]]) {
  test('foregroundRejectsWorkerWith'+name, async t => {
    const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/entered','yes');`, options);
    await assert.rejects(local.runForegroundContainer(f), bad);
    assert.equal(existsSync(join(f.stateRoot, 'entered')), false);
    gone(f);
  });
}

// Losing the ownership token must surface failed cleanup instead of deleting under a new owner.
test('foregroundReportsLostOwnershipAndPreservesTheContainerForRecovery', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs';
    writeFileSync('/state/started','yes'); setInterval(()=>{},10);`);
  const controller = new AbortController();
  const running = local.runForegroundContainer({...f, signal:controller.signal});
  const deadline = Date.now()+10000;
  while (!existsSync(join(f.stateRoot,'started')) && Date.now()<deadline) await delay(25);
  assert.equal(existsSync(join(f.stateRoot,'started')),true);
  writeFileSync(join(f.root,'.cloud-cost-owner'),'0'.repeat(64),{mode:0o600});
  controller.abort();
  await assert.rejects(running,bad);
  assert.equal(docker(['inspect',f.containerId,'--format','{{.State.Running}}']),'true');
  const entries=JSON.parse(readFileSync(f.journal.path,'utf8')).localResources;
  assert.equal(entries.some(e=>e.kind==='container'&&e.state==='removed'),false);
  writeFileSync(join(f.root,'.cloud-cost-owner'),f.journal.token,{mode:0o600});
  const child=entries.find(e=>e.kind==='process'&&e.state==='started');
  assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});

// A caller changing its argument array during the isolation await cannot replace the admitted worker.
test('foregroundSnapshotsValidatedArgumentsBeforeYielding', async t => {
  const f = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('/state/completed','original worker');`);
  const running = local.runForegroundContainer(f);
  f.argv.splice(0, f.argv.length, 'node', '-e', 'throw Error("PRIVATE_SYNTHETIC_REPLACED_WORKER")');
  let result;
  await assert.doesNotReject(async () => { result = await running; }, 'the validated original worker must still complete');
  assert.deepEqual(result, { exitCode: 0, cleanup: { workerContainers: 0 } });
  assert.equal(readFileSync(join(f.stateRoot, 'completed'), 'utf8'), 'original worker');
  gone(f);
});

// Inheriting either child stream would expose private output even if the returned object is clean.
test('foregroundWorkerOutputDoesNotReachTheCallingProcess', async t => {
  const f = await fixture(t, `console.log('PRIVATE_SYNTHETIC_STDOUT'); console.error('PRIVATE_SYNTHETIC_STDERR');`);
  const config = join(f.root,'host-config.json');
  writeFileSync(config,JSON.stringify(f),{mode:0o600});
  const output=spawnSync(process.execPath,['--input-type=module','-e',
    `import {readFileSync} from 'node:fs';
     import {runForegroundContainer} from ${JSON.stringify(new URL('../local.mjs',import.meta.url).href)};
     await runForegroundContainer(JSON.parse(readFileSync(process.argv[1],'utf8')));`,config],
    {env:{PATH:process.env.PATH,LANG:'C',TZ:'UTC'},encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});
  assert.equal(output.status,0);
  assert.equal(output.stdout,'');
  assert.equal(output.stderr,'');
  gone(f);
});
