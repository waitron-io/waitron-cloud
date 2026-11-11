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
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'admitted'});
 let mode='server',cancelled=false,retried=false;
 const api={get:async path=>path.includes('/pulls/')?{number:12,state:'open',head:{sha:'1'.repeat(40),repo:{id:123}},base:{repo:{id:123}}}:path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
 {id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:'1'.repeat(40),status:cancelled?'completed':'queued'}:
 {id:789,run_attempt:1,workflow_id:456,head_sha:'1'.repeat(40),repository:{id:123},head_repository:{id:123},event:'pull_request',pull_requests:[{number:12}],status:cancelled?'completed':'in_progress'},
 patch:async(path,body)=>{mode=body.value;},post:async path=>{assert.equal(mode,'hosted');
 if(path.endsWith('/cancel'))cancelled=true;else{assert.ok(path.endsWith('/rerun'));assert.equal(cancelled,true);retried=true;}}};
 await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},api,
 transport:{destroy:async()=>assert.fail('No guest remains')}});
 assert.equal(retried,true);assert.equal(leases.inspect().ciInvocation,undefined);
});

// A status or mode command must read the whole pool, including a free slot's pending intent.
test('CI control reads configured capacity and refuses a mode change with any pending slot',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {GithubApp}=await import('./github-app.mjs'),{main}=await import('./control.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-pool-control-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:4,bootstrap:true});},{bootstrap:true});
 const config=join(root,'config.json');writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:4,state,host:'fixture.invalid',hostGeneration:'test',recipe:'/opt/waitron-disposable-fixture',repository:root,
 ci:{repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:'a'.repeat(64),appEnv:join(root,'app.env'),appKey:join(root,'app.pem')}}));
 const original=GithubApp.prototype.get;GithubApp.prototype.get=async path=>({value:path.endsWith('_HEAD')?'1'.repeat(40):'hosted'});t.after(()=>{GithubApp.prototype.get=original;});
 const status=await main([config,'status']);assert.equal(status.state.slots.length,4);assert.equal(status.mode,'hosted');
 const slot=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:4,slot:3});
 slot.setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 await assert.rejects(main([config,'mode','hosted','--reason','fixture']),/CI work must finish/);
 assert.equal(slot.inspect().ciInvocation.jobId,901);
});

// A busy API-recovery lock is deferred work, not evidence of a live guest owner.
test('pool recovery distinguishes pending CI cleanup from live slot owners',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-recovery-pending-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,bootstrap:true});
  for(let slot=0;slot<4;slot++)await withKernelLock(state+'/slot-'+slot,async()=>({code:0}),{bootstrap:true});
 },{bootstrap:true});
 new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,slot:2}).setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 const api={get:async path=>path.includes('/jobs/')?{id:901,run_id:789,run_attempt:1,head_sha:'1'.repeat(40),status:'completed',conclusion:'success'}:
 {id:789,run_attempt:1,workflow_id:456,head_sha:'1'.repeat(40),repository:{id:123},head_repository:{id:123},status:'in_progress'}};
 const config={state,hostGeneration:'test',slots:4,ci:{repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},api,transport:{destroy:async()=>assert.fail('No guest remains')}};
 let ready,finish;const held=new Promise(r=>ready=r),gate=new Promise(r=>finish=r);const locked=withKernelLock(state,async()=>{ready();await gate;return {code:0};});
 try{await held;const result=await reconcileManual(config);assert.equal(result.cleanup,'pending');assert.equal(result.busy,0);assert.equal(result.pending,1);}
 finally{finish();await locked;}
 const complete=await reconcileManual(config);assert.equal(complete.cleanup,'absent');assert.equal(complete.pending,0);
});

for(const stage of [undefined,'admitted','cancel-requested'])test(`automatic recovery clears ${stage} intent without moving its run`,async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'no-move-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,bootstrap:true});},{bootstrap:true});
 const leases=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:4,slot:0});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:'1'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,...(stage?{ordinaryStage:stage}:{})});
 await withKernelLock(state+'/slot-0',async()=>({code:0}),{bootstrap:true});
 const writes=[];let cancelled=false;const api={get:async path=>path.includes('/jobs/')?{id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:'1'.repeat(40),status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:{id:789,run_attempt:1,workflow_id:456,path:'.github/workflows/ci.yml',event:'push',head_sha:'1'.repeat(40),repository:{id:123},head_repository:{id:123},status:cancelled?'completed':'in_progress'},post:async path=>{writes.push(path);cancelled=true;},patch:async path=>writes.push(path)};
 await reconcileManual({state,hostGeneration:'test',slots:4,slot:0,api,ci:{repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml'},transport:{destroy:async()=>assert.fail('No guest remains')}});
 assert.deepEqual(writes,[]);assert.equal(leases.inspect().ciInvocation,undefined);assert.equal(leases.inspect().slots[0].state,'free');
});

test('all three CLI guards activate request logging and flush on refusal',t=>{
 for(const entry of ['manual','control','ci-canary']){
  const result=spawnSync(process.execPath,[new URL('./'+entry+'.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,125,result.stderr);
  const rows=result.stderr.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  assert.equal(rows.length,1,entry+': '+result.stderr);assert.equal(rows[0].event,'github-request-counts');
  assert.equal(rows[0].final,true);assert.equal(rows[0].requests,0);
  assert.equal(rows[0].role,entry==='ci-canary'?'canary':entry==='control'?'operator':'controller');
 }
 const worker=spawnSync(process.execPath,[new URL('./control.mjs',import.meta.url).pathname,'/missing','job'],{encoding:'utf8',timeout:10000});
 assert.equal(worker.status,125);assert.equal(JSON.parse(worker.stderr.split('\n').find(line=>line.startsWith('{'))).role,'worker');
 for(const [entry,args,role] of [['manual',['/missing','--once'],'controller'],['manual',['/missing','--bootstrap'],'operator'],['manual',['/missing','I','/tmp','--','true'],'lane'],
  ['manual',['/missing','--bundle','I'],'lane'],['control',['/missing','run','I'],'lane'],['control',['/missing','status'],'operator']]){
  const result=spawnSync(process.execPath,[new URL('./'+entry+'.mjs',import.meta.url).pathname,...args],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,125);assert.equal(JSON.parse(result.stderr.split('\n').find(line=>line.startsWith('{'))).role,role);
 }
});

test('the worker reads only explicit bounded shared admission input before using capacity',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-shared-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{const leases=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:2,bootstrap:true});for(let slot=0;slot<2;slot++)leases.reserveLocal({lane:'I',turn:'occupied-'+slot,snapshot:'a'.repeat(64),argv:['true']});},{bootstrap:true});
 for(let slot=0;slot<2;slot++)await withKernelLock(state+'/slot-'+slot,async()=>{}, {bootstrap:true});
 const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:'a'.repeat(64),appEnv:join(root,'missing.env'),appKey:join(root,'missing.pem')};
 const path=join(root,'config.json');writeFileSync(path,JSON.stringify({version:2,mode:'manual-slots',slots:2,state,host:'fixture.invalid',hostGeneration:'test',recipe:'/opt/waitron-disposable-fixture',repository:root,ci:policy}));
 const ci={repositoryId:123,workflowId:456,workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,workflowSha:'1'.repeat(40),sourceSha:'1'.repeat(40),sourceTree:'2'.repeat(40),event:'push',runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
 for(const [label,input,code,message] of [
  ['fresh',JSON.stringify({ci,checkedAt:Date.now()}),75,null],
  ['future',JSON.stringify({ci,checkedAt:Date.now()+3600000}),125,/admission timestamp/],
  ['identity',JSON.stringify({ci:{...ci,jobId:902},checkedAt:Date.now()}),125,/admission identity/],
  ['oversized',' '.repeat(4097),125,/admission input.*large/],
 ]){
  const result=spawnSync(process.execPath,[new URL('./control.mjs',import.meta.url).pathname,path,'job','789','901','--admission'],{input,encoding:'utf8',timeout:10000});
  assert.equal(result.status,code,label+': '+result.stderr);if(message)assert.match(result.stderr,message,label);
  const counts=result.stderr.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));assert.equal(counts.at(-1).requests,0,label);
 }
});
