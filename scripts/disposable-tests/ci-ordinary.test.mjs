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
 value='invalid';assert.equal(await controller.routingMode({api,policy}),'hosted');
 api.patch=async()=>{};await assert.rejects(controller.setRoutingMode({api,policy,mode:'hosted'}),/readback/i);
});

test('ordinary fallback switches hosted before cancelling and retries only its unchanged completed attempt',async()=>{
 assert.equal(typeof controller.fallbackOrdinary,'function');let mode='server',cancelled=false,retried=false;
 const ci={...evidence().run,repositoryId:123,workflowId:456,workflowSha:head,runId:789,attempt:1,jobId:901};
 const api={get:async path=>path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
 {...evidence().job,status:cancelled?'completed':'queued'}:{...evidence().run,status:cancelled?'completed':'in_progress'},
 patch:async(path,body)=>{assert.equal(path,'/repos/fixture/cloud/actions/variables/DISPOSABLE_TESTS_MODE');mode=body.value;},
 post:async path=>{assert.equal(mode,'hosted');if(path.endsWith('/cancel'))cancelled=true;
 else{assert.equal(path,'/repos/fixture/cloud/actions/runs/789/rerun');assert.equal(cancelled,true);retried=true;}}};
 await controller.fallbackOrdinary({api,policy,ci});assert.equal(retried,true);
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
 for(const [mode,event,attempt,headRepository,want] of [
  ['server','pull_request',1,123,['self-hosted','dt-123-789-1-typecheck']],
  ['hosted','pull_request',1,123,'ubuntu-latest'],[undefined,'pull_request',1,123,'ubuntu-latest'],
  ['bad','pull_request',1,123,'ubuntu-latest'],['server','push',1,123,'ubuntu-latest'],
  ['server','pull_request',2,123,'ubuntu-latest'],['server','pull_request',1,999,'ubuntu-latest']]){
  const context={vars:{DISPOSABLE_TESTS_MODE:mode},github:{event_name:event,run_attempt:attempt,repository_id:123,run_id:789,
   event:{repository:{id:123},pull_request:{head:{repo:{id:headRepository}}}}},fromJSON:JSON.parse,
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
 const api={get:async path=>path.includes('/variables/')?{value:mode}:path.includes('/jobs/')?
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
 const api={get:async path=>path.includes('/variables/')?{value:'server'}:path.endsWith('/fork-pr-contributor-approval')?
 {approval_policy:'all_external_contributors'}:path.includes('/jobs?')?{total_count:0,jobs:[]}:evidence().run};
 await assert.rejects(withOrdinaryController({state,hostGeneration:'fixture',api,policy,approvedHead:head,runId:789,lane:'I',
  wait:async()=>{unlocked=(await withKernelLock(state,async()=>({code:0}))).code===0;throw new Error('stop fixture poll');}}),/stop fixture poll/);
 assert.equal(unlocked,true);
});
