import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('the immutable Python entry selects the named canary controller with literal inputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'ci-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const node=join(root,'node');writeFileSync(node,'#!/usr/bin/env python3\nimport sys,json\nprint(json.dumps(sys.argv[1:]))\n',{mode:0o700});
 const entry=new URL('../../deploy/disposable-tests/mac-controller.py',import.meta.url).pathname;
 const result=spawnSync('python3',['-I','-B',entry,node,join(root,'config.json'),'canary','I','3'.repeat(40)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const args=JSON.parse(result.stdout);
 assert.equal(args[0],new URL('./ci-canary.mjs',import.meta.url).pathname);assert.deepEqual(args.slice(1),[join(root,'config.json'),'I','3'.repeat(40)]);
});
test('the immutable Python entry selects the ordinary controller with literal approved inputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const node=join(root,'node');writeFileSync(node,'#!/usr/bin/env python3\nimport sys,json\nprint(json.dumps(sys.argv[1:]))\n',{mode:0o700});
 const entry=new URL('../../deploy/disposable-tests/mac-controller.py',import.meta.url).pathname;
 const result=spawnSync('python3',['-I','-B',entry,node,join(root,'config.json'),'control','run','I','3'.repeat(40),'789'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const args=JSON.parse(result.stdout);
 assert.equal(args[0],new URL('./control.mjs',import.meta.url).pathname);
 assert.deepEqual(args.slice(1),[join(root,'config.json'),'run','I','3'.repeat(40),'789']);
});
test('automatic manual reconciliation retries orphan removal after freeing a CI guest',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {ciRequest}=await import('./ci-identity.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');let leases;
 await withKernelLock(state,async()=>{leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 const ci={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',workflowSha:'1'.repeat(40),workflowDigest:'2'.repeat(64),
 event:'workflow_dispatch',sourceSha:'3'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
 const lease=leases.reserveLocal(ciRequest('I',ci)).lease;leases.start(lease);let gone=false,registered=true;
 const api={get:async()=>({total_count:registered?1:0,runners:registered?[{id:1001,name:'dt-123-789-1-901'}]:[]}),
 delete:async()=>{assert.equal(gone,true);registered=false;}};
 const result=await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/cloud'},api,
 transport:{destroy:async()=>{gone=true;},inspect:async()=>({resourceId:lease.resourceId,absent:true})}});
 assert.equal(result.code,0);assert.equal(registered,false);assert.deepEqual(leases.inspect().orphanRunners,[]);
});
test('a hosted canary waits without holding the slot controller lock',async t=>{
 const {withCanaryController}=await import('./ci-canary.mjs');assert.equal(typeof withCanaryController,'function');
 const {withKernelLock}=await import('./kernel-lock.mjs'),{LocalLeases}=await import('./leases.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-hosted-lock-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 const invocation={nonce:'a'.repeat(32),sourceSha:'3'.repeat(40),workflowSha:'1'.repeat(40),route:'hosted',createdAt:Date.now(),runId:789,attempt:1};
 let ready,finish;const waiting=new Promise(r=>ready=r),done=new Promise(r=>finish=r);
 const job=name=>({id:name==='summary'?902:901,name,run_id:789,run_attempt:1,head_sha:invocation.workflowSha,status:'completed',conclusion:'success',labels:['ubuntu-latest'],runner_id:1001});
 const api={get:async path=>{
 if(path.includes('/commits/'))return {sha:invocation.sourceSha,commit:{tree:{sha:'4'.repeat(40)}}};
 if(path.includes('/jobs?'))return {total_count:2,jobs:[job('typecheck'),job('summary')]};
 ready();await done;return {id:789,run_attempt:1,workflow_id:456,head_sha:invocation.workflowSha,event:'workflow_dispatch',display_title:'disposable-'+invocation.nonce,status:'completed',conclusion:'success'};
 },jobLog:async()=>`Source ${invocation.sourceSha} tree ${'4'.repeat(40)}`};
 const running=withCanaryController({state,hostGeneration:'test',api,policy:{repository:'fixture/cloud',repositoryId:123,workflowId:456},admit:async()=>{
 const leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1});leases.setInvocation(invocation);return invocation;}});
 await waiting;const local=await withKernelLock(state,async()=>({code:0}));assert.equal(local.code,0,'Hosted CI must leave manual admission available');
 finish();const result=await running;assert.equal(result.code,0);assert.equal(new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1}).inspect().ciInvocation,undefined);
});
test('background recovery cancels only the recorded Waitron attempt after guest absence',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {ciRequest}=await import('./ci-identity.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'waitron-ci-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');let leases;
 await withKernelLock(state,async()=>{leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 const identity={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowSha:'1'.repeat(40),workflowDigest:'2'.repeat(64),event:'workflow_dispatch',sourceSha:'1'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'test-dashboard-1'};
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:identity.sourceSha,workflowSha:identity.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 const lease=leases.reserveLocal(ciRequest('I',identity)).lease;leases.start(lease);let gone=false,cancelled=false;
 const api={get:async path=>path.includes('/runners?')?{total_count:0,runners:[]}:
 path.includes('/jobs/')?{id:901,run_id:789,run_attempt:1,head_sha:identity.workflowSha,status:cancelled?'completed':'queued'}:
 {id:789,run_attempt:1,workflow_id:456,head_sha:identity.workflowSha,repository:{id:123},head_repository:{id:123},status:cancelled?'completed':'queued'},
 post:async path=>{assert.equal(gone,true);assert.equal(path,'/repos/fixture/waitron/actions/runs/789/cancel');cancelled=true;}};
 await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},api,transport:{destroy:async()=>{gone=true;},inspect:async()=>({resourceId:lease.resourceId,absent:true})}});
 assert.equal(cancelled,true);assert.equal(leases.inspect().slots[0].state,'free');assert.equal(leases.inspect().ciInvocation,undefined);
});

for(const attempt of [1,2])test(`a completed ordinary job retires its intent without cancelling siblings in attempt ${attempt}`,async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'completed-ci-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');let leases;
 await withKernelLock(state,async()=>{leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});let cancelled=false;
 const api={get:async path=>path.includes('/jobs/')?{id:901,run_id:789,run_attempt:1,head_sha:'1'.repeat(40),status:'completed',conclusion:'success'}:
 {id:789,run_attempt:attempt,workflow_id:456,head_sha:'1'.repeat(40),repository:{id:123},head_repository:{id:123},status:'in_progress'},post:async()=>{cancelled=true;throw new Error('Completed job was cancelled');}};
 await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},api,transport:{destroy:async()=>assert.fail('No guest is present')}});
 assert.equal(cancelled,false);assert.equal(leases.inspect().ciInvocation,undefined);
});

test('background recovery switches a lost ordinary typecheck to hosted and retries the same run',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'ordinary-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');let leases;
 await withKernelLock(state,async()=>{leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 let mode='server',cancelled=false,retried=false;
 const api={get:async path=>path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
 {id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:'1'.repeat(40),status:cancelled?'completed':'queued'}:
 {id:789,run_attempt:1,workflow_id:456,head_sha:'1'.repeat(40),repository:{id:123},head_repository:{id:123},event:'pull_request',status:cancelled?'completed':'in_progress'},
 patch:async(path,body)=>{mode=body.value;},post:async path=>{assert.equal(mode,'hosted');
 if(path.endsWith('/cancel'))cancelled=true;else{assert.ok(path.endsWith('/rerun'));assert.equal(cancelled,true);retried=true;}}};
 await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},api,
 transport:{destroy:async()=>assert.fail('No guest remains')}});
 assert.equal(retried,true);assert.equal(leases.inspect().ciInvocation,undefined);
});
