import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalLeases} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {reconcileManual} from './manual.mjs';

async function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'disposable-recovery-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=join(root,'state');
  await withKernelLock(state,async()=>({code:0}),{bootstrap:true});
  const leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'mac',slots:1,bootstrap:true});
  const lease=leases.reserveLocal({lane:'I',turn:'interrupted',snapshot:'a'.repeat(64),argv:['false']}).lease;
  leases.start(lease);
  const resource=join(root,lease.resourceId);writeFileSync(resource,'owned guest');
  const transport={
    healthy:async()=>assert.fail('Recovery must not health-refuse its recorded guest'),
    destroy:async(actual,{signal})=>{signal.throwIfAborted();assert.deepEqual(actual,lease);rmSync(resource);},
    inspect:async actual=>({resourceId:actual.resourceId,absent:!existsSync(resource)})
  };
  return {state,leases,lease,resource,transport};
}

test('automatic recovery destroys and independently inspects the recorded turn without replay',async t=>{
  const f=await fixture(t);const result=await reconcileManual(f);
  assert.equal(result.code,0);assert.equal(result.cleanup,'absent');assert.equal(result.resourceId,f.lease.resourceId);
  assert.equal(existsSync(f.resource),false);assert.equal(f.leases.inspect().slots[0].state,'free');
  assert.equal(f.leases.reserveLocal({lane:'I',turn:'interrupted',snapshot:'a'.repeat(64),argv:['false']}).code,75);
});

test('a live kernel owner prevents recovery before any guest operation',async t=>{
  const f=await fixture(t);
  await withKernelLock(f.state,async()=>{
    assert.equal((await reconcileManual(f)).code,75);
    assert.equal(existsSync(f.resource),true);assert.equal(f.leases.inspect().slots[0].state,'running');
    return {code:0};
  });
});

for(const gate of ['manual.lock','recovery.lock','ledger/lock'])test(`legacy ${gate} refuses without deleting it or touching the guest`,async t=>{
  const f=await fixture(t);mkdirSync(join(f.state,gate),{mode:0o700});
  await assert.rejects(reconcileManual(f),/legacy/i);
  assert.equal(existsSync(join(f.state,gate)),true);assert.equal(existsSync(f.resource),true);
  assert.equal(f.leases.inspect().slots[0].state,'running');
});

test('failed or foreign independent absence quarantines capacity instead of freeing it',async t=>{
  for(const observed of [{absent:false},{resourceId:'dt-peer-0-1',absent:true}]){
    const f=await fixture(t);f.transport.inspect=async()=>({resourceId:f.lease.resourceId,...observed});
    await assert.rejects(reconcileManual(f),/absence|absent/i);
    assert.equal(f.leases.inspect().slots[0].state,'quarantined');
    assert.equal(f.leases.reserveLocal({lane:'H',turn:'successor',snapshot:'b'.repeat(64),argv:['false']}).code,75);
  }
});

test('a quarantined exact lease remains recoverable without a health check',async t=>{
  const f=await fixture(t);assert.equal(f.leases.release(f.lease,undefined),false);
  assert.equal((await reconcileManual(f)).code,0);assert.equal(f.leases.inspect().slots[0].state,'free');
  assert.equal(existsSync(f.resource),false);
});

test('a deleted committed ledger never becomes an empty slot during recovery',async t=>{
  const f=await fixture(t);rmSync(join(f.state,'ledger/state.json'));
  await assert.rejects(reconcileManual(f),/ledger.*missing|missing.*ledger/i);
  assert.equal(existsSync(f.resource),true);assert.equal(existsSync(join(f.state,'ledger/state.json')),false);
});

test('recovery of a free slot never contacts the host',async t=>{
  const f=await fixture(t);rmSync(f.resource);f.leases.release(f.lease,{resourceId:f.lease.resourceId,absent:true});
  f.transport.destroy=async()=>assert.fail('Free slot contacted host');
  assert.equal((await reconcileManual(f)).code,0);
});
