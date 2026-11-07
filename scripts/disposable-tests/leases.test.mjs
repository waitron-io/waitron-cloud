import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, rmSync, existsSync, statSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const module = new URL('./leases.mjs', import.meta.url);
const request = (turn = 'turn-1') => ({lane: 'I', turn, snapshot: 'a'.repeat(64), argv: ['node', '--version']});
const config = {hostGeneration: 'bridge-1', slots: 1};

test('ordinary ledger reads refuse missing state without inventing an empty slot', async t => {
  const root = mkdtempSync(join(tmpdir(), 'disposable-missing-ledger-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const {LocalLeases} = await import(module);
  const dir = join(root, 'ledger');
  assert.throws(() => new LocalLeases(dir, config).inspect(), /missing|ENOENT/i);
  assert.equal(existsSync(dir), false);
});

test('explicit ledger bootstrap persists fresh state and refuses an existing directory', async t => {
  const root = mkdtempSync(join(tmpdir(), 'disposable-bootstrap-ledger-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const {LocalLeases} = await import(module);
  const dir = join(root, 'ledger');
  const leases = new LocalLeases(dir, {...config, bootstrap:true});
  assert.equal(existsSync(join(dir, 'state.json')), true);
  assert.equal(leases.inspect().slots[0].state, 'free');
  assert.throws(() => new LocalLeases(dir, {...config, bootstrap:true}), /EEXIST|existing/i);
  rmSync(join(dir, 'state.json'));
  assert.throws(() => leases.inspect(), /missing|ENOENT/i);
  assert.equal(existsSync(join(dir, 'state.json')), false);
});
async function setup(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'disposable-leases-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const dir = join(root, 'ledger');
  const {LocalLeases} = await import(module);
  return {dir, leases: new LocalLeases(dir, {...config, ...extra, bootstrap:true})};
}

test('idle inspection leaves the durable ledger untouched', async t => {
  const {leases,dir}=await setup(t);const path=join(dir,'state.json');
  const before=readFileSync(path,'utf8');utimesSync(path,new Date(0),new Date(0));
  assert.equal(leases.inspect().slots[0].state,'free');
  assert.equal(statSync(path).mtimeMs,0);assert.equal(readFileSync(path,'utf8'),before);
});

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
  assert.equal(JSON.parse(readFileSync(join(leases.directory,'state.json'),'utf8')).slots[0].state,'quarantined');
  assert.equal(leases.reserveLocal(request('turn-2')).code, 75);
  assert.equal(leases.inspect().slots[0].state, 'quarantined');
});

test('host down returns busy promptly without reserving', async t => {
  const {leases} = await setup(t);
  const begin = performance.now();
  assert.equal(leases.reserveLocal(request(), {healthy: false}).code, 75);
  assert.equal(leases.inspect().slots[0].state, 'free');
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
