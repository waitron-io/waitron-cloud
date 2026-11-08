import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import * as controller from './ci-canary.mjs';
const head='1'.repeat(40),execution='2'.repeat(40),workflow='reviewed workflow';
const policy={repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex')};
function fixture(){
 const run={id:789,run_attempt:1,head_sha:head,repository:{id:123},head_repository:{id:123},workflow_id:456,path:policy.workflowPath,event:'pull_request',status:'in_progress',pull_requests:[{number:12}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/12/merge',sha:execution}]};
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
 assert.deepEqual(await controller.findAutomatic({api:f.api,policy,limit:6}),[]);
 f.run.referenced_workflows=[];
 assert.deepEqual(await controller.findAutomatic({api:f.api,policy,limit:6}),[]);
});
test('automatic pickup never starts beyond the free-slot count',async()=>{
 const f=fixture();assert.deepEqual((await controller.findAutomatic({api:f.api,policy,limit:2})).map(j=>j.jobId),[901,902]);
 assert.deepEqual(await controller.findAutomatic({api:{get:async()=>assert.fail('Full pool must not poll GitHub')},policy,limit:0}),[]);
});

test('automatic pickup serves older waiting PR runs before newer runs fill the pool',async()=>{
 const f=fixture(),get=f.api.get;
 f.run.created_at='2026-11-07T23:00:00Z';
 const newer={...f.run,id:790,created_at:'2026-11-07T23:10:00Z'};
 const jobs=f.jobs.map(job=>({...job,id:job.id+10,run_id:790,labels:job.labels.map(label=>label.replace('-789-','-790-'))}));
 f.api.get=async path=>path.includes('/runs?')?{total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[newer,f.run]}:
  path.endsWith('/actions/runs/790')?newer:path.includes('/runs/790/attempts/1/jobs?')?{total_count:jobs.length,jobs}:get(path);
 assert.deepEqual((await controller.findAutomatic({api:f.api,policy,limit:1})).map(ci=>[ci.runId,ci.jobId]),[[789,901]]);
});

test('automatic recovery retains cancellation intent when the job stops before its workflow settles',async()=>{
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
 const result=await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:f.api,transport:{healthy:async()=>true},
 runWorker:async(ci)=>{ids.push(ci.jobId);active++;peak=Math.max(peak,active);if(active===5)release();await ready;active--;return {code:0};}});
 assert.deepEqual(ids,[901,902,903,904,905]);assert.equal(peak,5);assert.equal(result.served,5);
 assert.equal(manual.inspect().slots[0].lease.resourceId,lease.resourceId);
 const pending=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 pending.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const next=[];await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{next.push(ci.jobId);return {code:0};}});
 assert.deepEqual(next,[902,903,904,905],'A pending job must not be admitted again on a different slot');
 const {ciRequest}=await import('./ci-identity.mjs'),finished=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:2});
 const complete=(await controller.findAutomatic({api:f.api,policy,limit:6})).find(ci=>ci.jobId===905);
 const reserved=finished.reserveLocal(ciRequest('I',complete)).lease;finished.release(reserved,{resourceId:reserved.resourceId,absent:true});
 const after=[];await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{after.push(ci.jobId);return {code:0};}});
 assert.deepEqual(after,[902,903,904],'Completed turn history must prevent replay even if the API still says queued');
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

for(const obsolete of ['advanced','closed','unavailable'])test(`automatic recovery isolates an ${obsolete} PR without touching its new work`,async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {main}=await import('./manual.mjs'),{GithubApp}=await import('./github-app.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-stale-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const leases=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 const originalGet=GithubApp.prototype.get,originalPost=GithubApp.prototype.post;t.after(()=>{GithubApp.prototype.get=originalGet;GithubApp.prototype.post=originalPost;});let modeReads=0;
 const f=fixture();GithubApp.prototype.get=async path=>{if(obsolete==='unavailable' && path.includes('/actions/jobs/'))throw new Error('Fixture API unavailable');return path.endsWith('DISPOSABLE_TESTS_MODE')?(modeReads++,{value:'hosted'}):path.includes('/actions/jobs/')?{id:901,name:'test-server (24)',run_id:789,run_attempt:1,head_sha:head,status:'completed',conclusion:'cancelled'}:path.endsWith('/pulls/12')?{number:12,state:obsolete==='closed'?'closed':'open',head:{sha:'5'.repeat(40),repo:{id:123}},base:{repo:{id:123}}}:{...f.run,status:'completed'};};
 GithubApp.prototype.post=async()=>assert.fail('Must never cancel or rerun obsolete work');
 assert.equal(await main([config,'--once']),0);assert.equal(await main([config,'--once']),0);
 assert.equal(modeReads,2);if(obsolete==='unavailable')assert.equal(leases.inspect().ciInvocation.jobId,901);else assert.equal(leases.inspect().ciInvocation,undefined);
});

test('a PR with changed workflow bytes cannot stop another approved PR from using capacity',async()=>{
 const f=fixture(),get=f.api.get,otherHead='5'.repeat(40);
 const good={...f.run,id:790,head_sha:otherHead,pull_requests:[{number:13}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/13/merge',sha:execution}]};
 const job={...f.jobs[0],id:911,run_id:790,head_sha:otherHead,labels:['self-hosted','dt-123-790-1-test-server-24']};
 f.api.get=async path=>{
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,good]};
  if(path.endsWith('/actions/runs/790'))return good;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:1,jobs:[job]};
  if(path.endsWith('/pulls/13'))return {number:13,state:'open',head:{sha:otherHead,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/commits/'+otherHead))return {sha:otherHead,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.includes('/contents/') && path.endsWith('?ref='+head))return {encoding:'base64',content:Buffer.from('changed').toString('base64')};
  return get(path);
 };
 const selected=await controller.findAutomatic({api:f.api,policy,limit:6});assert.deepEqual(selected.map(j=>j.jobId),[911]);
});


test('one pickup reads shared run evidence once before workers independently recheck admission',async()=>{
 const f=fixture(),get=f.api.get,reads=new Map();f.api.get=async path=>{reads.set(path,(reads.get(path)??0)+1);return get(path);};
 assert.equal((await controller.findAutomatic({api:f.api,policy,limit:6})).length,5);
 assert.equal(reads.get('/repos/fixture/waitron/actions/runs/789/attempts/1/jobs?per_page=100'),1);
 assert.equal(reads.get('/repos/fixture/waitron/actions/permissions/fork-pr-contributor-approval'),1);
});

test('two workers cannot record the same GitHub job on different slots',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs');
 const root=mkdtempSync(tmpdir()+'/auto-duplicate-');t.after(()=>rmSync(root,{recursive:true,force:true}));
 new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});
 const first=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:0}),second=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 const intent={nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'admitted'};
 first.setInvocation(intent);
 assert.throws(()=>second.setInvocation({...intent,nonce:'b'.repeat(32)}),/job.*recorded/i);
 assert.equal(second.inspect().ciInvocation,undefined);assert.equal(first.inspect().ciInvocation.jobId,901);
 second.setInvocation({...intent,nonce:'b'.repeat(32),jobId:902});assert.equal(second.inspect().ciInvocation.jobId,902);
});

test('stopping automatic pickup lets its owned worker finish cleanup beyond the transport grace',async t=>{
 const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {setTimeout:delay}=await import('node:timers/promises');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-stop-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 const node=process.execPath,worker=directory+'/worker',ready=directory+'/ready',cleaned=directory+'/cleaned';
 writeFileSync(worker,'#!'+node+'\n'+`const fs=require('fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'cleaned');process.exit(0)},2500));fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);\n`,{mode:0o700});
 t.after(()=>{process.execPath=node;});process.execPath=worker;
 const f=fixture(),get=f.api.get;f.jobs.splice(1);f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const cancel=new AbortController();
 const running=automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',ci:policy},api:f.api,transport:{healthy:async()=>true},signal:cancel.signal}).then(value=>({value}),error=>({error}));
 try{const end=Date.now()+5000;while(!existsSync(ready)){assert.ok(Date.now()<end,'Worker never started');await delay(20);}cancel.abort();const result=await running;
  assert.equal(readFileSync(cleaned,'utf8'),'cleaned');assert.match(result.error?.message??'',/abort/i);
 }finally{cancel.abort();await running;process.execPath=node;}
});


test('an automatic server failure requests exactly one cancellation and same-head hosted retry',async()=>{
 const f=fixture(),get=f.api.get;let cancelled=0,reruns=0,stage='admitted';
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901,jobKey:'test-server-24',workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceTree:'4'.repeat(40)};
 f.api.get=async path=>path.endsWith('/actions/runs/789')?{...f.run,status:cancelled?'completed':'in_progress'}:path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:get(path);
 f.api.post=async path=>{if(path.endsWith('/cancel')){assert.equal(stage,'cancel-requested');cancelled++;}else{assert.equal(path,'/repos/fixture/waitron/actions/runs/789/rerun');assert.equal(cancelled,1);reruns++;}};
 f.api.patch=async()=>assert.fail('Automatic routing must stay on');
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:stage,runId:789,attempt:1,jobId:901}}),setInvocation:v=>{stage=v.ordinaryStage;}};
 const result=await controller.fallbackOrdinary({api:f.api,policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(cancelled,1);assert.equal(reruns,1);assert.equal(result.retry,true);assert.equal(result.sourceSha,head);
});

test('the real CLI completes its automatic recovery import instead of exiting with unsettled await',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{spawnSync}=await import('node:child_process');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-cli-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 const manual=new URL('./manual.mjs',import.meta.url),app=new URL('./github-app.mjs',import.meta.url);
 const program=`import assert from 'node:assert/strict';import {GithubApp} from ${JSON.stringify(app.href)};GithubApp.prototype.get=async path=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE'));return {value:'hosted'}};process.argv=[process.execPath,${JSON.stringify(manual.pathname)},${JSON.stringify(config)},'--once'];await import(${JSON.stringify(manual.href)});console.log('CLI_FINISHED');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/CLI_FINISHED/);assert.doesNotMatch(result.stderr,/unsettled top-level await/);
});

test('an unhealthy or unreachable host selects hosted before polling or starting PR jobs',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{automaticTick}=await import('./control.mjs');
 for(const failure of ['unhealthy','unreachable']){
  const root=mkdtempSync(tmpdir()+'/auto-health-');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const leases=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});let mode='server',checks=0,writes=0;
  const api={get:async path=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE') || path.endsWith('DISPOSABLE_TESTS_HEAD'),'Must not poll runs or jobs');return {value:path.endsWith('DISPOSABLE_TESTS_HEAD')?'':mode};},patch:async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE'));assert.equal(body.value,'hosted');mode=body.value;writes++;},post:async()=>assert.fail('Must not cancel or rerun a workflow')};
  const result=await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state:root,hostGeneration:'test',ci:policy},api,transport:{healthy:async()=>{checks++;if(failure==='unreachable')throw new Error('Host unreachable');return false;}},runWorker:async()=>assert.fail('Must not start a guest')});
  assert.equal(result.served,0);assert.equal(mode,'hosted');assert.equal(checks,1);assert.equal(writes,1);assert.ok(leases.inspect().slots.every(s=>s.state==='free' && !s.ciInvocation));
  for(let slot=0;slot<6;slot++)new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'full-'+slot,snapshot:'a'.repeat(64),argv:['true']});
  mode='server';await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state:root,hostGeneration:'test',ci:policy},api,transport:{healthy:async()=>assert.fail('A full healthy pool is busy, not unavailable')}});
  assert.equal(mode,'server');assert.equal(writes,1);
 }
});

for(const race of ['none','assigned','assigned-later','changed-label','advanced'])test(`refused workflow fallback handles ${race} race without running unreviewed code`,async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-refused-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const f=fixture();f.jobs.splice(1);let cancelled=false,reruns=0,jobReads=0,pullReads=0;const get=f.api.get;
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from('unreviewed workflow').toString('base64')};
  if(path.endsWith('/actions/jobs/901')){jobReads++;return {...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null,...(race==='assigned' || race==='assigned-later' && jobReads>1?{runner_id:42}:{}),...(race==='changed-label'?{labels:['self-hosted','dt-123-789-1-test-heavy-3']}: {})};}
  if(path.endsWith('/pulls/12') && race==='advanced' && pullReads++)return {number:12,state:'open',head:{sha:'5'.repeat(40),repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:cancelled?'completed':'in_progress'};
  return get(path);
 };
 f.api.post=async path=>{if(path.endsWith('/cancel'))cancelled=true;else if(path.endsWith('/rerun'))reruns++;else assert.fail(path);};
 f.api.patch=async()=>assert.fail('A refused workflow must not disable routing for other reviewed PRs');
 await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',ci:policy},api:f.api,transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Unreviewed workflow must never execute on the server')});
 assert.equal(cancelled,race==='none','Only a still-queued job on the unchanged PR may be cancelled');
 assert.equal(reruns,race==='none'?1:0,'Only the unchanged refused PR retries using the existing hosted route');
 const ledger=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6}).inspect();
 assert.ok(ledger.slots.every(s=>s.state==='free' && !s.ciInvocation));
});

test('recovery of a refused intent preserves a job assigned after its previous API failure',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{reconcileManual}=await import('./manual.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-refused-recovery-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const leases=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'refused'});
 const f=fixture(),get=f.api.get;f.api.get=async path=>path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:'in_progress',runner_id:42}:get(path);
 f.api.post=async()=>assert.fail('An assigned job must survive recovery without cancellation or rerun');
 const result=await reconcileManual({state,hostGeneration:'test',slots:6,slot:1,transport:{destroy:async()=>assert.fail('A refused job has no guest to remove')},ci:policy,api:f.api});
 assert.equal(result.code,0);assert.equal(leases.inspect().ciInvocation,undefined);assert.equal(leases.inspect().slots[0].state,'free');
});

async function refusalPool(t){
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-refusal-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 return {version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',ci:policy};
}

test('automatic pickup refills a completed slot before a slow sibling finishes',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.jobs.splice(3);
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 for(let slot=0;slot<4;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 let finishSlow,thirdStarted,healthChecks=0;
 const slow=new Promise(resolve=>{finishSlow=resolve;}),third=new Promise(resolve=>{thirdStarted=resolve;});
 const started=[];
 const running=automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>{healthChecks++;return true;}},runWorker:ci=>withAvailableSlot(config,async({leases})=>{
  const lease=leases.reserveLocal(ciRequest('I',ci)).lease;started.push(ci.jobId);
  if(ci.jobId===901)await slow;
  if(ci.jobId===903)thirdStarted(true);
  leases.release(lease,{resourceId:lease.resourceId,absent:true});return {code:0};
 })});
 let deadline;
 const refilled=await Promise.race([third,new Promise(resolve=>{deadline=setTimeout(()=>resolve(false),5000);})]);
 clearTimeout(deadline);
 finishSlow();const result=await running;
 assert.equal(refilled,true,'A free slot must serve the next queued job while its sibling is still running');
 assert.deepEqual(started.sort((a,b)=>a-b),[901,902,903]);assert.equal(result.served,3);
 assert.equal(healthChecks,1,'Refilling must not repeatedly probe the loaded host');
 const state=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect();
 assert.deepEqual(state.slots.slice(0,4).map(s=>s.lease.turn),['manual-0','manual-1','manual-2','manual-3']);
});

for(const status of [502,429])test(`a transient GitHub ${status} leaves queued work for the next pickup without restarting CI`,async t=>{
 const {automaticTick}=await import('./control.mjs');const config=await refusalPool(t),f=fixture(),get=f.api.get;let mutations=0;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/contents/')?Promise.reject(Object.assign(new Error('Temporary GitHub error'),{status})):path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:mutations?'completed':'queued',conclusion:mutations?'cancelled':null}:path.endsWith('/actions/runs/789')?{...f.run,status:mutations?'completed':'in_progress'}:get(path);
 f.api.post=async()=>{mutations++;};
 await automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Unavailable evidence cannot admit a server worker')});
 assert.equal(mutations,0,'A temporary API error must not restart the PR');
});

for(const busy of ['none','busy','retired','pending'])test(`reviewed workers start before refusal cleanup with ${busy} admission`,async t=>{
 const {automaticTick}=await import('./control.mjs');const config=await refusalPool(t),f=fixture(),get=f.api.get,otherHead='5'.repeat(40);let started=false,cancelled=false,reruns=0,tries=0;
 const good={...f.run,id:790,head_sha:otherHead,pull_requests:[{number:13}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/13/merge',sha:execution}]};
 const job={...f.jobs[0],id:911,run_id:790,head_sha:otherHead,labels:['self-hosted','dt-123-790-1-test-server-24']};
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,good]};
  if(path.endsWith('/actions/runs/790'))return good;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:1,jobs:[job]};
  if(path.endsWith('/pulls/13'))return {number:13,state:'open',head:{sha:otherHead,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/commits/'+otherHead))return {sha:otherHead,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.includes('/contents/') && path.endsWith('?ref='+head))return {encoding:'base64',content:Buffer.from('changed').toString('base64')};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:cancelled?'completed':'in_progress'};
  if(path.endsWith('/actions/jobs/901'))return {...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null};
  return get(path);
 };
 f.api.post=async path=>{assert.equal(started,true,'Known good work must start before refusal cleanup');if(path.endsWith('/cancel'))cancelled=true;else if(path.endsWith('/rerun'))reruns++;else assert.fail(path);};
 const result=await automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{
  assert.equal(ci.jobId,911);started=true;tries++;
  if(tries===1 && ['retired','pending'].includes(busy)){
   const {LocalLeases}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:5});
   if(busy==='retired'){const lease=leases.reserveLocal(ciRequest('I',ci)).lease;leases.release(lease,{resourceId:lease.resourceId,absent:true});}
   else leases.setInvocation({nonce:'b'.repeat(32),sourceSha:otherHead,workflowSha:otherHead,route:'server',createdAt:Date.now(),runId:790,attempt:1,jobId:911,ordinaryStage:'cancel-requested'});
  }
  return {code:busy!=='none' && tries===1?75:0};
 }});
 assert.equal(result.served,1);assert.equal(cancelled,true);assert.equal(reruns,1);assert.equal(tries,busy==='busy'?2:1,'Retry only an unadmitted busy worker; preserve admitted turns and recovery intents');
});

test('a refused cancellation that is still settling retains its intent until recovery requests one hosted rerun',async t=>{
 const {automaticTick}=await import('./control.mjs'),{reconcileManual}=await import('./manual.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;let jobReads=0,settled=false,reruns=0;
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from('changed').toString('base64')};
  if(path.endsWith('/actions/jobs/901'))return {...f.jobs[0],status:++jobReads>=3?'completed':'queued',conclusion:jobReads>=3?'cancelled':null};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:settled?'completed':'in_progress'};
  return get(path);
 };
 f.api.post=async path=>{assert.ok(path.endsWith('/rerun'));reruns++;};
 await automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Unreviewed workflow')});
 const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6});
 assert.equal(leases.inspect().slots.filter(s=>s.ciInvocation?.ordinaryStage==='cancel-requested').length,1);assert.equal(reruns,0);
 settled=true;await reconcileManual({...config,transport:{},api:f.api});
 assert.equal(reruns,1);assert.ok(leases.inspect().slots.every(s=>!s.ciInvocation));
 await reconcileManual({...config,transport:{},api:f.api});assert.equal(reruns,1);
});

test('the real recovery CLI finishes a refused-workflow hosted retry without an import cycle',async t=>{
 const {writeFileSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
 const config=await refusalPool(t),configuration=config.state+'/configuration.json';
 writeFileSync(configuration,JSON.stringify({...config,host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:config.state,ci:{...policy,appEnv:config.state+'/app.env',appKey:config.state+'/app.pem'}}));
 const manual=new URL('./manual.mjs',import.meta.url),app=new URL('./github-app.mjs',import.meta.url),transport=new URL('./transport.mjs',import.meta.url);
 const program=`import assert from 'node:assert/strict';import {GithubApp} from ${JSON.stringify(app.href)};import {CITransport} from ${JSON.stringify(transport.href)};
 const head=${JSON.stringify(head)},execution=${JSON.stringify(execution)},workflow=${JSON.stringify(workflow)},policy=${JSON.stringify(policy)};
 const f=(${fixture.toString()})();const get=f.api.get;let cancelled=0,reruns=0;
 GithubApp.prototype.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/contents/')?{encoding:'base64',content:Buffer.from('changed').toString('base64')}:path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:path.endsWith('/actions/runs/789')?{...f.run,status:cancelled?'completed':'in_progress'}:get(path);
 GithubApp.prototype.post=async path=>{if(path.endsWith('/cancel'))cancelled++;else if(path.endsWith('/rerun'))reruns++;else assert.fail(path);};
 CITransport.prototype.healthy=async()=>true;
 process.argv=[process.execPath,${JSON.stringify(manual.pathname)},${JSON.stringify(configuration)},'--once'];await import(${JSON.stringify(manual.href)});assert.equal(cancelled,1);assert.equal(reruns,1);console.log('REFUSED_CLI_FINISHED');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/REFUSED_CLI_FINISHED/);assert.doesNotMatch(result.stderr,/unsettled top-level await/);
});

test('owned cancellation bypasses an always-run summary queue before requesting the hosted retry',async()=>{
 const f=fixture(),get=f.api.get;let forced=false,reruns=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:'completed',conclusion:'cancelled'}:path.endsWith('/actions/runs/789')?{...f.run,status:forced?'completed':'queued'}:get(path);
 f.api.post=async path=>{if(path.endsWith('/force-cancel'))forced=true;else if(path.endsWith('/rerun')){assert.equal(forced,true);reruns++;}else assert.fail('Normal cancellation is already recorded');};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}})};
 const result=await controller.fallbackOrdinary({api:f.api,policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(forced,true,'An always-run summary must not hold a cancelled source in the runner queue');assert.equal(reruns,1);assert.equal(result.retry,true);
});


test('pickup counts a worker waiting for admission against free capacity',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 for(let slot=0;slot<4;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 let releaseFirst,active=0,peak=0;const first=new Promise(resolve=>{releaseFirst=resolve;}),results=[];
 const timer=setTimeout(releaseFirst,1000);t.after(()=>clearTimeout(timer));
 await automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{
  active++;peak=Math.max(peak,active);if(ci.jobId===901)await first;if(ci.jobId===903)releaseFirst();
  try{const result=await withAvailableSlot(config,async({leases})=>{
   const lease=leases.reserveLocal(ciRequest('I',ci)).lease;
   await new Promise(resolve=>setTimeout(resolve,40));
   leases.release(lease,{resourceId:lease.resourceId,absent:true});return {code:0};
  });results.push(result.code);return result;}finally{active--;}
 }});
 assert.ok(peak<=2,'Two free slots cannot admit three live or not-yet-reserved workers');
 assert.ok(results.every(code=>code===0),'Refill must not strand a capacity-busy loser');
});

test('pickup recovers an interrupted slot while a slower worker still owns its slot',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.jobs.splice(4);f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 for(let slot=0;slot<3;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 const interrupted=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:3}),nonce='c'.repeat(32);
 interrupted.setInvocation({nonce,sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:999,ordinaryStage:'admitted'});
 let finish,fourthStarted,fastDone=false;const held=new Promise(resolve=>{finish=resolve;}),fourth=new Promise(resolve=>{fourthStarted=resolve;});
 const running=automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},recover:async()=>{
  if(fastDone && interrupted.inspect().ciInvocation)interrupted.clearInvocation(nonce);
 },runWorker:ci=>withAvailableSlot(config,async({leases})=>{
  const lease=leases.reserveLocal(ciRequest('I',ci)).lease;
  if(ci.jobId!==902){if(ci.jobId===904)fourthStarted(true);await held;}else fastDone=true;
  leases.release(lease,{resourceId:lease.resourceId,absent:true});return {code:0};
 })});
 let timer;const recovered=await Promise.race([fourth,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
 clearTimeout(timer);finish();await running;
 assert.equal(recovered,true,'Recovery must return its slot to queued work before the pool drains');
 assert.equal(interrupted.inspect().ciInvocation,undefined);
});


for(const refusalRead of ['ready','transient-failure','admitted-sibling','persisted-failure','existing-pending','ledger-failure'])test(`a refused run retains only one cancellation intent across refills after ${refusalRead}`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{renameSync}=await import('node:fs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,otherHead='5'.repeat(40),reads=new Map();
 const good={...f.run,id:790,head_sha:otherHead,pull_requests:[{number:13}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/13/merge',sha:execution}]};
 const jobs=f.jobs.slice(0,3).map(job=>({...job,id:job.id+10,run_id:790,head_sha:otherHead,labels:job.labels.map(label=>label.replace('-789-','-790-'))}));
 let finish,cancelled,scans=0,runReads=0,posts=0,reruns=0,settled=false,sibling,releaseSibling,missing,readFailed;const firstReadFailed=new Promise(resolve=>{readFailed=resolve;});const siblingHeld=new Promise(resolve=>{releaseSibling=resolve;}),ledgerMissing=new Promise(resolve=>{missing=resolve;});const held=new Promise(resolve=>{finish=resolve;}),cancel=new Promise(resolve=>{cancelled=resolve;});
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?')){if(path.includes('status=queued') && ++scans===2)setTimeout(finish,100);return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,good]};}
  if(path.endsWith('/actions/runs/789')){
   if(settled)return {...f.run,status:'completed'};
   if(++runReads===2 && ['transient-failure','admitted-sibling','ledger-failure'].includes(refusalRead)){
    if(refusalRead==='admitted-sibling'){
     let ready;const started=new Promise(resolve=>{ready=resolve;});
     sibling=withAvailableSlot(config,async({leases})=>{const nonce='f'.repeat(32);leases.setInvocation({nonce,sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:999,ordinaryStage:'admitted'});ready();await siblingHeld;leases.clearInvocation(nonce);return {code:0};});
     await started;
    }
    if(refusalRead==='ledger-failure'){renameSync(config.state+'/ledger/state.json',config.state+'/ledger/saved.json');missing();}
    readFailed();throw Object.assign(new Error('Temporary GitHub error'),{status:502});
   }
  }
  if(path.endsWith('/actions/runs/790'))return good;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:jobs.length,jobs};
  if(path.endsWith('/pulls/13'))return {number:13,state:'open',head:{sha:otherHead,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/commits/'+otherHead))return {sha:otherHead,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.includes('/contents/') && path.endsWith('?ref='+head))return {encoding:'base64',content:Buffer.from('changed').toString('base64')};
  const matched=f.jobs.find(job=>path.endsWith('/actions/jobs/'+job.id));
  if(matched){const n=(reads.get(matched.id)??0)+1;reads.set(matched.id,n);const complete=settled || n>=(refusalRead==='persisted-failure'?4:3);if(complete)cancelled();return {...matched,status:complete?'completed':'queued',conclusion:complete?'cancelled':null};}
  return get(path);
 };
 f.api.post=async path=>{
  if(path.endsWith('/rerun')){assert.equal(settled,true);reruns++;return;}
  assert.ok(path.endsWith('/cancel'));posts++;
  if(refusalRead==='persisted-failure')throw Object.assign(new Error('Temporary cancellation response failure'),{status:502});
  cancelled();
 };
 if(refusalRead==='existing-pending')new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:5}).setInvocation({nonce:'e'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const running=automaticTick({configuration:'/fixture/config.json',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{
  if(ci.jobId===912){if(refusalRead==='ready')await cancel;if(refusalRead==='admitted-sibling')await firstReadFailed;await new Promise(resolve=>setTimeout(resolve,60));}else await held;
  return {code:0};
 }});
 const timeout=setTimeout(finish,5000);
 if(refusalRead==='ledger-failure'){
  let joined=false;const result=running.then(()=>assert.fail('Missing ledger must refuse pickup'),error=>{joined=true;return error;});
  try{await ledgerMissing;await new Promise(resolve=>setTimeout(resolve,150));assert.equal(joined,false,'A ledger read failure must still join its live children');finish();assert.match((await result).message,/Recorded ledger is missing/);}
  finally{clearTimeout(timeout);finish();renameSync(config.state+'/ledger/saved.json',config.state+'/ledger/state.json');}
  return;
 }
 try{
 await running;
 const intents=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect().slots.filter(slot=>slot.ciInvocation);
 assert.ok(scans>=2);assert.equal(intents.length,refusalRead==='admitted-sibling'?2:1,'A later scan must retain exactly one cancellation intent beside any admitted sibling');
 assert.equal(intents.filter(slot=>slot.ciInvocation.ordinaryStage==='cancel-requested').length,1);
 if(refusalRead==='admitted-sibling')assert.equal(intents.filter(slot=>slot.ciInvocation.ordinaryStage==='admitted').length,1,'Refusal bookkeeping cannot clear the independently owned sibling');
 if(refusalRead==='persisted-failure'){
  assert.equal(posts,1,'The fixture must fail a real cancellation POST after saving its intent');
  settled=true;const {reconcileManual}=await import('./manual.mjs');await reconcileManual({...config,transport:{},api:f.api});
  assert.equal(reruns,1);assert.ok(new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect().slots.every(slot=>!slot.ciInvocation));
 }
 }finally{clearTimeout(timeout);finish();releaseSibling();await sibling;}
});
