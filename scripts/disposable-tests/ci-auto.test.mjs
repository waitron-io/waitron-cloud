import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import * as controller from './ci-canary.mjs';
const head='1'.repeat(40),execution='2'.repeat(40),workflow='reviewed workflow using vars.DISPOSABLE_TESTS_HOSTED_ATTEMPTS';
const policy={repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex')};
const routingStores=new WeakMap();
function routingVariables(api){
 if(!routingStores.has(api))routingStores.set(api,{value:'{}'});
 const stored=routingStores.get(api);
 return new Proxy(api,{get(target,key){
  if(key==='get')return (path,...args)=>path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?Promise.resolve({value:stored.value}):target.get(path,...args);
  if(key==='patch')return (path,body,...args)=>{
   if(!path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return target.patch(path,body,...args);
   assert.equal(body.name,'DISPOSABLE_TESTS_HOSTED_ATTEMPTS');
   assert.ok(Object.values(JSON.parse(body.value)).every(attempt=>Number.isSafeInteger(attempt) && attempt>0));
   stored.value=body.value;return Promise.resolve(null);
  };
  return Reflect.get(target,key);
 }});
}
function fixture(){
 const run={id:789,created_at:new Date(Date.now()-120000).toISOString(),run_attempt:1,head_sha:head,repository:{id:123},head_repository:{id:123},workflow_id:456,path:policy.workflowPath,event:'pull_request',status:'in_progress',pull_requests:[{number:12}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/12/merge',sha:execution}]};
 const jobs=[['test-server (24)','test-server-24'],['test-heavy (3)','test-heavy-3'],['test-till (7)','test-till-7'],['test-ui','test-ui-1'],['test-dashboard (4)','test-dashboard-4']].map(([name,key],i)=>({id:901+i,name,run_id:789,run_attempt:1,head_sha:head,status:'queued',runner_id:null,labels:['self-hosted','dt-123-789-1-'+key]}));
 const api={get:async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{}'};
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
 const jobs=await controller.findAutomatic({api:routingVariables(api),policy,limit:6});
 assert.deepEqual(jobs.map(j=>[j.jobId,j.jobKey]),[[901,'test-server-24'],[902,'test-heavy-3'],[903,'test-till-7'],[904,'test-ui-1'],[905,'test-dashboard-4']]);
 assert.ok(jobs.every(j=>j.sourceSha===head && j.runId===789 && j.attempt===1));
});
test('an incomplete run inventory does not hold free capacity behind a still-running sibling',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-inventory-'),root=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(root,async()=>{new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:2,bootstrap:true});},{bootstrap:true});
 const f=fixture(),get=f.api.get,first=f.jobs[0],second=f.jobs[1],third=f.jobs[2];let scans=0,release;
 const held=new Promise(resolve=>release=resolve),ids=[];
 const timeout=setTimeout(release,500);t.after(()=>clearTimeout(timeout));
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?') && path.includes('status=queued')){
   if(++scans===2)return {total_count:1,workflow_runs:[]};
  }
  if(path.includes('/jobs?'))return {total_count:scans<3?2:3,jobs:scans<3?[first,second]:[first,second,third]};
  return get(path);
 };
 let failure;
 try{await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',state:root,hostGeneration:'test',slots:2,ci:policy},
  api:routingVariables(f.api),transport:{healthy:async()=>true},wait:async()=>{},runWorker:async ci=>{ids.push(ci.jobId);if(ci.jobId===901)await held;else if(ci.jobId===903)release();return {code:0};}});}
 catch(error){failure=error;}
 assert.equal(failure,undefined);assert.deepEqual(ids,[901,902,903]);
});
for(const change of ['fork','retry','assigned','hosted','unsupported','stale'])test(`automatic pickup leaves ${change} jobs alone`,async()=>{
 const f=fixture();
 if(change==='fork')f.run.head_repository.id=999;
 if(change==='retry')f.run.run_attempt=2;
 if(change==='stale')f.run.head_sha='5'.repeat(40);
 if(change==='assigned')f.jobs.forEach(j=>j.runner_id=42);
 if(change==='hosted')f.jobs.forEach(j=>j.labels=['ubuntu-latest']);
 if(change==='unsupported')f.jobs.forEach(j=>{j.name='test-setup (1)';j.labels=['self-hosted','dt-123-789-1-test-setup-1'];});
 assert.deepEqual(await controller.findAutomatic({api:routingVariables(f.api),policy,limit:6}),[]);
});
test('automatic pickup accepts same-repository workflow edits without an execution pin',async()=>{
 const f=fixture(),get=f.api.get,changed='changed same-repository workflow';
 f.api.get=async path=>path.includes('/contents/')?{encoding:'base64',content:Buffer.from(changed).toString('base64')}:get(path);
 f.run.referenced_workflows=[];
 const jobs=await controller.findAutomatic({api:routingVariables(f.api),policy,limit:6});
 assert.deepEqual(jobs.map(ci=>ci.jobId),[901,902,903,904,905]);
 assert.ok(jobs.every(ci=>ci.workflowDigest===createHash('sha256').update(changed).digest('hex')));
});
test('automatic pickup never starts beyond the free-slot count',async()=>{
 const f=fixture();assert.deepEqual((await controller.findAutomatic({api:routingVariables(f.api),policy,limit:2})).map(j=>j.jobId),[901,902]);
 assert.deepEqual(await controller.findAutomatic({api:{get:async()=>assert.fail('Full pool must not poll GitHub')},policy,limit:0}),[]);
});

test('automatic pickup serves older waiting PR runs before newer runs fill the pool',async()=>{
 const f=fixture(),get=f.api.get;
 f.run.created_at='2026-11-07T23:00:00Z';
 const newer={...f.run,id:790,created_at:'2026-11-07T23:10:00Z'};
 const jobs=f.jobs.map(job=>({...job,id:job.id+10,run_id:790,labels:job.labels.map(label=>label.replace('-789-','-790-'))}));
 f.api.get=async path=>path.includes('/runs?')?{total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[newer,f.run]}:
  path.endsWith('/actions/runs/790')?newer:path.includes('/runs/790/attempts/1/jobs?')?{total_count:jobs.length,jobs}:get(path);
 assert.deepEqual((await controller.findAutomatic({api:routingVariables(f.api),policy,limit:1})).map(ci=>[ci.runId,ci.jobId]),[[789,901]]);
});

test('automatic recovery retains cancellation intent when the job stops before its workflow settles',async()=>{
 const {api}=fixture();let stage='admitted',cancelled=false,reruns=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901,jobKey:'test-server-24',workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceTree:'4'.repeat(40)};
 const get=api.get;let jobReads=0;api.get=async path=>path.endsWith('/actions/jobs/901')?(++jobReads>1 && (cancelled=true),{id:901,run_id:789,run_attempt:1,head_sha:head,name:'test-server (24)',status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}):path.endsWith('/actions/runs/789')?{...(await get(path)),status:'in_progress'}:get(path);
 api.patch=async()=>assert.fail('A single failure must leave automatic routing on');
 api.post=async path=>{if(path.endsWith('/cancel'))cancelled=true;else{reruns++;assert.ok(path.endsWith('/rerun'));}};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:stage,runId:789,attempt:1,jobId:901}}),setInvocation:v=>{stage=v.ordinaryStage;}};
 // The job has stopped but the workflow's summary has not yet settled.
 const result=await controller.fallbackOrdinary({api:routingVariables(api),policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(cancelled,true);assert.equal(stage,'cancel-requested');assert.equal(reruns,0);assert.equal(result.pending,true);
});

test('one automatic recovery retries the completed old attempt without switching all PRs hosted',async()=>{
 const f=fixture();let reruns=0;
 const api={get:async path=>path.endsWith('/actions/jobs/901')?{id:901,name:'test-server (24)',run_id:789,run_attempt:1,head_sha:head,status:'completed',conclusion:'cancelled'}:path.endsWith('/actions/runs/789')?{...f.run,status:'completed'}:f.api.get(path),post:async path=>{assert.ok(path.endsWith('/rerun'));reruns++;},patch:async()=>assert.fail('No global mode flip')};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}})};
 const result=await controller.fallbackOrdinary({api:routingVariables(api),policy,ci:{repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901},leases,automatic:true});
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
 const result=await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:routingVariables(f.api),transport:{healthy:async()=>true},
 runWorker:async(ci)=>{ids.push(ci.jobId);active++;peak=Math.max(peak,active);if(active===5)release();await ready;active--;return {code:0};}});
 assert.deepEqual(ids,[901,902,903,904,905]);assert.equal(peak,5);assert.equal(result.served,5);
 assert.equal(manual.inspect().slots[0].lease.resourceId,lease.resourceId);
 const pending=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 pending.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const next=[];await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{next.push(ci.jobId);return {code:0};}});
 assert.deepEqual(next,[902,903,904,905],'A pending job must not be admitted again on a different slot');
 const {ciRequest}=await import('./ci-identity.mjs'),finished=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot:2});
 const complete=(await controller.findAutomatic({api:routingVariables(f.api),policy,limit:6})).find(ci=>ci.jobId===905);
 const reserved=finished.reserveLocal(ciRequest('I',complete)).lease;finished.release(reserved,{resourceId:reserved.resourceId,absent:true});
 const after=[];await automaticTick({configuration:'/fixture/config.json',config:{state:root,hostGeneration:'test',slots:6,version:2,mode:'manual-slots',ci:policy},api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{after.push(ci.jobId);return {code:0};}});
 assert.deepEqual(after,[902,903,904],'Completed turn history must prevent replay even if the API still says queued');
});

test('the installed recovery entry also polls automatic CI after reconciling its pool',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {main}=await import('./manual.mjs'),{GithubApp}=await import('./github-app.mjs'),{CITransport}=await import('./transport.mjs');
 const healthy=CITransport.prototype.healthy;CITransport.prototype.healthy=async()=>true;t.after(()=>{CITransport.prototype.healthy=healthy;});
 const directory=mkdtempSync(tmpdir()+'/auto-entry-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,
 ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 let reads=0;const get=GithubApp.prototype.get;t.after(()=>{GithubApp.prototype.get=get;});
 GithubApp.prototype.get=async path=>{if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{}'};if(path.includes('/runs?'))return {total_count:0,workflow_runs:[]};assert.ok(path.endsWith('DISPOSABLE_TESTS_HEAD'));reads++;return {value:''};};
 const result=await main([config,'--once']);assert.equal(result,0);assert.equal(reads,1);
});

for(const obsolete of ['advanced','closed','unavailable'])test(`automatic recovery isolates an ${obsolete} PR without touching its new work`,async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {main}=await import('./manual.mjs'),{GithubApp}=await import('./github-app.mjs'),{CITransport}=await import('./transport.mjs');
 const healthy=CITransport.prototype.healthy;CITransport.prototype.healthy=async()=>true;t.after(()=>{CITransport.prototype.healthy=healthy;});
 const directory=mkdtempSync(tmpdir()+'/auto-stale-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const leases=new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,slot:1});
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'cancel-requested'});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 const originalGet=GithubApp.prototype.get,originalPost=GithubApp.prototype.post;t.after(()=>{GithubApp.prototype.get=originalGet;GithubApp.prototype.post=originalPost;});let selectionReads=0;
 const f=fixture();GithubApp.prototype.get=async path=>{if(path.includes('/runs?'))return {total_count:0,workflow_runs:[]};if(obsolete==='unavailable' && path.includes('/actions/jobs/'))throw new Error('Fixture API unavailable');return path.endsWith('DISPOSABLE_TESTS_HEAD')?(selectionReads++,{value:''}):path.includes('/actions/jobs/')?{id:901,name:'test-server (24)',run_id:789,run_attempt:1,head_sha:head,status:'completed',conclusion:'cancelled'}:path.endsWith('/pulls/12')?{number:12,state:obsolete==='closed'?'closed':'open',head:{sha:'5'.repeat(40),repo:{id:123}},base:{repo:{id:123}}}:{...f.run,status:'completed'};};
 GithubApp.prototype.post=async()=>assert.fail('Must never cancel or rerun obsolete work');
 assert.equal(await main([config,'--once']),0);assert.equal(await main([config,'--once']),0);
 assert.equal(selectionReads,2);if(obsolete==='unavailable')assert.equal(leases.inspect().ciInvocation.jobId,901);else assert.equal(leases.inspect().ciInvocation,undefined);
});

test('a PR with mismatched source evidence cannot stop another approved PR from using capacity',async()=>{
 const f=fixture(),get=f.api.get,otherHead='5'.repeat(40);
 const good={...f.run,id:790,head_sha:otherHead,pull_requests:[{number:13}],referenced_workflows:[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/13/merge',sha:execution}]};
 const job={...f.jobs[0],id:911,run_id:790,head_sha:otherHead,labels:['self-hosted','dt-123-790-1-test-server-24']};
 f.api.get=async path=>{
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,good]};
  if(path.endsWith('/actions/runs/790'))return good;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:1,jobs:[job]};
  if(path.endsWith('/pulls/13'))return {number:13,state:'open',head:{sha:otherHead,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/commits/'+otherHead))return {sha:otherHead,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.endsWith('/commits/'+head))return {sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}};
  return get(path);
 };
 const selected=await controller.findAutomatic({api:routingVariables(f.api),policy,limit:6});assert.deepEqual(selected.map(j=>j.jobId),[911]);
});


test('one pickup reads shared run evidence once before workers independently recheck admission',async()=>{
 const f=fixture(),get=f.api.get,reads=new Map();f.api.get=async path=>{reads.set(path,(reads.get(path)??0)+1);return get(path);};
 assert.equal((await controller.findAutomatic({api:routingVariables(f.api),policy,limit:6})).length,5);
 assert.equal(reads.get('/repos/fixture/waitron/actions/runs/789/attempts/1/jobs?per_page=30&page=1'),1);
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
 const running=automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',ci:policy},api:routingVariables(f.api),transport:{healthy:async()=>true},signal:cancel.signal}).then(value=>({value}),error=>({error}));
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
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(cancelled,1);assert.equal(reruns,1);assert.equal(result.retry,true);assert.equal(result.sourceSha,head);
});

test('the real CLI completes its automatic recovery import instead of exiting with unsettled await',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{spawnSync}=await import('node:child_process');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-cli-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const config=directory+'/configuration.json';writeFileSync(config,JSON.stringify({version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:directory,ci:{...policy,appEnv:directory+'/app.env',appKey:directory+'/app.pem'}}));
 const manual=new URL('./manual.mjs',import.meta.url),app=new URL('./github-app.mjs',import.meta.url),transport=new URL('./transport.mjs',import.meta.url);
 const program=`import assert from 'node:assert/strict';import {GithubApp} from ${JSON.stringify(app.href)};import {CITransport} from ${JSON.stringify(transport.href)};CITransport.prototype.healthy=async()=>true;GithubApp.prototype.get=async path=>{if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{}'};if(path.includes('/runs?'))return {total_count:0,workflow_runs:[]};assert.ok(path.endsWith('DISPOSABLE_TESTS_HEAD'));return {value:''}};process.argv=[process.execPath,${JSON.stringify(manual.pathname)},${JSON.stringify(config)},'--once'];await import(${JSON.stringify(manual.href)});console.log('CLI_FINISHED');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/CLI_FINISHED/);assert.doesNotMatch(result.stderr,/unsettled top-level await/);
});

test('an unhealthy or unreachable host selects hosted before polling or starting PR jobs',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{automaticTick}=await import('./control.mjs');
 for(const failure of ['unhealthy','unreachable']){
  const root=mkdtempSync(tmpdir()+'/auto-health-');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const {writeFileSync}=await import('node:fs');writeFileSync(root+'/mac-controller.lock','',{mode:0o600});
  const leases=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});let mode='server',checks=0,writes=0;
  const api={get:async path=>{if(path.includes('/runs?'))return {total_count:0,workflow_runs:[]};assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE') || path.endsWith('DISPOSABLE_TESTS_HEAD'),'Unexpected host health API read');return {value:path.endsWith('DISPOSABLE_TESTS_HEAD')?'':mode};},patch:async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE'));assert.equal(body.value,'hosted');mode=body.value;writes++;},post:async()=>assert.fail('Must not cancel or rerun a workflow')};
  const result=await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state:root,hostGeneration:'test',ci:policy},api:routingVariables(api),transport:{healthy:async()=>{checks++;if(failure==='unreachable')throw new Error('Host unreachable');return false;}},runWorker:async()=>assert.fail('Must not start a guest')});
  assert.equal(result.served,0);assert.equal(mode,'hosted');assert.equal(checks,1);assert.equal(writes,1);assert.ok(leases.inspect().slots.every(s=>s.state==='free' && !s.ciInvocation));
  for(let slot=0;slot<6;slot++)new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'full-'+slot,snapshot:'a'.repeat(64),argv:['true']});
  mode='server';await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state:root,hostGeneration:'test',ci:policy},api:routingVariables(api),transport:{healthy:async()=>assert.fail('A full healthy pool is busy, not unavailable')}});
  assert.equal(mode,'server');assert.equal(writes,1);
 }
});

for(const race of ['none','assigned','assigned-later','changed-label','advanced'])test(`refused source fallback handles ${race} race without running mismatched code`,async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-refused-'),state=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'test',slots:6,bootstrap:true});},{bootstrap:true});
 for(let i=0;i<6;i++)await withKernelLock(state+'/slot-'+i,async()=>({code:0}),{bootstrap:true});
 const f=fixture();f.jobs.splice(1);let cancelled=false,reruns=0,jobReads=0,pullReads=0;const get=f.api.get;
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.endsWith('/commits/'+head))return {sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.endsWith('/actions/jobs/901')){jobReads++;return {...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null,...(race==='assigned' || race==='assigned-later' && jobReads>1?{runner_id:42}:{}),...(race==='changed-label'?{labels:['self-hosted','dt-123-789-1-test-heavy-3']}: {})};}
  if(path.endsWith('/pulls/12') && race==='advanced' && pullReads++)return {number:12,state:'open',head:{sha:'5'.repeat(40),repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:cancelled?'completed':'in_progress'};
  return get(path);
 };
 f.api.post=async path=>{if(path.endsWith('/cancel'))cancelled=true;else if(path.endsWith('/rerun'))reruns++;else assert.fail(path);};
 f.api.patch=async()=>assert.fail('A refused source must not disable routing for other approved PRs');
 await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state,hostGeneration:'test',ci:policy},api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Mismatched source must never execute on the server')});
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
 const result=await reconcileManual({state,hostGeneration:'test',slots:6,slot:1,transport:{destroy:async()=>assert.fail('A refused job has no guest to remove')},ci:policy,api:routingVariables(f.api)});
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
 const running=automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>{healthChecks++;return true;}},runWorker:ci=>withAvailableSlot(config,async({leases})=>{
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
 await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Unavailable evidence cannot admit a server worker')});
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
  if(path.endsWith('/commits/'+head))return {sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:cancelled?'completed':'in_progress'};
  if(path.endsWith('/actions/jobs/901'))return {...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null};
  return get(path);
 };
 f.api.post=async path=>{assert.equal(started,true,'Known good work must start before refusal cleanup');if(path.endsWith('/cancel'))cancelled=true;else if(path.endsWith('/rerun'))reruns++;else assert.fail(path);};
 const result=await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{
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
  if(path.endsWith('/commits/'+head))return {sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.endsWith('/actions/jobs/901'))return {...f.jobs[0],status:++jobReads>=3?'completed':'queued',conclusion:jobReads>=3?'cancelled':null};
  if(path.endsWith('/actions/runs/789'))return {...f.run,status:settled?'completed':'in_progress'};
  return get(path);
 };
 f.api.post=async path=>{assert.ok(path.endsWith('/rerun'));reruns++;};
 await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async()=>assert.fail('Mismatched source')});
 const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6});
 assert.equal(leases.inspect().slots.filter(s=>s.ciInvocation?.ordinaryStage==='cancel-requested').length,1);assert.equal(reruns,0);
 settled=true;await reconcileManual({...config,transport:{},api:routingVariables(f.api)});
 assert.equal(reruns,1);assert.ok(leases.inspect().slots.every(s=>!s.ciInvocation));
 await reconcileManual({...config,transport:{},api:routingVariables(f.api)});assert.equal(reruns,1);
});

test('the real recovery CLI finishes a refused-source hosted retry without an import cycle',async t=>{
 const {writeFileSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
 const config=await refusalPool(t),configuration=config.state+'/configuration.json';
 writeFileSync(configuration,JSON.stringify({...config,host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:config.state,ci:{...policy,appEnv:config.state+'/app.env',appKey:config.state+'/app.pem'}}));
 const manual=new URL('./manual.mjs',import.meta.url),app=new URL('./github-app.mjs',import.meta.url),transport=new URL('./transport.mjs',import.meta.url);
 const program=`import assert from 'node:assert/strict';import {GithubApp} from ${JSON.stringify(app.href)};import {CITransport} from ${JSON.stringify(transport.href)};
 const head=${JSON.stringify(head)},execution=${JSON.stringify(execution)},workflow=${JSON.stringify(workflow)},policy=${JSON.stringify(policy)};
 const f=(${fixture.toString()})();const get=f.api.get;let cancelled=0,reruns=0,marker='{}';
 GithubApp.prototype.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/commits/'+head)?{sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}}:path.endsWith('/actions/jobs/901')?{...f.jobs[0],status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null}:path.endsWith('/actions/runs/789')?{...f.run,status:cancelled?'completed':'in_progress'}:get(path);
 GithubApp.prototype.patch=async(path,body)=>{assert.ok(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));marker=body.value;};
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
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true,wait:async()=>{}});
 assert.equal(forced,true,'An always-run summary must not hold a cancelled source in the runner queue');assert.equal(reruns,1);assert.equal(result.retry,true);
});


test('pickup counts a worker waiting for admission against free capacity',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 for(let slot=0;slot<4;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 let releaseFirst,active=0,peak=0;const first=new Promise(resolve=>{releaseFirst=resolve;}),results=[];
 const timer=setTimeout(releaseFirst,1000);t.after(()=>clearTimeout(timer));
 await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{
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
 const running=automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},recover:async()=>{
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
  if(path.endsWith('/commits/'+head))return {sha:'9'.repeat(40),commit:{tree:{sha:'4'.repeat(40)}}};
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
 const running=automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{
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
  settled=true;const {reconcileManual}=await import('./manual.mjs');await reconcileManual({...config,transport:{},api:routingVariables(f.api)});
  assert.equal(reruns,1);assert.ok(new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect().slots.every(slot=>!slot.ciInvocation));
 }
 }finally{clearTimeout(timeout);finish();releaseSibling();await sibling;}
});

function historicalFixture({headVersion=8,executionVersion=11,changedHead=false,foreign=false,oldest=false}={}){
 const f=fixture(),get=f.api.get,sha=n=>n.toString(16).padStart(40,'0'),bytes=n=>'reviewed workflow '+n;
 const records=Array.from({length:10},(_,i)=>({sha:sha(11-i),digest:createHash('sha256').update(bytes(11-i)).digest('hex')}));
 if(oldest)records[9]={sha:sha(1),digest:createHash('sha256').update(bytes(1)).digest('hex')};
 const trusted={...policy,workflowDigest:records[0].digest,workflowHistory:records};
 f.api.get=async path=>{
  if(path.endsWith('/git/ref/heads/main'))return {object:{sha:'e'.repeat(40)}};
  if(path.includes('/commits?'))return Array.from({length:10},(_,i)=>({sha:sha(11-i)}));
  if(path.includes('/compare/')){const commit=path.match(/compare\/([a-f0-9]{40})/)[1];return {status:foreign?'diverged':'ahead',merge_base_commit:{sha:foreign?'f'.repeat(40):commit}};}
  if(path.includes('/contents/')){
   const revision=path.split('?ref=')[1];const number=revision===head?headVersion:revision===execution?executionVersion:Number.parseInt(revision,16);
   return {encoding:'base64',content:Buffer.from(changedHead && revision===head?'PR-edited workflow':bytes(number)).toString('base64')};
  }
  return get(path);
 };
 return {...f,policy:trusted};
}

for(const [name,options,bytes] of [
 ['older head',{headVersion:8},'reviewed workflow 8'],
 ['edited head',{changedHead:true},'PR-edited workflow'],
 ['branch outside main',{foreign:true},'reviewed workflow 8'],
 ['older than the history window',{headVersion:1,oldest:true},'reviewed workflow 1']
])test(`automatic pickup binds the actual workflow digest for a same-repository ${name}`,async()=>{
 const f=historicalFixture(options),get=f.api.get,refused=[];
 f.api.get=async path=>{
  assert.ok(!path.includes('/compare/') && !path.includes('/commits?') && !path.endsWith('/git/ref/heads/main'),'Automatic trust must not depend on a main-history pin');
  return get(path);
 };
 const jobs=await controller.findAutomatic({api:routingVariables(f.api),policy:f.policy,limit:1,onRefused:value=>refused.push(value)});
 assert.deepEqual(jobs.map(ci=>ci.jobId),[901]);
 assert.equal(jobs[0].workflowDigest,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(refused,[]);
});

test('workflow history configuration cannot exceed ten immutable main versions or contain malformed pins',()=>{
 const f=historicalFixture();const config={version:2,mode:'manual-slots',slots:6,state:'/fixture/state',hostGeneration:'fixture',host:'fixture.invalid',recipe:'/fixture/recipe',repository:'/fixture/repo.git',ci:{...f.policy,appEnv:'/fixture/app.env',appKey:'/fixture/key'}};
 assert.doesNotThrow(()=>controller.validateCIConfig(config));
 for(const workflowHistory of [[...config.ci.workflowHistory,{sha:'f'.repeat(40),digest:'f'.repeat(64)}],[],[{sha:'bad',digest:'a'.repeat(64)}],[{sha:'a'.repeat(40),digest:'bad'}],[config.ci.workflowHistory[0],config.ci.workflowHistory[0]]])
  assert.throws(()=>controller.validateCIConfig({...config,ci:{...config.ci,workflowHistory}}),/history|workflow|pin|version/i);
});

test('a temporary workflow HTTP refusal leaves PRs for a later pickup without cancellation',async t=>{
 const {createServer}=await import('node:http'),{GithubApp}=await import('./github-app.mjs');
 const server=createServer((req,res)=>{res.statusCode=502;res.end('Temporary fixture failure');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const app=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});app.token=async()=>'synthetic';
 const f=fixture(),get=f.api.get,refused=[];
 f.api.get=path=>path.includes('/contents/')?app.get(path):get(path);
 assert.deepEqual(await controller.findAutomatic({api:routingVariables(f.api),policy,limit:1,onRefused:value=>refused.push(value)}),[]);
 assert.deepEqual(refused,[],'A temporary API refusal must not cancel the run');
});

for(const changed of ['repository','workflow-id','workflow-path','event','PR-head','PR-fork','contributor-approval'])test(`automatic workflow trust retains the ${changed} refusal`,async()=>{
 const f=fixture(),get=f.api.get;
 if(changed==='repository')f.run.repository.id=999;
 if(changed==='workflow-id')f.run.workflow_id=999;
 if(changed==='workflow-path')f.run.path='.github/workflows/foreign.yml';
 if(changed==='event')f.run.event='pull_request_target';
 f.api.get=async path=>{
  if(changed==='contributor-approval' && path.endsWith('fork-pr-contributor-approval'))return {approval_policy:'first_time_contributors'};
  const value=await get(path);
  if(path.endsWith('/pulls/12')){
   if(changed==='PR-head')value.head.sha='9'.repeat(40);
   if(changed==='PR-fork')value.head.repo.id=999;
  }
  return value;
 };
 assert.deepEqual(await controller.findAutomatic({api:routingVariables(f.api),policy,limit:1}),[]);
});

for(const [name,key] of [
 ['lint','lint-1'],['root-guards','root-guards-1'],['bundle-smoke','bundle-smoke-1'],['typecheck','typecheck-1'],
 ['test-setup','test-setup-1'],['test-staffing','test-staffing-1'],['test-bookings','test-bookings-1'],['test-media','test-media-1'],
 ['test-payments-stripe','test-payments-stripe-1'],['test-payments-sumup','test-payments-sumup-1'],['test-identity','test-identity-1'],['test-workforce','test-workforce-1'],
 ['test-light-a','test-light-a-1'],['test-light-b','test-light-b-1'],['test-fiscal-verifactu (4)','test-fiscal-verifactu-4'],['test-provisioning (6)','test-provisioning-6'],['mutation-shared (4)','mutation-shared-4'],
 ['test-venue-service (1)','test-venue-service-1'],['test-venue-service (2)','test-venue-service-2'],['test-venue-service (3)','test-venue-service-3'],['test-venue-service (4)','test-venue-service-4'],['test-adjustments','test-adjustments-1']
])test(`automatic pickup serves the routed ${name} label without changing its API name`,async()=>{
 const f=fixture(),get=f.api.get,job={id:901,name,run_id:789,run_attempt:1,head_sha:head,status:'queued',runner_id:null,labels:['self-hosted','dt-123-789-1-'+key]};
 f.api.get=async path=>path.includes('/jobs?')?{total_count:1,jobs:[job]}:get(path);
 const jobs=await controller.findAutomatic({api:routingVariables(f.api),policy,limit:1});assert.equal(jobs.length,1);assert.equal(jobs[0].jobKey,key);assert.equal(jobs[0].jobId,901);
});

// An invalid matrix neighbour must not abort pickup of a valid job in the same run.
test('automatic pickup skips an extra provisioning shard and serves its valid media neighbour',async()=>{
 const f=fixture(),get=f.api.get,refused=[];
 const jobs=[{id:901,name:'test-provisioning (7)',run_id:789,run_attempt:1,head_sha:head,status:'queued',runner_id:null,labels:['self-hosted','dt-123-789-1-test-provisioning-7']},
  {id:902,name:'test-media',run_id:789,run_attempt:1,head_sha:head,status:'queued',runner_id:null,labels:['self-hosted','dt-123-789-1-test-media-1']}];
 f.api.get=async path=>path.includes('/jobs?')?{total_count:2,jobs}:get(path);
 const found=await controller.findAutomatic({api:routingVariables(f.api),policy,limit:1,onRefused:value=>refused.push(value)});
 assert.deepEqual(found.map(ci=>[ci.jobId,ci.jobKey]),[[902,'test-media-1']]);assert.deepEqual(refused,[]);
});

for(const admitted of [false,true])test(`pickup ${admitted?'does not replay an admitted 75 result':'reconsiders a capacity-only rejection while another job stays active'}`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;f.jobs.splice(2);f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const counts=new Map(),stop=new AbortController();let finish;const held=new Promise(r=>finish=r);stop.signal.addEventListener('abort',finish,{once:true});const timer=setTimeout(()=>stop.abort(),2000);let failure;const waits=[];
 try{await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},signal:stop.signal,wait:async ms=>{waits.push(ms);await new Promise(r=>setTimeout(r,1));},runWorker:async ci=>{
  const count=(counts.get(ci.jobId)??0)+1;counts.set(ci.jobId,count);
  if(ci.jobId===901 && count===1){
   if(admitted){const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots:6,slot:0}),lease=leases.reserveLocal(ciRequest('I',ci)).lease;leases.release(lease,{resourceId:lease.resourceId,absent:true});setTimeout(finish,40);}
   return {code:75,reason:'capacity-busy'};
  }
  if(ci.jobId===902)await held;else finish();f.jobs.find(j=>j.id===ci.jobId).status='completed';return {code:0};
 }});}catch(error){failure=error;}finally{clearTimeout(timer);stop.abort();finish();}
 assert.deepEqual([...counts],[[901,admitted?1:2],[902,1]]);assert.equal(failure,undefined);assert.deepEqual(waits,admitted?[]:[30000]);
});

test('shutdown during an unadmitted worker wait records cancellation rather than a server failure',async t=>{
 const {automaticTick}=await import('./control.mjs');const config=await refusalPool(t),f=fixture(),get=f.api.get;f.jobs.splice(1);
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const stop=new AbortController(),events=[];t.mock.method(console,'log',value=>events.push(JSON.parse(value)));
 await assert.rejects(automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},signal:stop.signal,
  runWorker:async()=>({code:75,reason:'capacity-busy'}),wait:async(ms,value,{signal})=>{assert.equal(ms,30000);stop.abort();signal.throwIfAborted();}}),{name:'AbortError'});
 assert.deepEqual(events.map(e=>({code:e.code,reason:e.reason})),[{code:143,reason:'cancelled'}]);
});

for(const fault of ['inventory','run-http','marker-http','head-http','network','timeout','json','body-fixed','body-chunked','rate-retry-after','rate-reset','rate-429','rate-pr'])test(`a ${fault} failure does not hold free capacity behind a still-running sibling`,async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-inventory-'),root=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 await withKernelLock(root,async()=>{new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:2,bootstrap:true});},{bootstrap:true});
 let interrupted;
 if(fault.startsWith('body-') || fault.startsWith('rate-')){
  const {createServer}=await import('node:http'),{GithubApp}=await import('./github-app.mjs');
  const server=createServer((req,res)=>{
   if(fault.startsWith('rate-')){
    res.statusCode=fault==='rate-429'?429:403;
    if(fault==='rate-reset'){res.setHeader('x-ratelimit-remaining','0');res.setHeader('x-ratelimit-reset',String(Math.floor(Date.now()/1000)+90));}
    else res.setHeader('retry-after','75');
    res.end('{"message":"Rate limited"}');return;
   }
   if(fault==='body-fixed')res.setHeader('content-length','1000');
   res.writeHead(200,{'content-type':'application/json'});res.write('{"workflow_runs":[');
   setTimeout(()=>res.destroy(),30);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  interrupted=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});interrupted.token=async()=>'synthetic';
 }
 const f=fixture(),get=f.api.get,first=f.jobs[0],second=f.jobs[1],third=f.jobs[2];let scans=0,release,heldActive=true,thirdWhileHeld=false,injected=false;
 const held=new Promise(resolve=>release=()=>{heldActive=false;resolve();}),ids=[];
 const timeout=setTimeout(release,2000);t.after(()=>clearTimeout(timeout));
 f.api.get=async path=>{
  if(!injected && ids.includes(902) && ((fault==='marker-http' && path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')) || (fault==='head-http' && path.endsWith('DISPOSABLE_TESTS_HEAD')) || (!fault.startsWith('marker') && !fault.startsWith('head') && (fault==='rate-pr'?path.endsWith('/pulls/12'):path.includes('/runs?'))))){
   injected=true;
   if(interrupted)return interrupted.get(path);
   if(fault==='inventory')return {total_count:1,workflow_runs:[]};
   if(fault.endsWith('http'))throw Object.assign(new Error('Unavailable'),{status:503});
   if(fault==='network')throw new TypeError('fetch failed');
   if(fault==='timeout')throw new DOMException('Timed out','TimeoutError');
   throw new SyntaxError('Truncated JSON');
  }
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?') && path.includes('status=queued'))scans++;
  if(path.includes('/jobs?'))return {total_count:!injected?2:3,jobs:!injected?[first,second]:[first,second,third]};
  return get(path);
 };
 let failure;
 try{await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',state:root,hostGeneration:'test',slots:2,ci:policy},
  api:f.api,transport:{healthy:async()=>true},wait:async ms=>{if(fault.startsWith('rate-'))assert.ok(ms>=(fault==='rate-reset'?88000:74000) && ms<=(fault==='rate-reset'?90000:75000),'Respect the server retry time');else assert.equal(ms,30000);},runWorker:async ci=>{ids.push(ci.jobId);if(ci.jobId===901)await held;else if(ci.jobId===903){thirdWhileHeld=heldActive;release();}return {code:0};}});}
 catch(error){failure=error;}
 assert.equal(failure,undefined);assert.deepEqual(ids,[901,902,903]);assert.equal(thirdWhileHeld,true,'The third job starts before the first finishes');
});

test('automatic cancellation yields its persisted intent while GitHub is still cancelling',async()=>{
 const f=fixture(),get=f.api.get;let pending={ordinaryStage:'admitted',runId:789,attempt:1,jobId:901},posts=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.post=async path=>{assert.ok(path.endsWith('/cancel'));posts++;};
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases:{inspect:()=>({ciInvocation:pending}),setInvocation:value=>pending=value},automatic:true,
  wait:async()=>assert.fail('A remote cancellation must not hold the shared admission lock')});
 assert.deepEqual(result,{retry:false,pending:true});assert.equal(posts,1);assert.equal(pending.ordinaryStage,'cancel-requested');
});
for(const state of ['completed','running','assigned-queued','other-attempt','other-run'])test(`owned queued cancellation handles a ${state} sibling`,async()=>{
 const f=fixture(),get=f.api.get;let forced=false;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 const sibling={...f.jobs[1],status:state==='running'?'in_progress':state==='assigned-queued'?'queued':'completed',runner_id:['running','assigned-queued'].includes(state)?77:0,
  ...(state==='other-attempt'?{run_attempt:2}:state==='other-run'?{run_id:790}:{})};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:path.endsWith('/actions/runs/789')?{...f.run,status:forced?'completed':'queued'}:
  path.includes('/jobs?')?{total_count:2,jobs:[f.jobs[0],sibling]}:get(path);
 f.api.post=async path=>{if(path.endsWith('/force-cancel')){assert.equal(state,'completed');forced=true;}else assert.ok(path.endsWith('/rerun'));};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}}),setInvocation:()=>{}};
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true,wait:async()=>assert.fail('Recovery must yield')});
 assert.equal(forced,state==='completed');assert.equal(result.retry,state==='completed');if(state!=='completed')assert.equal(result.pending,true);
});

test('automatic force cancellation yields while the queued run is still settling',async()=>{
 const f=fixture(),get=f.api.get,posts=[];
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:path.endsWith('/actions/runs/789')?{...f.run,status:'queued'}:
  path.includes('/jobs?')?{total_count:1,jobs:[f.jobs[0]]}:get(path);
 f.api.post=async path=>posts.push(path);
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}})};
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true,wait:async()=>assert.fail('Force cancellation must release admission before waiting')});
 assert.deepEqual(posts,['/repos/fixture/waitron/actions/runs/789/force-cancel']);assert.deepEqual(result,{retry:false,pending:true});
});

for(const status of [401,403])for(const phase of ['runs','PR'])test(`pickup reports permanent HTTP ${status} failures during ${phase} reads`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{createServer}=await import('node:http'),{GithubApp}=await import('./github-app.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 const server=createServer((req,res)=>{res.statusCode=status;if(status===401)res.setHeader('retry-after','75');res.end('{"message":"Not authorised"}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const app=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});app.token=async()=>'synthetic';
 f.api.get=async path=>{if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};if(phase==='runs'?path.includes('/runs?'):path.endsWith('/pulls/12'))return app.get(path);return get(path);};
 await assert.rejects(automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>true}}),error=>error.status===status);
});

test('a rate-limited pickup with no workers waits until the supplied retry time',async t=>{
 const {automaticTick}=await import('./control.mjs');const config=await refusalPool(t),f=fixture(),get=f.api.get,waits=[];
 f.api.get=async path=>{if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};if(path.includes('/runs?'))throw Object.assign(new Error('Rate limited'),{status:403,retryAt:Date.now()+75000});return get(path);};
 const result=await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>true},wait:async ms=>waits.push(ms)});
 assert.deepEqual(result,{code:0,served:0,reason:'inventory-unavailable'});assert.equal(waits.length,1);assert.ok(waits[0]>=74000 && waits[0]<=75000);
});

for(const abort of [false,true])test(`a transient inventory failure without workers ${abort?'preserves shutdown':'returns for the next service tick'}`,async t=>{
 const {automaticTick}=await import('./control.mjs');const config=await refusalPool(t),f=fixture(),get=f.api.get,stop=new AbortController();
 f.api.get=async path=>{if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};if(path.includes('/runs?')){if(abort)stop.abort();throw Object.assign(new Error('Unavailable'),{status:503});}return get(path);};
 const result=automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>true},signal:stop.signal});
 if(abort)await assert.rejects(result,{name:'AbortError'});else assert.deepEqual(await result,{code:0,served:0,reason:'inventory-unavailable'});
});
for(const change of ['missing','short','foreign','new-attempt','assigned-target'])test(`queued cancellation refuses ${change} inventory authority`,async()=>{
 const f=fixture(),get=f.api.get;let posts=0;
 const ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?{...f.jobs[0],runner_id:change==='assigned-target'?77:0}:path.endsWith('/actions/runs/789')?{...f.run,status:'queued',run_attempt:change==='new-attempt'?3:1}:
 path.includes('/jobs?')?{total_count:change==='short'?2:1,jobs:change==='short' && !path.endsWith('page=1')?[]:[{...f.jobs[0],...(change==='missing'?{id:902}:change==='foreign'?{head_sha:'2'.repeat(40)}:{})}]}:get(path);
 f.api.post=async()=>{posts++;};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}})};
 const work=controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true});
 if(change==='foreign')assert.equal((await work).pending,true);else await assert.rejects(work,change==='short'?/Incomplete cancellation job inventory/:change==='assigned-target'?/unassigned queued job/:/inventory|missing|attempt/i);
 assert.equal(posts,0);
});

test('pickup does not hide malformed local state as a temporary API read',async t=>{
 const {automaticTick}=await import('./control.mjs'),{writeFileSync}=await import('node:fs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 writeFileSync(config.state+'/ledger/state.json','{');
 await assert.rejects(automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true}}),SyntaxError);
});

for(const mode of ['server','hosted'])test(`a full manual pool moves a waiting run to its exact hosted attempt and recovers after restart in ${mode} mode`,async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os');
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs'),{automaticTick}=await import('./control.mjs');
 const directory=mkdtempSync(tmpdir()+'/auto-overflow-'),root=directory+'/state';t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const config={version:2,mode:'manual-slots',slots:2,state:root,hostGeneration:'test',ci:policy};
 await withKernelLock(root,async()=>{new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:2,bootstrap:true});},{bootstrap:true});
 for(let slot=0;slot<2;slot++)new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:2,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 const leases=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:2}),before=leases.inspect();
 const f=fixture(),get=f.api.get,actions=[];let marker='{}';
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:mode};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.includes('/actions/jobs/'))return f.jobs.find(job=>path.endsWith('/'+job.id));
  return get(path);
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));marker=body.value;actions.push(['marker',JSON.parse(marker)]);};
 f.api.post=async path=>{
  if(path.endsWith('/cancel')){actions.push(['cancel',f.run.run_attempt]);f.run.status='completed';f.run.conclusion='cancelled';f.jobs.forEach(job=>{job.status='completed';job.conclusion='cancelled';});}
  else if(path.endsWith('/rerun')){actions.push(['rerun',f.run.run_attempt]);f.run.run_attempt++;f.run.status='queued';f.run.conclusion=null;f.jobs.forEach(job=>{job.run_attempt=2;job.labels=['ubuntu-latest'];job.status='queued';});}
  else assert.fail(path);
 };
 const tick=()=>automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>assert.fail('A busy pool needs no health probe')},runWorker:async()=>assert.fail('No free server slot')});
 await tick();
 assert.deepEqual(actions.slice(0,2),[['marker',{'789':2}],['cancel',1]]);
 await tick();assert.equal(actions.filter(([kind])=>kind==='rerun').length,1);assert.equal(f.run.run_attempt,2);
 await tick();assert.equal(marker,'{"789":2}');assert.equal(actions.filter(([kind])=>kind==='rerun').length,1);
 f.run.status='completed';f.run.conclusion='success';await tick();assert.equal(marker,'{}');
 assert.deepEqual(leases.inspect(),before,'Overflow must leave manual guests and their ownership untouched');
});

for(const state of ['cancel-not-sent','cancel-ack-lost','rerun-ack-lost','active-hosted','newer-attempt','stale-head','closed','foreign-repository','foreign-workflow','foreign-path','foreign-event','force-queued','running-sibling','incomplete-jobs'])test(`hosted overflow recovery handles ${state}`,async()=>{
 const f=fixture(),get=f.api.get,actions=[];let value='{"789":2}';
 if(['cancel-ack-lost','rerun-ack-lost'].includes(state)){f.run.status='completed';f.run.conclusion='cancelled';}
 if(state==='active-hosted')f.run.run_attempt=2;
 if(state==='newer-attempt')f.run.run_attempt=3;
 if(state==='foreign-repository')f.run.repository.id=987;
 if(state==='foreign-workflow')f.run.workflow_id=987;
 if(state==='foreign-path')f.run.path='other.yml';
 if(state==='foreign-event')f.run.event='workflow_run';
 if(['force-queued','running-sibling','incomplete-jobs'].includes(state)){f.run.status='queued';f.jobs[0].status='completed';f.jobs[0].conclusion='cancelled';}
 if(state==='running-sibling'){f.jobs[1].status='in_progress';f.jobs[1].runner_id=42;}
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value};
  if(path.endsWith('/pulls/12') && ['stale-head','closed'].includes(state))return {number:12,state:state==='closed'?'closed':'open',head:{sha:state==='stale-head'?'a'.repeat(40):head,repo:{id:123}},base:{repo:{id:123}}};
  if(path.includes('/jobs?') && state==='incomplete-jobs')return {total_count:7,jobs:f.jobs};
  return get(path);
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));value=body.value;};
 f.api.post=async path=>{actions.push(path.split('/').at(-1));if(path.endsWith('/rerun')){f.run.run_attempt=2;f.run.status='queued';if(state==='rerun-ack-lost')throw new Error('Reply lost');}};
 const recover=()=>controller.recoverHostedAttempts({api:f.api,policy});
 if(state.startsWith('foreign-') || state==='incomplete-jobs'){await assert.rejects(recover());assert.deepEqual(actions,[]);return;}
 if(state==='rerun-ack-lost'){await assert.rejects(recover(),/Reply lost/);await recover();}
 else await recover();
 const expected=state==='cancel-not-sent'?['cancel']:state==='force-queued'?['force-cancel']:['cancel-ack-lost','rerun-ack-lost'].includes(state)?['rerun']:[];
 assert.deepEqual(actions,expected);
 assert.equal(value,['newer-attempt','stale-head','closed','running-sibling'].includes(state)?'{}':'{"789":2}');
});

test('full-pool overflow preserves a run already preparing a guest before runner assignment',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 for(let slot=1;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots:config.slots,slot:0});
 const ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:ci.runId,attempt:1,jobId:ci.jobId,ordinaryStage:'admitted'});
 let writes=0,posts=0,marker='{}';
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/actions/jobs/')?f.jobs.find(job=>path.endsWith('/'+job.id)):get(path);
 f.api.patch=async(path,body)=>{writes++;marker=body.value;};f.api.post=async()=>{posts++;};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,runWorker:async()=>assert.fail('No slot is free'),transport:{healthy:async()=>true}});
 assert.equal(writes,0);assert.equal(posts,0);
});

for(const ownership of ['local','other controller'])test(`a busy run with more than sixteen waiting jobs on ${ownership} cannot hide an untouched run from overflow`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 for(let slot=1;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 const first=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:0});
 if(ownership==='local')first.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:999,ordinaryStage:'admitted'});
 else first.reserveLocal({lane:'I',turn:'manual-0',snapshot:'a'.repeat(64),argv:['true']});
 const run={...f.run,id:790,event:'workflow_dispatch',pull_requests:[]},job={...f.jobs[0],id:1001,run_id:790,name:'server-probe',labels:['self-hosted','dt-123-790-1-server-probe-1']};
 f.jobs.splice(0,f.jobs.length,...Array.from({length:20},(_,i)=>({...job,id:901+i,run_id:789,name:`test-server (${i+1})`,labels:['self-hosted',`dt-123-789-1-test-server-${i+1}`]})));
 if(ownership==='other controller'){f.jobs[0].status='in_progress';f.jobs[0].runner_id=42;}
 const actions=[];let marker='{}';
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,run]};
  if(path.endsWith('/runs/790'))return run;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:1,jobs:[job]};
  if(path.endsWith('/actions/jobs/1001'))return job;
  if(path.includes('/actions/jobs/'))return f.jobs.find(j=>path.endsWith('/'+j.id));
  return get(path);
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));marker=body.value;};
 f.api.post=async path=>{actions.push(path);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,runWorker:async()=>assert.fail('No slot is free'),transport:{healthy:async()=>true}});
 assert.equal(marker,'{"790":2}');
 assert.deepEqual(actions,['/repos/fixture/waitron/actions/runs/790/cancel']);
});

test('hosted overflow recovery still requires external contributor approval before retrying',async()=>{
 const f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2}'}:path.endsWith('fork-pr-contributor-approval')?{approval_policy:'first_time_contributors'}:get(path);
 f.run.status='completed';f.run.conclusion='cancelled';
 let posts=0;f.api.post=async()=>{posts++;};
 await assert.rejects(controller.recoverHostedAttempts({api:f.api,policy}),/contributor approval/);assert.equal(posts,0);
});
for(const failure of ['write','readback','assigned','advanced'])test(`overflow does not cancel when ${failure} authority is missing`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let posts=0;
 f.api.patch=async()=>{if(failure==='write')throw new Error('Write refused');};f.api.post=async()=>{posts++;};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 if(failure==='assigned')f.jobs[0].runner_id=42;
 if(failure==='advanced')f.run.run_attempt=2;
 await assert.rejects(controller.overflowOrdinary({api:f.api,policy,ci}));assert.equal(posts,0);
});

for(const state of ['running','completed','assigned','young','late-assignment','waiting','cancelled'])test(`overflow preserves a ${state} server run`,async()=>{
 const f=fixture(),get=f.api.get;f.run.created_at=new Date(Date.now()-120000).toISOString();
 const ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let writes=0,posts=0,marker='{}';
 const start=()=>{f.jobs[1].runner_id=42;f.jobs[1].status=state==='completed'?'completed':state==='assigned'?'queued':'in_progress';};
 if(['running','completed','assigned'].includes(state))start();
 if(state==='young')f.run.created_at=new Date().toISOString();
 if(state==='waiting')f.jobs[1].status='waiting';
 if(state==='cancelled'){f.jobs[1].status='completed';f.jobs[1].conclusion='cancelled';}
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{writes++;marker=body.value;if(state==='late-assignment')start();};f.api.post=async()=>{posts++;};
 await controller.overflowOrdinary({api:f.api,policy,ci});
 assert.equal(posts,0);assert.equal(marker,'{}');if(state!=='late-assignment')assert.equal(writes,0);
});

for(const obsolete of ['deleted','merged'])test(`hosted overflow retires a ${obsolete} run without stopping other recovery`,async()=>{
 const f=fixture(),get=f.api.get,posts=[];let value='{"789":2,"790":2}';
 const other={...f.run,id:790,event:'push',pull_requests:[],status:'completed',conclusion:'cancelled'};
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value};
  if(path.endsWith('/runs/789')){if(obsolete==='deleted')throw Object.assign(new Error('Not found'),{status:404});return {...f.run,pull_requests:[]};}
  if(path.endsWith('/runs/790'))return other;
  return get(path);
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));value=body.value;};
 f.api.post=async path=>{posts.push(path);};
 await controller.recoverHostedAttempts({api:f.api,policy});
 assert.equal(value,'{"790":2}');assert.deepEqual(posts,['/repos/fixture/waitron/actions/runs/790/rerun']);
});

test('a malformed hosted-routing value fails loudly instead of reporting a temporary inventory pause',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":'}:get(path);
 await assert.rejects(automaticTick({configuration:'/fixture/config',config,api:f.api}),/Invalid hosted attempt routing/);
});

for(const status of [422,502,403])test(`a recovery ${status} refusal leaves other runs eligible for pickup`,async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get,served=[],waits=[];
 const recovering={...f.run,id:790,event:'push',pull_requests:[],status:'completed',conclusion:'cancelled'};
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"790":2}'}:path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/runs/790')?recovering:get(path);
 f.api.post=async path=>{assert.ok(path.endsWith('/790/rerun'));throw Object.assign(new Error('Rerun refused'),{status,...(status===403?{retryAt:Date.now()+75000}:{})});};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},wait:async ms=>{waits.push(ms);},runWorker:async ci=>{served.push(ci.jobId);return {code:0};}});
 assert.deepEqual(served,[901,902,903,904,905]);
 if(status===403)assert.ok(waits.length>0 && waits.every(ms=>ms>=74000 && ms<=75000));
});

for(const fault of ['finished','advanced','502','rate'])test(`an overflow ${fault} race does not hide the next run`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 for(let slot=0;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 const run={...f.run,id:790,event:'push',pull_requests:[]},job={...f.jobs[0],id:1001,run_id:790,labels:['self-hosted','dt-123-790-1-test-server-24']};
 let marker='{}',reads=0;const posts=[],waits=[];
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?0:2,workflow_runs:path.includes('status=queued')?[]:[f.run,run]};
  if(path.endsWith('/runs/789') && ++reads>1){
   if(fault==='finished')return {...f.run,status:'completed'};
   if(fault==='advanced')return {...f.run,head_sha:'f'.repeat(40)};
   throw Object.assign(new Error('Temporary overflow failure'),{status:fault==='rate'?403:502,...(fault==='rate'?{retryAt:Date.now()+75000}:{})});
  }
  if(path.endsWith('/runs/790'))return run;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:1,jobs:[job]};
  if(path.endsWith('/actions/jobs/1001'))return job;
  if(path.includes('/actions/jobs/'))return f.jobs.find(j=>path.endsWith('/'+j.id));
  return get(path);
 };
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,wait:async ms=>{waits.push(ms);},runWorker:async()=>assert.fail('Pool is full')});
 assert.equal(marker,'{"790":2}');assert.deepEqual(posts,['/repos/fixture/waitron/actions/runs/790/cancel']);
 if(fault==='rate')assert.ok(waits.length===1 && waits[0]>=74000 && waits[0]<=75000);
});

for(const clock of ['attempt','job'])test(`overflow gives a newly queued ${clock} its own minute`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let marker='{}';const posts=[];
 if(clock==='attempt')f.run.run_started_at=new Date().toISOString();
 else f.jobs[0].started_at=new Date().toISOString();
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await controller.overflowOrdinary({api:f.api,policy,ci});assert.equal(marker,'{}');assert.deepEqual(posts,[]);
});

test('overflow leaves a workflow without hosted-attempt routing on the server',async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let marker='{}';const posts=[];
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.includes('/contents/')?{encoding:'base64',content:Buffer.from('legacy workflow').toString('base64')}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await controller.overflowOrdinary({api:f.api,policy,ci});assert.equal(marker,'{}');assert.deepEqual(posts,[]);
});

test('a rate-limit callback stops recovery reads until its caller can release the lock and wait',async()=>{
 const f=fixture(),get=f.api.get,reads=[];
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{"789":2,"790":2}'};
  if(path.endsWith('/runs/789') || path.endsWith('/runs/790')){reads.push(path);throw Object.assign(new Error('Rate limited'),{status:403,retryAt:Date.now()+75000});}
  return get(path);
 };
 const errors=[];
 await controller.recoverHostedAttempts({api:f.api,policy,onError:(error,id)=>{errors.push(id);return false;}});
 assert.deepEqual(reads,['/repos/fixture/waitron/actions/runs/789']);assert.deepEqual(errors,[789]);
});

for(const ownership of ['invocation','lease'])test(`overflow recovery preserves a live ${ownership} before assignment`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 const slot=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:0});
 if(ownership==='lease')slot.reserveLocal(ciRequest('I',ci));
 else slot.setInvocation({nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'admitted'});
 const posts=[];
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2,"790":2}'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/runs/790')?{...f.run,id:790,event:'push',pull_requests:[],run_attempt:2}:get(path);
 f.api.post=async path=>{posts.push(path);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true}});assert.deepEqual(posts,[]);
});

test('overflow rechecks free capacity after scanning and before writing its marker',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 const slots=Array.from({length:6},(_,slot)=>new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}));
 const reserved=slots.map((slot,i)=>slot.reserveLocal({lane:'I',turn:'manual-'+i,snapshot:'a'.repeat(64),argv:['true']}).lease);
 let released=false;const writes=[];
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runs?') && !released){released=true;assert.equal(slots[0].release(reserved[0],{absent:true,resourceId:reserved[0].resourceId}),true);}
  if(path.endsWith('/actions/jobs/901'))return f.jobs[0];
  return get(path);
 };
 f.api.patch=async(path)=>{writes.push(path);};f.api.post=async path=>{writes.push(path);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api});assert.equal(released,true);assert.deepEqual(writes,[]);
});

test('an exact marked hosted attempt is excluded from server pickup even if a job still has server labels',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.run.run_attempt=2;f.jobs.forEach(job=>{job.run_attempt=2;job.labels=job.labels.map(label=>label.replace('-789-1-','-789-2-'));});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2}'}:path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 let starts=0;await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async()=>{starts++;return {code:0};}});
 assert.equal(starts,0);
});

test('manual selected-head admission refuses changed workflow bytes that automatic pickup may accept',async()=>{
 const f=fixture(),get=f.api.get;
 f.api.get=async path=>path.includes('/contents/')?{encoding:'base64',content:Buffer.from(workflow+' changed').toString('base64')}:get(path);
 await assert.rejects(controller.findOrdinary({api:f.api,policy,approvedHead:head,runId:789,jobId:901}),/workflow definition changed/);
});

for(const mode of ['hosted','server'])test(`automatic pickup serves existing server labels while new runs use ${mode}`,async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get,served=[];
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:mode}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 f.api.patch=async()=>assert.fail('Pickup must not change routing mode');
 const result=await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{served.push(ci.jobId);return {code:0};}});
 assert.deepEqual(served,[901,902,903,904,905]);assert.equal(result.served,5);
});

for(const mode of ['hosted','server'])test(`a retained manual selection leaves automatic pickup closed in ${mode} mode`,async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:mode}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:head}:get(path);
 const tick=()=>automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>assert.fail('A selected head must not start automatic host work')},runWorker:async()=>assert.fail('No automatic worker for a manual selection')});
 if(mode==='hosted')assert.deepEqual(await tick(),{code:0,served:0});
 else await assert.rejects(tick(),/unrestricted same-repository routing/);
});

test('a host outage does not rewrite an already hosted routing setting',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'hosted'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 f.api.patch=async()=>assert.fail('Hosted mode must not be rewritten');
 for(let i=0;i<2;i++)assert.deepEqual(await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>false},runWorker:async()=>assert.fail('No guest on a down host')}),{code:0,served:0,route:'hosted',reason:'host-unavailable'});
});

test('the real automatic job entry serves a labelled job in hosted mode and cleans its slot',async t=>{
 const {main}=await import('./control.mjs'),{GithubApp}=await import('./github-app.mjs'),{CITransport}=await import('./transport.mjs'),{LocalLeases}=await import('./leases.mjs'),{writeFileSync}=await import('node:fs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,events=[];let registered=false,completed=false;
 Object.assign(config,{host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:config.state,ci:{...policy,appEnv:config.state+'/app.env',appKey:config.state+'/app.pem'}});
 const file=config.state+'/config.json';writeFileSync(file,JSON.stringify(config));
 const override=(object,key,value)=>{const old=object[key];object[key]=value;t.after(()=>{object[key]=old;});};
 override(GithubApp.prototype,'get',async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'hosted'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/runners?'))return {total_count:registered?1:0,runners:registered?[{id:1001,name:'dt-123-789-1-901'}]:[]};
  if(path.endsWith('/actions/jobs/901'))return {...f.jobs[0],status:completed?'completed':'queued',conclusion:completed?'success':null,runner_id:completed?1001:0,runner_name:completed?'dt-123-789-1-901':null};
  return get(path);
 });
 override(GithubApp.prototype,'post',async(path,body)=>{assert.ok(path.endsWith('/runners/generate-jitconfig'));assert.deepEqual(body.labels,['self-hosted','dt-123-789-1-test-server-24']);registered=true;events.push('register');return {runner:{id:1001,name:'dt-123-789-1-901'},encoded_jit_config:'synthetic'};});
 override(GithubApp.prototype,'delete',async path=>{assert.ok(path.endsWith('/runners/1001'));registered=false;events.push('deregister');});
 for(const method of ['healthy','transfer','prepare','execute','destroy','inspect'])override(CITransport.prototype,method,async lease=>{
  if(method==='healthy')return true;
  events.push(method);
  if(method==='execute'){completed=true;return 0;}
  if(method==='inspect')return {resourceId:lease.resourceId,absent:true};
 });
 const result=await main([file,'job','789','901']);assert.equal(result.code,0);assert.equal(result.cleanup,'absent');
 assert.deepEqual(events,['transfer','prepare','register','execute','destroy','inspect','deregister']);
 assert.ok(new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect().slots.every(slot=>slot.state==='free'&&!slot.ciInvocation));
});

for(const [label,conclusion,runner,late,wantCancel] of [
 ['skipped without runner', 'skipped',null,false,true],['skipped with zero runner','skipped',0,false,true],
 ['skipped after assignment','skipped',42,false,false],['failed without runner','failure',null,false,false],
 ['cancelled without runner','cancelled',null,false,false],['assigned after marker','skipped',null,true,false]
])test(`overflow handles a completed ${label}`,async()=>{
 const f=fixture(),get=f.api.get,api=routingVariables(f.api),ci=(await controller.findAutomatic({api,policy,limit:1}))[0];
 const skipped={...f.jobs[0],id:999,name:'server-probe',labels:['self-hosted','dt-123-789-1-server-probe-1'],status:'completed',conclusion,runner_id:runner};
 f.jobs.push(skipped);let posts=0,marker='{}';
 f.api.get=async path=>path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));marker=body.value;if(late)skipped.runner_id=42;};
 f.api.post=async path=>{assert.equal(path,'/repos/fixture/waitron/actions/runs/789/cancel');assert.equal(marker,'{"789":2}');posts++;};
 await controller.overflowOrdinary({api:f.api,policy,ci});
 assert.equal(posts,wantCancel?1:0);assert.equal(marker,wantCancel?'{"789":2}':'{}');
});

function pagedJobFixture(fault){
 const f=fixture(),get=f.api.get,target=f.jobs[0],pages=[];
 f.jobs.splice(0,f.jobs.length,...Array.from({length:83},(_,index)=>({...target,id:1000+index,name:'completed job',status:'completed',runner_id:1,labels:['ubuntu-latest']})),target);
 f.api.get=async(path,options)=>{
  if(!path.includes('/jobs?'))return get(path,options);
  const params=new URL('https://fixture.invalid'+path).searchParams,size=Number(params.get('per_page')),page=Number(params.get('page')??1);
  if(size>30)throw new Error('HTTP 502 on 100-record job pages');
  pages.push(page);
  let jobs=f.jobs.slice((page-1)*size,page*size);
  if(page===2 && fault==='empty')jobs=[];
  if(page===2 && fault==='duplicate')jobs=[f.jobs[0],...jobs.slice(1)];
  return {total_count:f.jobs.length+(page===2 && fault==='changed-count'?1:0),jobs};
 };
 return {...f,target,pages};
}

test('automatic pickup admits a page-three job when 100-record job pages answer 502',async()=>{
 const f=pagedJobFixture();
 const admitted=await controller.findAutomatic({api:f.api,policy,limit:1});
 assert.deepEqual(admitted.map(ci=>[ci.runId,ci.jobId,ci.jobKey]),[[789,901,'test-server-24']]);
 assert.deepEqual(f.pages,[1,2,3]);
});
for(const fault of ['empty','duplicate','changed-count'])test(`a ${fault} later job page refuses ordinary admission`,async()=>{
 const f=pagedJobFixture(fault);
 await assert.rejects(controller.findOrdinary({api:f.api,policy,approvedHead:head,runId:789,jobId:901,automatic:true}),/job inventory/);
});

test('force cancellation reads the assigned sibling on page three before changing the run',async()=>{
 const f=pagedJobFixture(),get=f.api.get;
 f.run.status='queued';f.jobs[0]=f.target;
 f.jobs[f.jobs.length-1]={...f.target,id:2000,status:'in_progress',runner_id:77};
 f.api.get=async(path,options)=>path.endsWith('/actions/jobs/901')?f.target:get(path,options);
 f.api.post=async()=>assert.fail('An assigned sibling must prevent cancellation');
 const result=await controller.cancelCIJob({api:f.api,repository:policy.repository,ci:{repositoryId:123,workflowId:456,workflowSha:head,runId:789,attempt:1,jobId:901},force:true});
 assert.deepEqual(result,{pending:true});assert.deepEqual(f.pages,[1,2,3]);
});

for(const count of [1000,1001])test(`force cancellation preserves the ${count}-job inventory boundary`,async()=>{
 const f=pagedJobFixture(),get=f.api.get;let posts=0;
 f.run.status='queued';
 f.jobs.splice(0,f.jobs.length,f.target,...Array.from({length:count-1},(_,index)=>({...f.target,id:1000+index,status:'completed',runner_id:0})));
 f.api.get=async(path,options)=>path.endsWith('/actions/jobs/901')?f.target:get(path,options);
 f.api.post=async path=>{assert.ok(path.endsWith('/force-cancel'));posts++;f.run.status='completed';};
 const work=controller.cancelCIJob({api:f.api,repository:policy.repository,ci:{repositoryId:123,workflowId:456,workflowSha:head,runId:789,attempt:1,jobId:901},force:true});
 if(count===1000){await work;assert.equal(posts,1);assert.equal(f.pages.length,34);}
 else {await assert.rejects(work,/Incomplete cancellation job inventory/);assert.equal(posts,0);}
});

for(const assigned of [true,false])test(`overflow reads the page-three sibling before ${assigned?'preserving':'cancelling'} the run`,async()=>{
 const f=pagedJobFixture(),get=f.api.get,posts=[];
 f.jobs[82]={...f.target,id:2000,status:assigned?'in_progress':'queued',runner_id:assigned?77:0};
 f.api.get=async(path,options)=>path.endsWith('/actions/jobs/901')?f.target:get(path,options);
 f.api.post=async path=>{posts.push(path);f.run.status='completed';};
 const api=routingVariables(f.api),ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 await controller.overflowOrdinary({api,policy,ci});
 assert.deepEqual(posts,assigned?[]:['/repos/fixture/waitron/actions/runs/789/cancel']);
 assert.deepEqual(await controller.hostedAttempts({api,policy}),assigned?{}:{789:2});
});

for(const assigned of [true,false])test(`hosted-attempt recovery reads the page-three sibling before ${assigned?'retiring':'cancelling'} the run`,async()=>{
 const f=pagedJobFixture(),posts=[];f.run.status='queued';
 f.jobs[82]={...f.target,id:2000,status:assigned?'in_progress':'queued',runner_id:assigned?77:0};
 f.api.post=async path=>{posts.push(path);};
 const api=routingVariables(f.api);
 await api.patch('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS',{name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:'{"789":2}'});
 assert.deepEqual(await controller.recoverHostedAttempts({api,policy}),assigned?{}:{789:2});
 assert.deepEqual(posts,assigned?[]:['/repos/fixture/waitron/actions/runs/789/force-cancel']);
 assert.deepEqual(f.pages,[1,2,3]);
});

for(const success of [true,false])test(`hosted-retry qualification checks the ${success?'successful':'failed'} summary on page three`,async()=>{
 const f=pagedJobFixture();Object.assign(f.run,{run_attempt:2,status:'completed',conclusion:'success'});
 for(const job of f.jobs)Object.assign(job,{run_attempt:2,status:'completed',conclusion:'success',runner_id:42,labels:['ubuntu-latest']});
 f.jobs[0].name='typecheck';f.jobs[83].name='summary';f.jobs[83].conclusion=success?'success':'failure';
 f.api.jobLog=async()=>`git log -1 --format=%H\n${head}`;
 const result=controller.qualifyOrdinaryHosted({api:f.api,policy,retry:{runId:789,sourceSha:head,previousAttempt:1}});
 if(success)assert.deepEqual(await result,{runId:789,attempt:2,sourceSha:head,sourceTree:'4'.repeat(40),route:'hosted',typecheck:1000,summary:901});
 else await assert.rejects(result,/Hosted retry summary did not qualify/);
 assert.deepEqual(f.pages,[1,2,3]);
});

for(const abort of [false,true])test(`job pages ${abort?'stop after an abort':'all receive the caller signal'}`,async()=>{
 const f=pagedJobFixture(),get=f.api.get,stop=new AbortController(),signals=[];
 f.api.get=async(path,options)=>{
  if(path.includes('/jobs?')){signals.push(options?.signal);assert.equal(options?.signal,stop.signal);options.signal.throwIfAborted();}
  const answer=await get(path,options);
  if(abort && path.includes('/jobs?'))stop.abort();
  return answer;
 };
 const result=controller.findOrdinary({api:f.api,policy,approvedHead:head,runId:789,jobId:901,automatic:true,signal:stop.signal});
 if(abort){await assert.rejects(result,{name:'AbortError'});assert.deepEqual(f.pages,[1]);}
 else {assert.equal((await result).jobId,901);assert.equal(signals.length,3);assert.deepEqual(f.pages,[1,2,3]);}
});
