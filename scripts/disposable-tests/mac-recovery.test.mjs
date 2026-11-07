import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {LocalLeases} from './leases.mjs';
import * as manual from './manual.mjs';

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'disposable-mac-recovery-'));
  t.after(() => rmSync(state, {recursive: true, force: true}));
  const leases = new LocalLeases(join(state, 'ledger'), {hostGeneration: 'mac', slots: 1});
  const lease = leases.reserveLocal({lane: 'I', turn: 'interrupted', snapshot: 'a'.repeat(64), argv: ['false']}).lease;
  leases.start(lease);
  const resource = join(state, lease.resourceId);
  writeFileSync(resource, 'owned guest');
  const transport = {
    destroy: async (actual, {signal}) => {signal.throwIfAborted(); assert.deepEqual(actual, lease); rmSync(resource);},
    inspect: async actual => ({resourceId: actual.resourceId, absent: !existsSync(resource)})
  };
  return {state, leases, lease, resource, transport};
}
function legacyGate(state, name, pid) {
  mkdirSync(join(state, name), {mode: 0o700});
  writeFileSync(join(state, name, 'owner.json'), JSON.stringify({version: 1, pid, nonce: '11111111-1111-4111-8111-111111111111'}), {mode: 0o600});
}
function deadPid() {const child = spawnSync(process.execPath, ['-e', '']); assert.equal(child.status, 0); return child.pid;}
async function reconcile(args) {
  assert.equal(typeof manual.reconcileManual, 'function', 'Automatic startup must reconcile the recorded turn without a supplied resource ID');
  return manual.reconcileManual(args);
}

// Omitting recorded-lease discovery would leave a dead controller blocking every lane.
test('automatic reconciliation destroys and frees the exact interrupted turn without replaying it', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid());
  const result = await reconcile(f);
  assert.equal(result.code, 0); assert.equal(result.cleanup, 'absent');
  assert.equal(existsSync(f.resource), false); assert.equal(f.leases.inspect().slots[0].state, 'free');
  assert.equal(existsSync(join(f.state, 'manual.lock')), false);
  assert.equal(f.leases.reserveLocal({lane: 'I', turn: 'interrupted', snapshot: 'a'.repeat(64), argv: ['false']}).code, 75);
});

test('automatic reconciliation refuses live and unidentified owners without touching their guest', async t => {
  for (const known of [true, false]) {
    const f = fixture(t);
    if (known) legacyGate(f.state, 'manual.lock', process.pid); else mkdirSync(join(f.state, 'manual.lock'));
    assert.equal((await reconcile(f)).code, 75);
    assert.equal(existsSync(f.resource), true); assert.equal(f.leases.inspect().slots[0].state, 'running');
  }
});

test('death before reservation releases a known abandoned preparation gate', async t => {
  const f = fixture(t); rmSync(f.resource);
  assert.equal(f.leases.release(f.lease, {resourceId: f.lease.resourceId, absent: true}), true);
  legacyGate(f.state, 'manual.lock', deadPid());
  assert.equal((await reconcile(f)).code, 0);
  assert.equal(existsSync(join(f.state, 'manual.lock')), false);
});

test('failed guest absence keeps the ordinary gate and quarantines its recorded lease', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid());
  f.transport.inspect = async () => ({resourceId: f.lease.resourceId, absent: false});
  await assert.rejects(reconcile(f), /absence|absent/i);
  assert.equal(existsSync(join(f.state, 'manual.lock')), true);
  assert.equal(f.leases.inspect().slots[0].state, 'quarantined');
});

test('an ownerless ledger lock refuses automatic recovery rather than assuming no guest', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid()); mkdirSync(join(f.state, 'ledger/lock'));
  assert.equal((await reconcile(f)).code, 75);
  assert.equal(existsSync(f.resource), true); assert.equal(existsSync(join(f.state, 'ledger/lock')), true);
});

async function abandonedGate(t, f, name) {
  const program = `import {withManualSlot} from ${JSON.stringify(new URL('./manual.mjs', import.meta.url).href)};
    await withManualSlot(process.argv[1], async () => {console.log('READY'); setInterval(() => {}, 1000); await new Promise(() => {});});`;
  const directory = join(f.state, 'owner-fixture'); mkdirSync(directory, {mode: 0o700});
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, directory], {stdio: ['ignore', 'pipe', 'pipe']});
  const closed = once(child, 'close'); let output = '';
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed;});
  await new Promise((resolve, reject) => {child.stdout.on('data', data => {output += data; if (output.includes('READY')) resolve();}); child.on('exit', () => reject(new Error('No owner readiness')));});
  const record = JSON.parse(readFileSync(join(directory, 'manual.lock/owner.json'), 'utf8'));
  child.kill('SIGKILL'); await closed;
  mkdirSync(join(f.state, name), {mode: 0o700});
  writeFileSync(join(f.state, name, 'owner.json'), JSON.stringify(record), {mode: 0o600});
  return record;
}

test('startup recovers a dead recovery guard and its interrupted exact lease', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid());
  await abandonedGate(t, f, 'recovery.lock');
  assert.equal((await reconcile(f)).code, 0);
  assert.equal(existsSync(f.resource), false); assert.equal(existsSync(join(f.state, 'recovery.lock')), false);
});

test('startup reconciles an owned dead ledger transaction before reading the committed lease', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid());
  await abandonedGate(t, f, 'ledger/lock');
  assert.equal((await reconcile(f)).code, 0);
  assert.equal(f.leases.inspect().slots[0].state, 'free'); assert.equal(existsSync(f.resource), false);
});

test('a prior boot cannot be mistaken for a live reused PID', async t => {
  const f = fixture(t); const record = await abandonedGate(t, f, 'manual.lock');
  assert.equal(record.version, 2, 'New owners need a boot and process identity');
  record.pid = process.pid; record.boot = '00000000-0000-4000-8000-000000000000';
  writeFileSync(join(f.state, 'manual.lock/owner.json'), JSON.stringify(record), {mode: 0o600});
  assert.equal((await reconcile(f)).code, 0); assert.equal(existsSync(f.resource), false);
});

function wrapperFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'disposable-mac-wrapper-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const config = join(root, 'config.json');
  writeFileSync(config, JSON.stringify({state: root}));
  const node = join(root, 'node');
  writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${root}/calls'\nif test "$3" = '--reconcile'; then exit 0; fi\necho $$ > '${root}/pid'\necho READY\nexec /bin/sleep 60\n`, {mode: 0o700});
  return {root, node, config};
}
const wrapper = new URL('../../deploy/disposable-tests/mac-controller.py', import.meta.url).pathname;
function invokeWrapper(f, args = ['--once']) {
  return spawnSync('python3', ['-I', '-B', wrapper, f.node, f.config, ...args], {encoding: 'utf8', timeout: 5000});
}

test('the Mac wrapper performs reconciliation without starting a candidate command', t => {
  const f = wrapperFixture(t); const result = invokeWrapper(f);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(f.root, 'calls'), 'utf8'), /--reconcile/);
  assert.equal(existsSync(join(f.root, 'pid')), false);
});

test('a second Mac controller returns75 while the first owns work, even if its Python parent dies', async t => {
  const f = wrapperFixture(t);
  const child = spawn('python3', ['-I', '-B', wrapper, f.node, f.config, 'I', '/candidate', '--', 'false'], {stdio: ['ignore', 'pipe', 'pipe']});
  const closed = once(child, 'close'); let output = '', errors = ''; let ownedPid;
  child.stderr.on('data', data => errors += data);
  try {
    await Promise.race([
      new Promise(resolve => child.stdout.on('data', data => {output += data; if (output.includes('READY')) resolve();})),
      closed.then(() => assert.fail('Mac wrapper never started owned work: ' + errors))
    ]);
    ownedPid = Number(readFileSync(join(f.root, 'pid'), 'utf8'));
    assert.equal(invokeWrapper(f).status, 75);
    child.kill('SIGKILL');
    // The child inherits the OS lock so a killed launcher cannot admit recovery.
    await once(child, 'exit');
    assert.equal(invokeWrapper(f).status, 75);
    process.kill(ownedPid, 'SIGKILL'); await closed;
    assert.equal(invokeWrapper(f).status, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (ownedPid) try {process.kill(ownedPid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
    await closed;
  }
});

test('a reused PID in the same boot does not retain the old owner authority', async t => {
  const f = fixture(t); const record = await abandonedGate(t, f, 'manual.lock');
  record.pid = process.pid; record.started = 'Thu Jan  1 00:00:00 1970         0';
  writeFileSync(join(f.state, 'manual.lock/owner.json'), JSON.stringify(record), {mode: 0o600});
  assert.equal((await reconcile(f)).code, 0); assert.equal(existsSync(f.resource), false);
});

test('an unknown recovery owner keeps automatic admission closed', async t => {
  const f = fixture(t); legacyGate(f.state, 'manual.lock', deadPid()); mkdirSync(join(f.state, 'recovery.lock'));
  assert.equal((await reconcile(f)).code, 75);
  assert.equal(existsSync(f.resource), true); assert.equal(existsSync(join(f.state, 'manual.lock')), true);
});

test('cancellation during a successful reconciliation cannot start the following command', async t => {
  const f=wrapperFixture(t);
  writeFileSync(f.node, `#!/bin/sh\nif test "$3" = '--reconcile'; then\n trap 'exit 0' TERM\n echo RECONCILE-READY\n while :; do /bin/sleep 0.05; done\nfi\ntouch '${f.root}/work-started'\n`, {mode:0o700});
  const child=spawn('python3',['-I','-B',wrapper,f.node,f.config,'I','/candidate','--','false'],{stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
  try {
    await Promise.race([new Promise(resolve=>child.stdout.on('data',data=>{output+=data;if(output.includes('RECONCILE-READY'))resolve();})),closed.then(()=>assert.fail('Reconciliation never started'))]);
    child.kill('SIGTERM');const [code]=await closed;
    assert.equal(code,143);assert.equal(existsSync(join(f.root,'work-started')),false);
  } finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
});

test('a live new-format ordinary owner survives automatic recovery unchanged', async t => {
  const f=fixture(t);
  await manual.withManualSlot(f.state,async()=>{
    const before=readFileSync(join(f.state,'manual.lock/owner.json'),'utf8');
    assert.equal(JSON.parse(before).version,2);
    assert.equal((await reconcile(f)).code,75);
    assert.equal(readFileSync(join(f.state,'manual.lock/owner.json'),'utf8'),before);
    assert.equal(existsSync(f.resource),true);
  });
});
