import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLeases} from './leases.mjs';

async function fixture(t, changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'disposable-local-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const leases = new LocalLeases(directory, {hostGeneration: 'bridge-1', slots: 1});
  const request = {lane: 'I', turn: 'local-1', snapshot: 'a'.repeat(64), argv: ['node', '-e', 'process.exit(3)']};
  const occupied = new Set();
  const transport = {
    async healthy() { return true; },
    async transfer(lease) { occupied.add(lease.resourceId); },
    async prepare() {},
    async execute() { return 3; },
    async destroy(lease) { occupied.delete(lease.resourceId); },
    async inspect(lease) { return {resourceId: lease.resourceId, absent: !occupied.has(lease.resourceId)}; },
    ...changes,
  };
  const {runLocal} = await import('./local.mjs');
  return {leases, request, occupied, transport, runLocal};
}

// Releasing on command completion rather than observed absence would admit a successor too early.
test('a local turn preserves exit3 only after destruction and independent absence readback', async t => {
  const f = await fixture(t);
  const result = await f.runLocal(f);
  assert.equal(result.code, 3);
  assert.equal(result.cleanup, 'absent');
  assert.equal(f.occupied.size, 0);
  assert.equal(f.leases.inspect().slots[0].state, 'free');
  assert.equal((await f.runLocal(f)).code, 75, 'a completed turn cannot run twice');
});

for (const stage of ['transfer', 'prepare', 'execute']) {
  test(`a failed ${stage} cleans its exact lease before another turn can start`, async t => {
    const f = await fixture(t, {[stage]: async () => { throw new Error('controlled failure'); }});
    const result = await f.runLocal(f);
    assert.equal(result.code, 125);
    assert.equal(result.cleanup, 'absent');
    assert.equal(f.occupied.size, 0);
    assert.equal(f.leases.inspect().slots[0].state, 'free');
    assert.equal(f.leases.reserveLocal({...f.request, turn: 'next'}).code, 0);
  });
}

for (const stage of ['transfer', 'prepare', 'execute']) {
  test(`cancellation during ${stage} keeps cleanup independent of the cancelled command`, async t => {
    const cancellation = new AbortController();
    const f = await fixture(t, {[stage]: async (_lease, {signal}) => {
      cancellation.abort();
      await delay(5000, undefined, {signal});
    }});
    const result = await f.runLocal({...f, signal: cancellation.signal});
    assert.equal(result.code, 143);
    assert.equal(result.cleanup, 'absent');
    assert.equal(f.leases.inspect().slots[0].state, 'free');
  });
}

test('unknown destruction, unrelated absence and broken readback quarantine the occupied slot', async t => {
  for (const changes of [
    {destroy: async () => { throw new Error('host disconnected'); }},
    {inspect: async () => ({resourceId: 'dt-someone-else-0-1', absent: true})},
    {inspect: async () => { throw new Error('host disconnected'); }},
  ]) {
    const f = await fixture(t, changes);
    const result = await f.runLocal(f);
    assert.equal(result.code, 125);
    assert.equal(result.cleanup, 'quarantined');
    assert.equal(f.leases.inspect().slots[0].state, 'quarantined');
    assert.equal(f.leases.reserveLocal({...f.request, turn: 'next'}).code, 75);
  }
});

test('busy or unhealthy admission cannot create or destroy another turn', async t => {
  const f = await fixture(t);
  const old = f.leases.reserveLocal(f.request).lease;
  f.occupied.add(old.resourceId);
  assert.equal((await f.runLocal(f)).code, 75);
  assert.equal((await f.runLocal({...f, request: {...f.request, turn: 'next'}})).code, 75);
  assert.equal(f.occupied.has(old.resourceId), true);
  const down = await fixture(t, {healthy: async () => false});
  assert.equal((await down.runLocal(down)).code, 75);
  assert.equal(down.leases.inspect().slots[0].state, 'free');
});

// A whole-turn deadline must cover preparation as well as candidate execution.
test('preparation cannot outlive the lease deadline', async t => {
  const f = await fixture(t, {prepare: async (_lease, {signal}) => delay(5000, undefined, {signal})});
  const started = performance.now();
  const result = await f.runLocal({...f, durationMs: 150});
  assert.equal(result.code, 124);
  assert.equal(result.cleanup, 'absent');
  assert.ok(performance.now() - started < 1500);
});

test('cancellation during admission is143 even when the health reader throws', async t => {
  const cancellation = new AbortController();
  const f = await fixture(t, {healthy: async () => {cancellation.abort(); throw new Error('reader cancelled');}});
  const result = await f.runLocal({...f, signal: cancellation.signal});
  assert.equal(result.code, 143);
  assert.equal(f.leases.inspect().slots[0].state, 'free');
});

test('an already cancelled admission never contacts the host', async t => {
  let contacted=false;
  const f=await fixture(t,{healthy:async()=>{contacted=true;return true;}});
  const result=await f.runLocal({...f,signal:AbortSignal.abort()});
  assert.equal(result.code,143);
  assert.equal(contacted,false);
  assert.equal(f.leases.inspect().slots[0].state,'free');
});
