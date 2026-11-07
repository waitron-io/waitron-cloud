import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const module = new URL('./leases.mjs', import.meta.url);
const request = (turn = 'turn-1') => ({lane: 'I', turn, snapshot: 'a'.repeat(64), argv: ['node', '--version']});
const config = {hostGeneration: 'bridge-1', slots: 1};
async function setup(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'disposable-leases-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const {LocalLeases} = await import(module);
  return {dir, leases: new LocalLeases(dir, {...config, ...extra})};
}

test('another lane cannot claim an occupied slot, including across controller restarts', async t => {
  // Removing the persistent occupancy check would admit two owners.
  const {leases, dir} = await setup(t);
  const first = leases.reserveLocal(request());
  assert.equal(first.code, 0);
  const {LocalLeases} = await import(module);
  const other = new LocalLeases(dir, config);
  assert.equal(other.reserveLocal({...request('turn-2'), lane: 'H'}).code, 75);
  assert.equal(other.inspect().slots[0].lease.lane, 'I');
});

test('a repeated request returns one identity and grants only one start', async t => {
  // Removing the start transition would permit duplicate VM creation.
  const {leases} = await setup(t);
  const first = leases.reserveLocal(request());
  assert.equal(first.created, true);
  const again = leases.reserveLocal(request());
  assert.equal(again.created, false);
  assert.deepEqual(again.lease, first.lease);
  assert.equal(leases.start(first.lease), true);
  assert.equal(leases.start(again.lease), false);
});

test('a different command or snapshot cannot reuse a turn identity', async t => {
  const {leases} = await setup(t);
  leases.reserveLocal(request());
  assert.throws(() => leases.reserveLocal({...request(), argv: ['sh', '-c', 'false']}), /turn.*different/i);
  assert.throws(() => leases.reserveLocal({...request(), snapshot: 'b'.repeat(64)}), /turn.*different/i);
});

test('an old lease cannot release its successor or start again after completion', async t => {
  // Removing the generation comparison would let a delayed callback free new work.
  const {leases} = await setup(t);
  const first = leases.reserveLocal(request()).lease;
  assert.equal(leases.start(first), true);
  assert.equal(leases.release(first, {resourceId: first.resourceId, absent: true}), true);
  assert.equal(leases.reserveLocal(request()).code, 75, 'completed turns cannot be replayed');
  const next = leases.reserveLocal(request('turn-2')).lease;
  assert.equal(next.generation, 2);
  assert.notEqual(next.resourceId, first.resourceId);
  assert.equal(leases.release(first, {resourceId: first.resourceId, absent: true}), false);
  assert.equal(leases.start(first), false);
  assert.equal(leases.inspect().slots[0].lease.turn, 'turn-2');
});

for (const observation of [undefined, {absent: false}, {absent: 'true'}, {absent: true, resourceId: 'someone-elses-vm'}]) {
  test(`uncertain or unrelated destruction never frees a slot: ${JSON.stringify(observation)}`, async t => {
    const {leases} = await setup(t);
    const lease = leases.reserveLocal(request()).lease;
    leases.start(lease);
    assert.equal(leases.release(lease, observation), false);
    assert.equal(leases.inspect().slots[0].state, 'quarantined');
    assert.equal(leases.reserveLocal(request('turn-2')).code, 75);
    assert.equal(leases.release(lease, {absent: true, resourceId: lease.resourceId}), true);
    assert.equal(leases.reserveLocal(request('turn-2')).code, 0);
  });
}

test('expiry quarantines work instead of treating the deadline as proof of absence', async t => {
  let now = 1000;
  const {leases} = await setup(t, {now: () => now});
  const lease = leases.reserveLocal(request(), {durationMs: 100}).lease;
  assert.equal(lease.deadline, 1100);
  now = 1100;
  assert.equal(leases.start(lease), false);
  assert.equal(leases.reserveLocal(request('turn-2')).code, 75);
  assert.equal(leases.inspect().slots[0].state, 'quarantined');
});

test('host down and held ledger lock return busy promptly without reserving', async t => {
  const {leases, dir} = await setup(t);
  const begin = performance.now();
  assert.equal(leases.reserveLocal(request(), {healthy: false}).code, 75);
  assert.equal(leases.inspect().slots[0].state, 'free');
  mkdirSync(join(dir, 'lock'));
  assert.equal(leases.reserveLocal(request()).code, 75);
  assert.ok(performance.now() - begin < 1000);
});

test('lease duration cannot exceed 55 minutes and invalid requests never reserve', async t => {
  const {leases} = await setup(t);
  for (const budget of [{durationMs: 3300001}, {durationMs: 0}, {durationMs: NaN}]) {
    assert.throws(() => leases.reserveLocal(request(), budget), /duration/i);
  }
  for (const bad of [{lane: '../I'}, {turn: ''}, {snapshot: 'not-a-digest'}, {argv: []}, {argv: ['node', '\0']}]) {
    assert.throws(() => leases.reserveLocal({...request(), ...bad}), /request/i);
  }
  const lease = leases.reserveLocal(request()).lease;
  assert.equal(lease.deadline - lease.createdAt, 3300000);
});

test('host generation or slot budget changes refuse an existing ledger', async t => {
  const {leases, dir} = await setup(t);
  leases.reserveLocal(request());
  const {LocalLeases} = await import(module);
  assert.throws(() => new LocalLeases(dir, {...config, hostGeneration: 'replacement-2'}).inspect(), /configuration/i);
  assert.throws(() => new LocalLeases(dir, {...config, slots: 2}).inspect(), /configuration/i);
  assert.equal(leases.inspect().slots[0].lease.turn, 'turn-1');
});

test('simultaneous processes admit exactly one owner', async t => {
  const {leases, dir} = await setup(t);
  leases.inspect();
  const children = Array.from({length: 8}, (_, i) => new Promise((resolve, reject) => {
    const program = `import {LocalLeases} from ${JSON.stringify(module.href)}; console.log(JSON.stringify(new LocalLeases(process.argv[1], ${JSON.stringify(config)}).reserveLocal(${JSON.stringify(request(`parallel-${i}`))})));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, dir], {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '';
    // Delay reading until exit so parsing must wait for stream closure.
    child.stdout.pause();
    child.once('exit', () => child.stdout.resume());
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => err += b);
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `Lease child failed (${signal ?? code})`)));
  }));
  const results = await Promise.all(children);
  assert.equal(results.filter(r => r.code === 0).length, 1);
  assert.equal(results.filter(r => r.code === 75).length, 7);
  const state = JSON.parse(readFileSync(join(dir, 'state.json')));
  assert.equal(state.slots.filter(s => s.state !== 'free').length, 1);
});

test('a busy ledger cannot be mistaken for permission to start or release a guest', async t => {
  const {leases, dir} = await setup(t);
  const lease = leases.reserveLocal(request()).lease;
  mkdirSync(join(dir, 'lock'));
  assert.equal(leases.start(lease), false);
  assert.equal(leases.release(lease, {absent: true, resourceId: lease.resourceId}), false);
});

test('an unreadable or incomplete occupied ledger refuses admission', async t => {
  const {leases, dir} = await setup(t);
  leases.reserveLocal(request());
  const state = JSON.parse(readFileSync(join(dir, 'state.json')));
  delete state.slots[0].lease.deadline;
  const {writeFileSync} = await import('node:fs');
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  assert.throws(() => leases.reserveLocal(request('turn-2')), /invalid.*lease/i);
  assert.throws(() => leases.inspect(), /invalid.*lease/i);
});

for (const turn of [undefined, null, 12]) {
  test(`a missing or non-string turn cannot become a durable request ID: ${String(turn)}`, async t => {
    const {leases} = await setup(t);
    assert.throws(() => leases.reserveLocal({...request(), turn}), /invalid.*request/i);
    assert.equal(leases.inspect().slots[0].state, 'free');
  });
}

test('a missing host generation cannot allocate an unnamed host', async t => {
  await assert.rejects(setup(t, {hostGeneration: undefined}), /invalid.*configuration/i);
});
