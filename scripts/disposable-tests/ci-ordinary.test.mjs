import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalLeases} from './leases.mjs';
import {runInNewContext} from 'node:vm';
import * as controller from './ci-canary.mjs';

const head='1'.repeat(40),workflow='reviewed ordinary workflow';
const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',
 workflowDigest:createHash('sha256').update(workflow).digest('hex')};
function evidence(){return {repository:{id:123,full_name:'fixture/cloud'},workflow,
 run:{id:789,run_attempt:1,repository:{id:123},head_repository:{id:123},head_sha:head,workflow_id:456,
 path:policy.workflowPath,event:'pull_request',status:'in_progress',pull_requests:[{number:12}]},
 pull:{number:12,state:'open',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}},
 job:{id:901,run_id:789,run_attempt:1,head_sha:head,name:'typecheck',status:'queued',
 labels:['self-hosted','dt-123-789-1-typecheck'],runner_id:null},
 source:{sha:head,commit:{tree:{sha:'4'.repeat(40)}}}};}
function pending(t,ordinaryStage='admitted'){
 const root=mkdtempSync(join(tmpdir(),'ordinary-intent-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});
 leases.setInvocation({repositoryId:123,nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage});
 return leases;
}

test('ordinary admission binds an approved open same-repository PR head, workflow and concrete typecheck job',()=>{
 assert.equal(typeof controller.admitOrdinary,'function');
 const ci=controller.admitOrdinary(policy,head,evidence());
 assert.equal(ci.jobId,901);assert.equal(ci.event,'pull_request');assert.equal(ci.sourceSha,head);assert.equal(ci.sourceTree,'4'.repeat(40));
});
test('ordinary admission refuses foreign, unapproved, stale, changed-workflow and assigned work',()=>{
 assert.equal(typeof controller.admitOrdinary,'function');
 for(const mutate of [e=>e.repository.id++,e=>e.repository.full_name='foreign/repo',e=>e.run.repository.id++,
 e=>e.run.head_repository.id++,e=>e.run.head_sha='5'.repeat(40),e=>e.run.workflow_id++,e=>e.run.path='other',
 e=>e.run.event='pull_request_target',e=>e.run.status='completed',e=>e.run.run_attempt++,e=>e.run.pull_requests=[],
 e=>e.pull.state='closed',e=>e.pull.number++,e=>e.pull.head.sha='5'.repeat(40),e=>e.pull.head.repo.id++,e=>e.pull.base.repo.id++,
 e=>e.job.id=0,e=>e.job.run_id++,e=>e.job.run_attempt++,e=>e.job.head_sha='5'.repeat(40),e=>e.job.name='summary',
 e=>e.job.runner_id=42,e=>e.job.status='in_progress',e=>e.job.labels=['self-hosted','foreign'],
 e=>e.workflow+='changed',e=>e.source.sha='5'.repeat(40)]){
  const value=evidence();mutate(value);assert.throws(()=>controller.admitOrdinary(policy,head,value));
 }
});

test('mode writes use the repository variable and require matching readback; absent or invalid selects hosted',async()=>{
 assert.equal(typeof controller.routingMode,'function');assert.equal(typeof controller.setRoutingMode,'function');
 let value,posts=[];const api={get:async()=>{if(value===undefined)throw Object.assign(new Error('missing'),{status:404});return {name:'DISPOSABLE_TESTS_MODE',value};},
 post:async(path,body)=>{posts.push([path,body]);value=body.value;},
 patch:async(path,body)=>{posts.push([path,body]);value=body.value;}};
 assert.equal(await controller.routingMode({api,policy}),'hosted');
 await controller.setRoutingMode({api,policy,mode:'server'});
 assert.deepEqual(posts[0],['/repos/fixture/cloud/actions/variables',{name:'DISPOSABLE_TESTS_MODE',value:'server'}]);
 assert.equal(await controller.routingMode({api,policy}),'server');
 value='SERVER';assert.equal(await controller.routingMode({api,policy}),'server');
 value='invalid';assert.equal(await controller.routingMode({api,policy}),'hosted');
 api.patch=async()=>{};await assert.rejects(controller.setRoutingMode({api,policy,mode:'hosted'}),/readback/i);
});

test('ordinary fallback switches hosted before cancelling and retries only its unchanged completed attempt',async t=>{
 assert.equal(typeof controller.fallbackOrdinary,'function');let mode='server',cancelled=false,retried=false;
 const leases=pending(t);
 const ci={...evidence().run,repositoryId:123,workflowId:456,workflowSha:head,runId:789,attempt:1,jobId:901};
 const api={get:async path=>path.endsWith('/DISPOSABLE_TESTS_HEAD')?{value:head}:path.includes('/pulls/')?evidence().pull:path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
 {...evidence().job,status:cancelled?'completed':'queued'}:{...evidence().run,status:cancelled?'completed':'in_progress'},
 patch:async(path,body)=>{assert.equal(path,'/repos/fixture/cloud/actions/variables/DISPOSABLE_TESTS_MODE');mode=body.value;},
 post:async path=>{assert.equal(mode,'hosted');assert.equal(leases.inspect().ciInvocation.ordinaryStage,'cancel-requested');if(path.endsWith('/cancel'))cancelled=true;
 else{assert.equal(path,'/repos/fixture/cloud/actions/runs/789/rerun');assert.equal(cancelled,true);retried=true;}}};
 await controller.fallbackOrdinary({api,policy,ci,leases});assert.equal(retried,true);
});
test('ordinary fallback refuses newer attempts and preserves completed jobs and siblings',async()=>{
 assert.equal(typeof controller.fallbackOrdinary,'function');
 for(const completed of [false,true]){let posts=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,runId:789,attempt:1,jobId:901};
 const api={get:async path=>path.includes('/jobs/')?{...evidence().job,status:completed?'completed':'queued'}:
 {...evidence().run,run_attempt:2},post:async()=>{posts++;},patch:async()=>{posts++;}};
 if(completed)await controller.fallbackOrdinary({api,policy,ci});
 else await assert.rejects(controller.fallbackOrdinary({api,policy,ci}),/attempt/i);
 assert.equal(posts,0);
 }
});

test('the real typecheck routing expression selects only first-attempt same-repository server-mode PRs',()=>{
 const yaml=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const route=yaml.match(/^  typecheck:\n[\s\S]*?^    runs-on: (.+)$/m)[1];
 for(const [mode,event,attempt,headRepository,want,full=false,selected=head] of [
  ['server','pull_request',1,123,['self-hosted','dt-123-789-1-typecheck']],
  ['server','pull_request',1,123,'ubuntu-latest',true],
  ['server','pull_request',1,123,'ubuntu-latest',false,'5'.repeat(40)],
  ['server','pull_request',1,123,'ubuntu-latest',false,''],
  ['hosted','pull_request',1,123,'ubuntu-latest'],[undefined,'pull_request',1,123,'ubuntu-latest'],
  ['bad','pull_request',1,123,'ubuntu-latest'],['server','push',1,123,'ubuntu-latest'],
  ['server','pull_request',2,123,'ubuntu-latest'],['server','pull_request',1,999,'ubuntu-latest']]){
  const context={inputs:{full},vars:{DISPOSABLE_TESTS_MODE:mode,DISPOSABLE_TESTS_HEAD:selected},github:{event_name:event,run_attempt:attempt,repository_id:123,run_id:789,
   event:{repository:{id:123},pull_request:{head:{sha:head,repo:{id:headRepository}}}}},fromJSON:JSON.parse,
   format:(template,...values)=>template.replace(/\{(\d+)\}/g,(_,n)=>values[Number(n)])};
  const actual=route.startsWith('${{')?runInNewContext(route.slice(3,-2),context):route;
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),want);
 }
});

test('ordinary queue polling checks the reviewed workflow, contributor policy and approved current PR head',async()=>{
 assert.equal(typeof controller.findOrdinary,'function');
 let paths=[];const value=evidence();
 const api={get:async path=>{paths.push(path);
  if(path.endsWith('/fork-pr-contributor-approval'))return {approval_policy:'all_external_contributors'};
  if(path.endsWith('/runs/789'))return value.run;
  if(path.includes('/jobs?'))return {total_count:1,jobs:[value.job]};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(value.workflow).toString('base64')};
  if(path.includes('/commits/'))return value.source;
  if(path.endsWith('/pulls/12'))return value.pull;
  assert.equal(path,'/repos/fixture/cloud');return value.repository;
 }};
 assert.equal((await controller.findOrdinary({api,policy,approvedHead:head,runId:789})).jobId,901);
 assert.ok(paths.includes('/repos/fixture/cloud/contents/.github/workflows/ci.yml?ref='+head));
 value.pull.head.sha='5'.repeat(40);
 await assert.rejects(controller.findOrdinary({api,policy,approvedHead:head,runId:789}),/head/i);
 value.pull.head.sha=head;value.run.id=999;
 await assert.rejects(controller.findOrdinary({api,policy,approvedHead:head,runId:789}),/run/i);
});

test('a down server retains concrete intent until hosted retry, without preparing a guest',async t=>{
 assert.equal(typeof controller.executeOrdinary,'function');
 const root=mkdtempSync(join(tmpdir(),'ordinary-down-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});
 const ci=controller.admitOrdinary(policy,head,evidence());let mode='server',cancelled=false,retried=false;
 const api={get:async path=>path.endsWith('/DISPOSABLE_TESTS_HEAD')?{value:head}:path.includes('/pulls/')?evidence().pull:path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
 {...evidence().job,status:cancelled?'completed':'queued'}:{...evidence().run,status:cancelled?'completed':'in_progress'},
 patch:async(path,body)=>{assert.equal(leases.inspect().ciInvocation.jobId,901);mode=body.value;},
 post:async path=>{assert.equal(leases.inspect().ciInvocation.runId,789);
 if(path.endsWith('/cancel'))cancelled=true;else {assert.ok(path.endsWith('/rerun'));retried=true;}}};
 const result=await controller.executeOrdinary({api,policy,leases,ci,lane:'I',transport:{healthy:async()=>false,
 prepare:async()=>assert.fail('An unavailable server must not prepare a guest')}});
 assert.equal(result.retry,true);assert.equal(retried,true);assert.equal(leases.inspect().ciInvocation,undefined);
 assert.equal(leases.inspect().slots[0].state,'free');
});

test('polling for a not-yet-created typecheck leaves the manual slot lock available',async t=>{
 const {withOrdinaryController}=await import('./control.mjs');assert.equal(typeof withOrdinaryController,'function');
 const {withKernelLock}=await import('./kernel-lock.mjs');
 const root=mkdtempSync(join(tmpdir(),'ordinary-poll-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 await withKernelLock(state,async()=>{new LocalLeases(join(state,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 let unlocked=false;
 const api={get:async path=>path.endsWith('/DISPOSABLE_TESTS_HEAD')?{value:head}:path.includes('/variables/')?{value:'server'}:path.endsWith('/fork-pr-contributor-approval')?
 {approval_policy:'all_external_contributors'}:path.includes('/jobs?')?{total_count:0,jobs:[]}:evidence().run};
 await assert.rejects(withOrdinaryController({state,hostGeneration:'fixture',api,policy,approvedHead:head,runId:789,lane:'I',
  wait:async()=>{unlocked=(await withKernelLock(state,async()=>({code:0}))).code===0;throw new Error('stop fixture poll');}}),/stop fixture poll/);
 assert.equal(unlocked,true);
});

test('fallback does not cancel or retry an old head after its PR advances',async t=>{
 let writes=0,mode='server',cancelled=false;const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 const api={get:async path=>path.includes('/pulls/')?{...evidence().pull,head:{sha:'5'.repeat(40),repo:{id:123}}}:
  path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?{...evidence().job,status:cancelled?'completed':'queued'}:
  {...evidence().run,status:cancelled?'completed':'in_progress'},post:async path=>{writes++;if(path.endsWith('/cancel'))cancelled=true;},patch:async(path,body)=>{writes++;mode=body.value;}};
 await assert.rejects(controller.fallbackOrdinary({api,policy,ci,leases:pending(t)}),/PR head/i);assert.equal(writes,0);
});

test('a crash after owned cancellation resumes the same-head retry without cancelling again',async t=>{
 const leases=pending(t,'cancel-requested'),ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 let writes=[];
 const api={get:async path=>path.includes('/pulls/')?evidence().pull:path.includes('/variables/')?{value:'hosted'}:
  path.includes('/jobs/')?{...evidence().job,status:'completed',conclusion:'cancelled'}:
  {...evidence().run,status:'completed',conclusion:'cancelled'},
  patch:async()=>{},post:async path=>writes.push(path)};
 const result=await controller.fallbackOrdinary({api,policy,ci,leases});
 assert.equal(result.retry,true);assert.deepEqual(writes,['/repos/fixture/cloud/actions/runs/789/rerun']);
});

test('server selection stores and reads back only a full approved head',async()=>{
 assert.equal(typeof controller.setRoutingHead,'function');let value='';
 const api={get:async()=>({value}),patch:async(path,body)=>{assert.equal(path,'/repos/fixture/cloud/actions/variables/DISPOSABLE_TESTS_HEAD');value=body.value;}};
 await controller.setRoutingHead({api,policy,approvedHead:head});assert.equal(value,head);
 await assert.rejects(controller.setRoutingHead({api,policy,approvedHead:'short'}));
 api.patch=async()=>{};await assert.rejects(controller.setRoutingHead({api,policy,approvedHead:'5'.repeat(40)}),/readback/i);
});

test('ordinary execution refuses an unselected head before recording or preparing a guest',async t=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-selection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});
 const api={get:async path=>({value:path.endsWith('/DISPOSABLE_TESTS_HEAD')?'5'.repeat(40):'server'})};
 await assert.rejects(controller.executeOrdinary({api,policy,leases,ci:controller.admitOrdinary(policy,head,evidence()),lane:'I',
 transport:{healthy:async()=>assert.fail('No host work for an unselected head')}}),/selected.*head|head.*selected/i);
 assert.equal(leases.inspect().ciInvocation,undefined);
});

test('hosted retry qualification requires its exact next attempt, checkout, hosted typecheck and summary',async()=>{
 assert.equal(typeof controller.qualifyOrdinaryHosted,'function');
 const retry={runId:789,previousAttempt:1,sourceSha:head};
 const job={...evidence().job,run_attempt:2,status:'completed',conclusion:'success',labels:['ubuntu-latest'],runner_id:1001};
 const summary={...job,id:902,name:'summary'};let log='[command]/usr/bin/git log -1 --format=%H\n'+head;
 const api={get:async path=>path.includes('/commits/')?evidence().source:path.includes('/jobs?')?{total_count:2,jobs:[job,summary]}:
 {...evidence().run,run_attempt:2,status:'completed',conclusion:'success'},jobLog:async()=>log};
 assert.equal((await controller.qualifyOrdinaryHosted({api,policy,retry})).sourceTree,'4'.repeat(40));
 job.labels=['self-hosted'];await assert.rejects(controller.qualifyOrdinaryHosted({api,policy,retry}),/hosted/i);job.labels=['ubuntu-latest'];
 summary.conclusion='failure';await assert.rejects(controller.qualifyOrdinaryHosted({api,policy,retry}),/summary/i);summary.conclusion='success';
 log='[command]/usr/bin/git log -1 --format=%H\n'+'5'.repeat(40);
 await assert.rejects(controller.qualifyOrdinaryHosted({api,policy,retry}),/checkout/i);
});

// Background recovery reconstructs the concrete identity without a saved job key.
for(const [name,key,allowed] of [['test-adjustments','test-adjustments-1',true],['test-provisioning (7)','test-provisioning-7',false]])test(`keyless recovery ${allowed?'retries an owned adjustments job':'refuses an unapproved shard without writes'}`,async t=>{
 const leases=pending(t),ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 let mode='server',cancelled=false;const writes=[];
 const api={get:async path=>path.includes('/pulls/')?evidence().pull:path.includes('/variables/')?{value:mode}:
  path.includes('/jobs/')?{...evidence().job,name,labels:['self-hosted','dt-123-789-1-'+key],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:
  {...evidence().run,status:cancelled?'completed':'in_progress'},
  patch:async(path,body)=>{writes.push(path);mode=body.value;},post:async path=>{writes.push(path);if(path.endsWith('/cancel'))cancelled=true;}};
 if(allowed){assert.equal((await controller.fallbackOrdinary({api,policy,ci,leases})).retry,true);assert.deepEqual(writes,['/repos/fixture/cloud/actions/variables/DISPOSABLE_TESTS_MODE','/repos/fixture/cloud/actions/runs/789/cancel','/repos/fixture/cloud/actions/runs/789/rerun']);}
 else {await assert.rejects(controller.fallbackOrdinary({api,policy,ci,leases}),/job differs/);assert.deepEqual(writes,[]);}
});

// Forgetting a peer orphan without asking its repository leaks its runner.
test('foreground runner cleanup leaves another repository orphan for its own App',async t=>{
 const {ciRequest}=await import('./ci-identity.mjs');
 const root=mkdtempSync(join(tmpdir(),'ordinary-peer-orphan-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});
 const first=controller.admitOrdinary(policy,head,evidence());
 for(const identity of [first,{...first,repositoryId:999,jobId:902}]){
  const lease=leases.reserveLocal(ciRequest('I',identity)).lease;
  leases.release(lease,{resourceId:lease.resourceId,absent:true});
 }
 let present=true;const deleted=[];
 const api={get:async()=>({total_count:present?1:0,runners:present?[{id:1001,name:'dt-123-789-1-901'}]:[]}),delete:async path=>{deleted.push(path);present=false;}};
 await controller.cleanupRunners({leases,api,repository:policy.repository,repositoryId:123});
 assert.deepEqual(deleted,['/repos/fixture/cloud/actions/runners/1001']);
 assert.deepEqual(leases.inspect().orphanRunners.map(o=>o.ci.repositoryId),[999]);
});

test('bounded fallback cancels its closed unchanged-head queued job without retry',async t=>{
 const leases=pending(t);let mode='server',cancelled=false;const writes=[];
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 const api={get:async path=>path.includes('/pulls/')?{...evidence().pull,state:'closed'}:path.includes('/variables/')?{value:mode}:
  path.includes('/jobs/')?{...evidence().job,status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:
  {...evidence().run,status:cancelled?'completed':'in_progress'},patch:async(path,body)=>{mode=body.value;},post:async path=>{assert.equal(mode,'hosted');writes.push(path);cancelled=true;}};
 const result=await controller.fallbackOrdinary({api,policy,ci,leases});
 assert.equal(result.retry,false);assert.equal(result.obsolete,true);
 assert.deepEqual(writes,['/repos/fixture/cloud/actions/runs/789/cancel']);
});

test('the shared pool accepts a separately pinned Cloud policy and refuses ambiguous repository identities',()=>{
 const config={version:2,mode:'manual-slots',slots:6,host:'fixture.invalid',hostGeneration:'fixture',recipe:'/fixture/recipe',repository:'/fixture/repo.git',state:'/fixture/state',
  ci:{...policy,appEnv:'/fixture/waitron.env',appKey:'/fixture/key'},cloudCi:{...policy,repository:'fixture/second',repositoryId:999,appEnv:'/fixture/cloud.env',appKey:'/fixture/key'}};
 assert.doesNotThrow(()=>controller.validateCIConfig(config));
 assert.throws(()=>controller.validateCIConfig({...config,cloudCi:{...config.cloudCi,repositoryId:123}}),/repository|policy/i);
 assert.throws(()=>controller.validateCIConfig({...config,cloudCi:{...config.cloudCi,workflowDigest:'bad'}}),/digest|match/i);
});
