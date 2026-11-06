import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalLeases} from './leases.mjs';
import * as manual from './manual.mjs';
function fixture(t){
 assert.equal(typeof manual.recoverManual,'function','The manual operator needs exact-lease recovery');
 const state=mkdtempSync(join(tmpdir(),'disposable-recovery-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
 const leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'recovery',slots:1});
 const lease=leases.reserveLocal({lane:'I',turn:'failed',snapshot:'a'.repeat(64),argv:['false']}).lease;leases.start(lease);
 let touched=false;
 const transport={healthy:async()=>assert.fail('Recovery cannot health-refuse the guest it must destroy'),destroy:async()=>{touched=true;},inspect:async()=>({resourceId:lease.resourceId,absent:true})};
 const args={state,leases,transport,resourceId:lease.resourceId,signal:AbortSignal.timeout(2000)};
 return {state,leases,lease,transport,args,touched:()=>touched};
}
function owner(f,pid){mkdirSync(join(f.state,'manual.lock'),{mode:0o700});writeFileSync(join(f.state,'manual.lock/owner.json'),JSON.stringify({version:1,pid,nonce:'11111111-1111-4111-8111-111111111111'}),{mode:0o600});}
function deadPid(){const r=spawnSync(process.execPath,['-e','']);assert.equal(r.status,0);return r.pid;}

test('manual recovery frees only the recorded resource after its owner died',async t=>{
 const f=fixture(t);owner(f,deadPid());const result=await manual.recoverManual(f.args);
 assert.equal(result.code,0);assert.equal(result.cleanup,'absent');assert.equal(f.leases.inspect().slots[0].state,'free');
 assert.equal(existsSync(join(f.state,'manual.lock')),false);assert.equal(existsSync(join(f.state,'recovery.lock')),false);
});
test('a quarantined lease without an ordinary gate remains recoverable',async t=>{
 const f=fixture(t);f.leases.release(f.lease,undefined);
 assert.equal((await manual.recoverManual(f.args)).code,0);assert.equal(f.leases.inspect().slots[0].state,'free');
 assert.equal(existsSync(join(f.state,'manual.lock')),false);
});
test('a live or unknown owner is refused before touching host resources',async t=>{
 for(const known of [true,false]){
  const f=fixture(t);if(known)owner(f,process.pid);else mkdirSync(join(f.state,'manual.lock'));
  const result=await manual.recoverManual(f.args);assert.equal(result.code,75);assert.equal(f.touched(),false);
  assert.equal(f.leases.inspect().slots[0].state,'running');assert.equal(existsSync(join(f.state,'manual.lock')),true);
 }
});
test('a wrong recovery resource keeps the old gate and lease while releasing only its recovery guard',async t=>{
 const f=fixture(t);owner(f,deadPid());const before=readFileSync(join(f.state,'manual.lock/owner.json'),'utf8');
 await assert.rejects(manual.recoverManual({...f.args,resourceId:'dt-peer-0-1'}),/recorded|matching|lease/i);
 assert.equal(f.touched(),false);assert.equal(readFileSync(join(f.state,'manual.lock/owner.json'),'utf8'),before);assert.equal(existsSync(join(f.state,'recovery.lock')),false);
});
test('a stuck ledger lock is unknown ownership rather than an empty slot',async t=>{
 const f=fixture(t);owner(f,deadPid());mkdirSync(join(f.state,'ledger/lock'));
 await assert.rejects(manual.recoverManual(f.args),/ledger|unknown|locked/i);assert.equal(f.touched(),false);assert.equal(existsSync(join(f.state,'manual.lock')),true);assert.equal(existsSync(join(f.state,'recovery.lock')),false);
});
test('failed independent absence keeps the lease and ordinary gate closed',async t=>{
 const f=fixture(t);owner(f,deadPid());f.transport.inspect=async()=>({resourceId:f.lease.resourceId,absent:false});
 await assert.rejects(manual.recoverManual(f.args),/absence|absent|cleanup/i);assert.notEqual(f.leases.inspect().slots[0].state,'free');assert.equal(existsSync(join(f.state,'manual.lock')),true);assert.equal(existsSync(join(f.state,'recovery.lock')),false);
});
test('a recovery guard closes normal admission before preparation',async t=>{
 const state=mkdtempSync(join(tmpdir(),'disposable-recovery-busy-'));t.after(()=>rmSync(state,{recursive:true,force:true}));mkdirSync(join(state,'recovery.lock'));
 let entered=false;const result=await manual.withManualSlot(state,async()=>{entered=true;return {code:0};});
 assert.equal(result.code,75);assert.equal(entered,false);assert.equal(existsSync(join(state,'recovery.lock')),true);
});

test('a recovery starting between the first observation and gate creation prevents work',async t=>{
 const fs=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');
 const state=mkdtempSync(join(tmpdir(),'disposable-recovery-race-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
 const original=fs.default.existsSync;let observed=false,entered=false;
 fs.default.existsSync=path=>{
  const answer=original(path);
  if(path===join(state,'recovery.lock')&&!observed){observed=true;mkdirSync(path,{mode:0o700});}
  return answer;
 };
 syncBuiltinESMExports();
 try {const result=await manual.withManualSlot(state,async()=>{entered=true;return {code:0};});assert.equal(result.code,75);assert.equal(entered,false);}
 finally {fs.default.existsSync=original;syncBuiltinESMExports();}
 assert.equal(existsSync(join(state,'manual.lock')),false);
});
