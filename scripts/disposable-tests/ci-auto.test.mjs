import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import * as controller from './ci-canary.mjs';
const head='1'.repeat(40),execution='2'.repeat(40),workflow='reviewed workflow';
const policy={repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex')};
function fixture(){
 const run={id:789,run_attempt:1,head_sha:head,repository:{id:123},head_repository:{id:123},workflow_id:456,path:policy.workflowPath,event:'pull_request',status:'in_progress',pull_requests:[{number:12}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/ci.yml@refs/pull/12/merge',ref:'refs/pull/12/merge',sha:execution}]};
 const jobs=[['test-server (24)','test-server-24'],['test-heavy (3)','test-heavy-3'],['test-till (7)','test-till-7'],['test-ui','test-ui-1'],['test-dashboard (4)','test-dashboard-4']].map(([name,key],i)=>({id:901+i,name,run_id:789,run_attempt:1,head_sha:head,status:'queued',runner_id:null,labels:['self-hosted','dt-123-789-1-'+key]}));
 const api={get:async path=>{
  if(path.endsWith('fork-pr-contributor-approval'))return {approval_policy:'all_external_contributors'};
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:1,workflow_runs:path.includes('status=queued')?[]:[run]};
  if(path.endsWith('/actions/runs/789'))return run;
  if(path.includes('/jobs?'))return {total_count:jobs.length,jobs};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(workflow).toString('base64')};
  if(path.endsWith('/commits/'+head))return {sha:head,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.endsWith('/pulls/12'))return {number:12,state:'open',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}};
  if(path==='/repos/fixture/waitron')return {id:123,full_name:policy.repository};
  throw new Error('Unexpected '+path);
 }};
 return {run,jobs,api};
}
test('automatic pickup admits each routed shard on the current same-repository PR without a chosen head',async()=>{
 const {api}=fixture();assert.equal(typeof controller.findAutomatic,'function');
 const jobs=await controller.findAutomatic({api,policy,limit:6});
 assert.deepEqual(jobs.map(j=>[j.jobId,j.jobKey]),[[901,'test-server-24'],[902,'test-heavy-3'],[903,'test-till-7'],[904,'test-ui-1'],[905,'test-dashboard-4']]);
 assert.ok(jobs.every(j=>j.sourceSha===head && j.runId===789 && j.attempt===1));
});
for(const change of ['fork','retry','assigned','hosted','unsupported','stale'])test(`automatic pickup leaves ${change} jobs alone`,async()=>{
 const f=fixture();
 if(change==='fork')f.run.head_repository.id=999;
 if(change==='retry')f.run.run_attempt=2;
 if(change==='stale')f.run.head_sha='5'.repeat(40);
 if(change==='assigned')f.jobs.forEach(j=>j.runner_id=42);
 if(change==='hosted')f.jobs.forEach(j=>j.labels=['ubuntu-latest']);
 if(change==='unsupported')f.jobs.forEach(j=>{j.name='test-setup (1)';j.labels=['self-hosted','dt-123-789-1-test-setup-1'];});
 assert.deepEqual(await controller.findAutomatic({api:f.api,policy,limit:6}),[]);
});
test('automatic pickup pins the original merge workflow and rejects changed execution bytes',async()=>{
 const f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('?ref='+execution)?{encoding:'base64',content:Buffer.from('changed workflow').toString('base64')}:get(path);
 await assert.rejects(controller.findAutomatic({api:f.api,policy,limit:6}),/execution workflow/i);
 f.run.referenced_workflows=[];
 await assert.rejects(controller.findAutomatic({api:f.api,policy,limit:6}),/execution workflow/i);
});
test('automatic pickup never starts beyond the free-slot count',async()=>{
 const f=fixture();assert.deepEqual((await controller.findAutomatic({api:f.api,policy,limit:2})).map(j=>j.jobId),[901,902]);
 assert.deepEqual(await controller.findAutomatic({api:{get:async()=>assert.fail('Full pool must not poll GitHub')},policy,limit:0}),[]);
});

test('automatic failure keeps CI enabled and retains cancellation intent until the run can retry',async()=>{
 const {api}=fixture();let stage='admitted',cancelled=false,reruns=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901,jobKey:'test-server-24',workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceTree:'4'.repeat(40)};
 const get=api.get;let jobReads=0;api.get=async path=>path.endsWith('/actions/jobs/901')?(++jobReads>1 && (cancelled=true),{id:901,run_id:789,run_attempt:1,head_sha:head,name:'test-server (24)',status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}):path.endsWith('/actions/runs/789')?{...(await get(path)),status:'in_progress'}:get(path);
 api.patch=async()=>assert.fail('A single failure must leave automatic routing on');
 api.post=async path=>{if(path.endsWith('/cancel'))cancelled=true;else{reruns++;assert.ok(path.endsWith('/rerun'));}};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:stage,runId:789,attempt:1,jobId:901}}),setInvocation:v=>{stage=v.ordinaryStage;}};
 // The job has stopped but the workflow's summary has not yet settled.
 const result=await controller.fallbackOrdinary({api,policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(cancelled,true);assert.equal(stage,'cancel-requested');assert.equal(reruns,0);assert.equal(result.pending,true);
});

test('one automatic recovery retries the completed old attempt without switching all PRs hosted',async()=>{
 const f=fixture();let reruns=0;
 const api={get:async path=>path.endsWith('/actions/jobs/901')?{id:901,name:'test-server (24)',run_id:789,run_attempt:1,head_sha:head,status:'completed',conclusion:'cancelled'}:path.endsWith('/actions/runs/789')?{...f.run,status:'completed'}:f.api.get(path),post:async path=>{assert.ok(path.endsWith('/rerun'));reruns++;},patch:async()=>assert.fail('No global mode flip')};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}})};
 const result=await controller.fallbackOrdinary({api,policy,ci:{repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901},leases,automatic:true});
 assert.equal(result.retry,true);assert.equal(reruns,1);
});

test('automatic pickup fills free slots while an independent manual test keeps its slot',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-pool-'),root=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(root,async()=>{new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(root+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const manual=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:0});
 const lease=manual.reserveLocal({lane:'I',turn:'manual-test',snapshot:'a'.repeat(64),argv:['true']}).lease;
 const f=fixture(),get=f.api.get;f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 let active=0,peak=0,release;const ready=new Promise(r=>release=r),ids=[];
 const result=await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:f.api,
 runWorker:async(ci)=>{ids.push(ci.jobId);active++;peak=Math.max(peak,active);if(active===5)release();await ready;active--;return {code:0};}});
 assert.deepEqual(ids,[901,902,903,904,905]);assert.equal(peak,5);assert.equal(result.served,5);
 assert.equal(manual.inspect().slots[0].lease.resourceId,lease.resourceId);
 const pending=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 pending.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const next=[];await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:f.api,runWorker:async ci=>{next.push(ci.jobId);return {code:0};}});
 assert.deepEqual(next,[902,903,904,905],'A pending job must not be admitted again on a different slot');
});

test('the installed recovery entry also polls automatic CI after reconciling its pool',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {main}=await import('./manual.mjs'),{GithubApp}=await import('./github-app.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-entry-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,
 ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 let reads=0;const get=GithubApp.prototype.get;t.after(()=>{GithubApp.prototype.get=get;});
 GithubApp.prototype.get=async path=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE'));reads++;return {value:'hosted'};};
 const result=await main([config,'--once']);assert.equal(result,0);assert.equal(reads,1);
});
