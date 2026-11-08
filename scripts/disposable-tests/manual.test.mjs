import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function controller(t) {
  const {withKernelLock}=await import('./kernel-lock.mjs');
  const {LocalLeases}=await import('./leases.mjs');
  const root=mkdtempSync(join(tmpdir(),'disposable-manual-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'state');
  await withKernelLock(directory,async()=>{new LocalLeases(join(directory,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
  return {withKernelLock,directory,root};
}

// Without admission before packaging, a busy lane downloads dependencies and waits.
test('one manual invocation owns preparation and work while a competing lane returns75', async t => {
  const {withKernelLock, directory} = await controller(t);
  let finish, entered = false;
  let ready;
  const started=new Promise(resolve=>ready=resolve);
  const first = withKernelLock(directory, async () => {entered = true;ready(); return await new Promise(resolve => {finish = resolve;});});
  await started;
  assert.equal(entered, true);
  const busy = await withKernelLock(directory, async () => assert.fail('Busy lane began packaging'));
  assert.equal(busy.code, 75);
  finish({code: 3});
  assert.equal((await first).code, 3);
  assert.equal((await withKernelLock(directory, async () => ({code: 0}))).code, 0);
});

test('an unsafe manual state directory cannot create a lock in another directory', async t => {
  const {withKernelLock, directory} = await controller(t);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  const link = join(directory, 'linked');
  symlinkSync(outside, link);
  await assert.rejects(withKernelLock(link, async () => assert.fail('Unsafe state admitted work')), /private|directory/i);
  assert.equal(existsSync(join(outside, 'mac-controller.lock')), false);
});

test('a symlink CLI path cannot silently pass without invoking the manual controller', async t => {
  const {directory} = await controller(t);
  const {spawnSync} = await import('node:child_process');
  const alias = join(directory, 'manual-alias.mjs');
  symlinkSync(new URL('./manual.mjs', import.meta.url).pathname, alias);
  const result = spawnSync(process.execPath, [alias], {encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 125, 'The CLI must execute and refuse missing arguments through a symlink too');
  assert.match(result.stderr, /Usage: manual/);
});

test('importing the manual API from standard input does not invoke or reject the CLI', async t => {
  const {spawnSync}=await import('node:child_process');
  const result=spawnSync(process.execPath,['--input-type=module','-'],{
    input:`await import(${JSON.stringify(new URL('./manual.mjs',import.meta.url).href)});`,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
});

// A long global lock serializes work; a missing slot lock lets recovery kill live work.
test('separate slot owners overlap and recovery cannot enter a live neighbor',async t=>{
 const {withAvailableSlot,reconcileManual}=await import('./manual.mjs');
 assert.equal(typeof withAvailableSlot,'function','Concurrent jobs need slot ownership before admission');
 const {withKernelLock,directory}=await controller(t);
 const {LocalLeases}=await import('./leases.mjs');
 // Use a separate explicitly bootstrapped four-slot ledger, preserving the one-slot fixture.
 const state=join(directory,'parallel');
 await withKernelLock(state,async()=>{new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:4,bootstrap:true});
  for(let slot=0;slot<4;slot++)await withKernelLock(join(state,'slot-'+slot),async()=>({code:0}),{bootstrap:true});
 },{bootstrap:true});
 const config={state,hostGeneration:'test',slots:4};let finish;const gate=new Promise(r=>finish=r);const entered=[];
 const work=({leases,slot})=>{const reserved=leases.reserveLocal({lane:'I',turn:'parallel-'+slot,snapshot:'a'.repeat(64),argv:['true']});
  assert.equal(reserved.code,0);assert.equal(reserved.lease.slot,slot);assert.equal(leases.start(reserved.lease),true);entered.push(slot);
  return gate.then(()=>{assert.equal(leases.release(reserved.lease,{resourceId:reserved.lease.resourceId,absent:true}),true);return {code:3,slot};});};
 const running=Array.from({length:4},()=>withAvailableSlot(config,work));
 try{
  const end=Date.now()+5000;while(entered.length<4 && Date.now()<end)await new Promise(r=>setTimeout(r,10));
  assert.equal(entered.length,4,'Jobs did not overlap');assert.equal(new Set(entered).size,4);
  assert.equal((await withAvailableSlot(config,()=>assert.fail('Occupied slot admitted work'))).code,75);
  const recovered=await reconcileManual({...config,transport:{destroy:async()=>assert.fail('Recovery reached a live owner')}});
  assert.equal(recovered.code,0);assert.equal(recovered.busy,4);
 }finally{finish();await Promise.allSettled(running);}
 const results=await Promise.all(running);assert.deepEqual(results.map(r=>r.code),[3,3,3,3]);
 assert.equal(new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:4}).inspect().slots.filter(s=>s.state==='free').length,4);
});

// Exit 75 can be a command's result; retrying it would repeat already executed work.
test('an admitted command returning75 is never retried on another slot',async t=>{
 const {withAvailableSlot}=await import('./manual.mjs');const {withKernelLock}=await import('./kernel-lock.mjs');const {LocalLeases}=await import('./leases.mjs');
 const root=mkdtempSync(join(tmpdir(),'disposable-exit75-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:4,bootstrap:true});
  for(let slot=0;slot<4;slot++)await withKernelLock(join(state,'slot-'+slot),async()=>({code:0}),{bootstrap:true});
 },{bootstrap:true});
 let executions=0;const result=await withAvailableSlot({state,hostGeneration:'test',slots:4},async()=>{executions++;return {code:75,cleanup:'absent'};});
 assert.equal(executions,1);assert.equal(result.code,75);assert.equal(result.cleanup,'absent');
});

// VM absence alone cannot retire the pending GitHub outcome.
test('every free slot with an unfinished CI intent refuses a new owner',async t=>{
 const {withAvailableSlot}=await import('./manual.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{LocalLeases}=await import('./leases.mjs');
 const root=mkdtempSync(join(tmpdir(),'pending-pool-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,bootstrap:true});
  for(let slot=0;slot<4;slot++)await withKernelLock(state+'/slot-'+slot,async()=>({code:0}),{bootstrap:true});
 },{bootstrap:true});
 for(let slot=0;slot<4;slot++)new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,slot}).setInvocation({repositoryId:123,nonce:String(slot+1).repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901+slot});
 assert.equal((await withAvailableSlot({state,hostGeneration:'test',slots:4},()=>assert.fail('A pending CI record was overwritten'))).code,75);
 const current=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4}).inspect();assert.deepEqual(current.slots.map(s=>s.ciInvocation.jobId),[901,902,903,904]);
});
