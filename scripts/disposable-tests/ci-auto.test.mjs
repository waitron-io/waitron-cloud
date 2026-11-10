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
  if(key==='get')return (path,...args)=>path.endsWith('/DISPOSABLE_TESTS_CAPACITY')?Promise.resolve({value:stored.capacity??''}):path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?Promise.resolve({value:stored.value}):target.get(path,...args);
  if(key==='patch')return (path,body,...args)=>{
   if(path.endsWith('/DISPOSABLE_TESTS_CAPACITY')){stored.capacity=body.value;return Promise.resolve(null);}
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
  if(path.includes('/pulls?state=open')){const pull=await api.get('/repos/fixture/waitron/pulls/12');return pull.state==='open'?[pull]:[];}
 if(path.endsWith('/commits/'+head+'/pulls'))return [{number:12}];
 if(path.endsWith('/pulls/12'))return {number:12,state:'open',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}};
  if(path==='/repos/fixture/waitron')return {id:123,full_name:policy.repository};
  throw new Error('Unexpected '+path);
 }};
 return {run,jobs,api,local:()=>({slots:6,busy:6,owned:new Set()})};
}
for(const consumer of ['findAutomatic','overflowInventory'])for(const persistent of [false,true])test(`${consumer} ${persistent?'bounds repeated mismatches':'rereads a mismatched run inventory'}`,async()=>{
 const f=fixture(),get=f.api.get,signal=new AbortController().signal;let reads=0;
 f.api.get=async(path,options)=>{
  if(path.includes('/runs?') && path.includes('status=queued')){
   assert.equal(options.signal,signal);reads++;
   if(persistent || reads===1)return {total_count:1,workflow_runs:[]};
   return {total_count:1,workflow_runs:[f.run]};
  }
  return get(path,options);
 };
 const result=controller[consumer]({api:f.api,policy,limit:6,signal});
 if(persistent)await assert.rejects(result,{message:consumer==='findAutomatic'?'Incomplete automatic run inventory':'Incomplete hosted run inventory'});
 else if(consumer==='findAutomatic')assert.deepEqual((await result).map(ci=>ci.jobId),[901,902,903,904,905]);
 else assert.deepEqual([...(await result)].map(([id,{jobs}])=>[id,jobs.map(job=>job.id)]),[[789,[901,902,903,904,905]]]);
 assert.equal(reads,persistent?3:2);
});
for(const consumer of ['findAutomatic','overflowInventory'])for(const fault of ['http','shape','oversized','negative',...(consumer==='overflowInventory'?['duplicate']:[])])test(`${consumer} does not reread ${fault} run inventories`,async()=>{
 const f=fixture(),get=f.api.get;let reads=0;
 f.api.get=async(path,options)=>{
  if(path.includes('/runs?') && path.includes('status=queued')){
   reads++;
   if(fault==='http')throw Object.assign(new Error('Unavailable'),{status:503});
   if(fault==='shape')return {total_count:1,workflow_runs:null};
   if(fault==='duplicate')return {total_count:2,workflow_runs:[f.run,f.run]};
   return {total_count:fault==='oversized'?101:-1,workflow_runs:[]};
  }
  return get(path,options);
 };
 await assert.rejects(controller[consumer]({api:f.api,policy,limit:6}),fault==='shape' && consumer==='overflowInventory'?{message:'Incomplete hosted run inventory'}:undefined);
 assert.equal(reads,1);
});
for(const healthy of [true,false])test(`capacity publication counts usable occupancy and distinct queues with healthy=${healthy}`,async()=>{
 const f=fixture(),get=f.api.get;let published='';
 f.jobs.push(...Array.from({length:6},(_,i)=>({...f.jobs[0],id:1000+i,labels:['ubuntu-latest'],status:i<2?'in_progress':i===5?'pending':'queued'})));
 const snapshot=await controller.overflowInventory({api:f.api,policy});
 f.api.get=async path=>path.endsWith('/DISPOSABLE_TESTS_CAPACITY')?{value:published}:get(path);
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('/DISPOSABLE_TESTS_CAPACITY'));published=body.value;};
 const state={slots:[{state:'running',ciInvocation:{jobId:901}},{state:'running',lease:{lane:'I'}},{state:'free'},
  {state:'quarantined',lease:{ci:{jobId:902}}},{state:'free',ciInvocation:{jobId:903}},{state:'free',orphanRunners:[{}]}]};
 assert.equal(typeof controller.publishCapacity,'function');
 await controller.publishCapacity({api:f.api,policy,state,snapshot,healthy,now:123000});
 assert.deepEqual(JSON.parse(published),{observedAt:123000,slots:healthy?4:0,serverRunning:healthy?3:0,serverWaiting:2,hostedRunning:2,hostedWaiting:4});
});
for(const action of ['overflow','recover'])for(const [name,status,runner,blocked,conclusion,recovery] of [
 ['bundle-smoke','in_progress',7,true,undefined,'cancel'],['bundle-smoke','queued',7,true,undefined,'cancel'],
 ['bundle-smoke','in_progress',0,true,undefined,'force-cancel'],['server-queue-watchdog','in_progress',7,false,undefined,'cancel'],
 ['server-queue-watchdog-copy','in_progress',7,true,undefined,'cancel'],['changes','completed',7,false,'success','force-cancel'],
 ['changes','completed',7,true,'failure','force-cancel'],['bundle-smoke','completed',7,true,'success','force-cancel']
])test(`${action==='overflow'?'overflow protects useful work':'recovery retains its owned intent'}: ${name} ${status} runner ${runner}`,async()=>{
 const f=fixture(),ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0],get=f.api.get,posts=[];
 f.jobs.push({...f.jobs[0],id:999,name,status,conclusion,runner_id:runner,labels:['ubuntu-latest']});
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.post=async path=>{posts.push(path);};
 const api=routingVariables(f.api);
 if(action==='overflow')await controller.overflowOrdinary({local:f.local,api,policy,ci});
 else{
  await api.patch('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS',{name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:'{"789":2}'});
  await controller.recoverHostedAttempts({api,policy});
 }
 assert.deepEqual(posts,action==='recover'?['/repos/fixture/waitron/actions/runs/789/'+recovery]:blocked?[]:['/repos/fixture/waitron/actions/runs/789/cancel']);
 assert.deepEqual(await controller.hostedAttempts({api,policy}),action==='recover'||!blocked?{789:2}:{});
});
for(const conclusion of ['success','failure'])for(const name of ['bundle-smoke','ci','ci-copy'])for(const action of ['completed recovery','failed-guest fallback','owned cancellation'])test(`${action} checks completed ${name} with ${conclusion}`,async()=>{
 const f=fixture(),ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0],get=f.api.get,posts=[];
 if(action!=='failed-guest fallback'){Object.assign(f.run,{status:'completed',conclusion:'cancelled'});for(const job of f.jobs)Object.assign(job,{status:'completed',conclusion:'cancelled',runner_id:0});}
 f.jobs.push({...f.jobs[0],id:999,name,status:'completed',conclusion,runner_id:7,labels:['ubuntu-latest']});
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.post=async path=>{posts.push(path);if(path.endsWith('/cancel')){f.run.status='completed';f.run.conclusion='cancelled';}};
 const api=routingVariables(f.api),allowed=action==='completed recovery'||name==='ci'&&action!=='failed-guest fallback';
 if(action==='completed recovery'){
  await api.patch('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS',{name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:'{"789":2}'});
  await controller.recoverHostedAttempts({api,policy});
 }else assert.equal((await controller.fallbackOrdinary({api,policy,ci,automatic:true,leases:{inspect:()=>({ciInvocation:{ordinaryStage:action==='owned cancellation'?'cancel-requested':'admitted',runId:789,attempt:1,jobId:901}}),setInvocation:()=>{}}})).retry,allowed);
 assert.deepEqual(posts,allowed?['/repos/fixture/waitron/actions/runs/789/rerun']:[]);assert.deepEqual(await controller.hostedAttempts({api,policy}),allowed?{789:2}:{});
});
for(const action of ['overflow','fallback','recovery'])test(`automatic ${action} never moves a later attempt a second time`,async()=>{
 const f=fixture(),get=f.api.get,posts=[];f.run.run_attempt=2;
 for(const job of f.jobs){job.run_attempt=2;job.labels=job.labels.map(label=>label.replace('-789-1-','-789-2-'));}
 const ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);f.api.post=async path=>posts.push(path);
 const api=routingVariables(f.api);
 if(action==='overflow')await controller.overflowOrdinary({local:f.local,api,policy,ci});
 else if(action==='fallback')await controller.fallbackOrdinary({api,policy,ci,automatic:true});
 else {await api.patch('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS',{name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:'{"789":3}'});await controller.recoverHostedAttempts({api,policy});}
 assert.deepEqual(posts,[]);assert.deepEqual(await controller.hostedAttempts({api,policy}),{});
});

for(const action of ['overflow','fallback'])test(`${action} preserves a hosted assignment arriving after the marker was written`,async()=>{
 const f=fixture(),ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0],get=f.api.get;
 const api=routingVariables(f.api);
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 const observed=new Proxy(api,{get(target,key){if(key==='patch')return async(path,body)=>{const result=await target.patch(path,body);if(JSON.parse(body.value)['789'])f.jobs.push({...f.jobs[0],id:999,name:'bundle-smoke',status:'queued',runner_id:7,labels:['ubuntu-latest']});return result;};return Reflect.get(target,key);}});
 f.api.post=async()=>assert.fail('The new hosted assignment must survive');
 if(action==='overflow')await controller.overflowOrdinary({local:f.local,api:observed,policy,ci});
 else await controller.fallbackOrdinary({api:observed,policy,ci,automatic:true,leases:{inspect:()=>({ciInvocation:{ordinaryStage:'admitted',runId:789,attempt:1,jobId:901}}),setInvocation:()=>{}}});
 assert.deepEqual(await controller.hostedAttempts({api,policy}),{});
});
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
 const f=fixture(),get=f.api.get,first=f.jobs[0],second=f.jobs[1],third=f.jobs[2];let scans=0,release,inventoryFailures=0;
 const held=new Promise(resolve=>release=resolve),ids=[],waits=[];
 const timeout=setTimeout(release,500);t.after(()=>clearTimeout(timeout));
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.includes('/actions/runs?') && path.includes('status=queued')){
   scans++;if(ids.includes(902) && inventoryFailures++<3)return {total_count:1,workflow_runs:[]};
  }
  if(path.includes('/jobs?'))return {total_count:inventoryFailures<3?2:3,jobs:inventoryFailures<3?[first,second]:[first,second,third]};
  return get(path);
 };
 let failure;
 try{await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',state:root,hostGeneration:'test',slots:2,ci:policy},
  api:routingVariables(f.api),transport:{healthy:async()=>true},wait:async ms=>{waits.push(ms);},runWorker:async ci=>{ids.push(ci.jobId);if(ci.jobId===901)await held;else if(ci.jobId===903)release();return {code:0};}});}
 catch(error){failure=error;}
 assert.equal(failure,undefined);assert.deepEqual(ids,[901,902,903]);assert.ok(waits.includes(30000));
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

test('automatic pickup leaves a predecessor marked for its hosted retry unclaimed',async()=>{
 const f=fixture();
 assert.deepEqual(await controller.findAutomatic({api:f.api,policy,limit:6,hosted:{789:2}}),[]);
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
 const published=await routingVariables(f.api).get('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_CAPACITY');
 assert.ok(published.value,'The controller must publish its capacity');
 const {observedAt,...counts}=JSON.parse(published.value);
 assert.deepEqual(counts,{slots:6,serverRunning:1,serverWaiting:5,hostedRunning:0,hostedWaiting:0});
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
 assert.equal(selectionReads,2);assert.equal(leases.inspect().ciInvocation,undefined);
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
  const published=JSON.parse((await routingVariables(api).get('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_CAPACITY')).value||'{}');
  assert.equal(published.slots,0);assert.equal(published.serverRunning,0);
  for(let slot=0;slot<6;slot++)new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'full-'+slot,snapshot:'a'.repeat(64),argv:['true']});
  mode='server';await automaticTick({configuration:'/fixture/config.json',config:{version:2,mode:'manual-slots',slots:6,state:root,hostGeneration:'test',ci:policy},api:routingVariables(api),transport:{healthy:async()=>assert.fail('A full healthy pool is busy, not unavailable')}});
  assert.equal(mode,'server');assert.equal(writes,1);
 }
});

for(const race of ['none','assigned','assigned-later','changed-label','advanced'])test(`refused source stays queued through ${race} without running mismatched code`,async t=>{
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
 assert.equal(reruns,0,'Refused source remains queued for a person to diagnose');assert.equal(cancelled,false);
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

test('pickup leaves queued work alone when only the unhealthy server has free slots',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 config.slotHosts=['new.invalid','new.invalid','new.invalid','bench.invalid','bench.invalid','bench.invalid'];
 for(const slot of [3,4,5])new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot})
  .reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const served=[];
 const result=await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),
  transport:{healthy:async()=>true,healthySlots:async()=>[3,4,5]},runWorker:async ci=>{served.push(ci.jobId);return {code:0};}});
 assert.equal(result.served,0);assert.deepEqual(served,[]);
 assert.ok(f.jobs.every(job=>job.status==='queued'));
 const capacity=JSON.parse((await routingVariables(f.api).get('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_CAPACITY')).value);
 assert.equal(capacity.slots,3);assert.equal(capacity.serverRunning,3);
});

for(const available of [[],[3]])test(`automatic job rechecks healthy slots and reaches the selected server: ${available}`,async t=>{
 const {automaticJob}=await import('./control.mjs'),{CITransport}=await import('./transport.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 config.host='new.invalid';config.recipe='/opt/waitron-disposable-fixture';
 config.slotHosts=['new.invalid','new.invalid','new.invalid','bench.invalid','bench.invalid','bench.invalid'];
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/runners?')?{total_count:0,runners:[]}:get(path);
 const replacement={healthySlots:async()=>available,healthy:async function(){return this.slot===3;},
  transfer:async()=>{throw new Error('fixture transfer failed');},destroy:async()=>{},inspect:async({resourceId})=>({resourceId,absent:true})};
 for(const [name,method] of Object.entries(replacement)){
  const descriptor=Object.getOwnPropertyDescriptor(CITransport.prototype,name);
  t.after(()=>descriptor?Object.defineProperty(CITransport.prototype,name,descriptor):delete CITransport.prototype[name]);
  CITransport.prototype[name]=method;
 }
 const result=await automaticJob({config,api:f.api,runId:789,jobId:901});
 if(available.length){assert.equal(result.code,125);assert.match(result.error,/fixture transfer failed/);assert.equal(result.lease.slot,3);assert.equal(result.cleanup,'absent');}
 else assert.equal(result.code,75);
 assert.ok(f.jobs.every(job=>job.status==='queued'));
});

test('a full working pool keeps its occupied capacity when another guest cannot fit',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 config.slotHosts=['new.invalid','new.invalid','new.invalid','bench.invalid','bench.invalid','bench.invalid'];
 for(let slot=0;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot})
  .reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 let mode='server';const api=routingVariables(f.api);
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('DISPOSABLE_TESTS_MODE')?{value:mode}:get(path);
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_MODE'));mode=body.value;};
 const result=await automaticTick({configuration:'/fixture/config',config,api,transport:{healthySlots:async()=>[]},runWorker:async()=>assert.fail('The pool is full')});
 assert.deepEqual(result,{code:0,served:0});assert.equal(mode,'server');
 const capacity=JSON.parse((await api.get('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_CAPACITY')).value);
 assert.equal(capacity.slots,6);assert.equal(capacity.serverRunning,6);
});

for(const quota of [false,true])test(`pickup retries only its recorded ${quota?'pre-registration quota':'busy-runner'} failure once, while other turns stay retired`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;
 f.jobs.splice(2);
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const identities=await controller.findAutomatic({api:f.api,policy,limit:2});
 const failed=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:0,now:()=>Date.now()-60000});
 for(const identity of identities){
  const lease=failed.reserveLocal(ciRequest('I',identity)).lease;
  failed.release(lease,{resourceId:lease.resourceId,absent:true});
  if(identity.jobId!==901)failed.forgetRunner(failed.inspect().orphanRunners.find(r=>r.ci.jobId===identity.jobId));
  if(identity.jobId===901){
   const result={code:125,cleanup:'absent',lease,error:quota?'GitHub GET refused (403)':'CI runner assignment is busy elsewhere'};
   if(quota)failed.recordCIRetryFailure(result,Date.now()-1);else failed.recordBusyRunnerFailure(result);
  }
 }
 const admitted=[];
 const options={configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:ci=>withAvailableSlot(config,async({leases})=>{
  const reserved=leases.reserveLocal(ciRequest('I',ci));assert.equal(reserved.code,0);
  admitted.push(ci.jobId);leases.release(reserved.lease,{resourceId:reserved.lease.resourceId,absent:true});
  leases.forgetRunner(leases.inspect().orphanRunners[0]);return {code:0};
 })};
 assert.equal((await automaticTick(options)).served,0,'pickup must wait for the previous runner cleanup');
 failed.forgetRunner(failed.inspect().orphanRunners.find(r=>r.ci.jobId===901));
 await automaticTick(options);await automaticTick(options);
 assert.deepEqual(admitted,[901]);
 const state=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}).inspect();
 assert.equal(Object.keys(state.turns).length,2);assert.equal(state.turns['I:ci-789-1-901'][quota?'admissionQuotaRetried':'busyRunnerRetried'],true);
 assert.equal(state.turns['I:ci-789-1-902'].busyRunnerRetried,undefined);
});

test('pickup does not reselect a retry while its first worker awaits admission',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases,withAvailableSlot}=await import('./leases.mjs'),{ciRequest}=await import('./ci-identity.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;f.jobs.splice(2);
 const identity=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 const failed=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot:0,now:()=>Date.now()-60000});
 const lease=failed.reserveLocal(ciRequest('I',identity)).lease;
 failed.release(lease,{resourceId:lease.resourceId,absent:true});failed.forgetRunner(failed.inspect().orphanRunners[0]);
 failed.recordBusyRunnerFailure({code:125,cleanup:'absent',lease,error:'CI runner assignment is busy elsewhere'});
 let release,passes=0,retryWorkers=0;
 const awaitingAdmission=new Promise(resolve=>{release=resolve;});
 f.api.get=async path=>{
  if(path.includes('/actions/runs?status=queued') && ++passes===2)release();
  return path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 };
 const result=await automaticTick({configuration:'/fixture/config.json',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{
  if(ci.jobId!==901)return {code:0};
  retryWorkers++;await awaitingAdmission;
  return withAvailableSlot(config,async({leases})=>{
   const reserved=leases.reserveLocal(ciRequest('I',ci));if(reserved.code!==0)return reserved;
   leases.release(reserved.lease,{resourceId:reserved.lease.resourceId,absent:true});
   leases.forgetRunner(leases.inspect().orphanRunners[0]);return {code:0};
  });
 }});
 assert.equal(retryWorkers,1);assert.equal(result.served,2);
});

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
 const timeout=setTimeout(release,2000);t.after(()=>clearTimeout(timeout));let inventoryFailures=0;const waits=[];
 f.api.get=async path=>{
  if(fault==='inventory' && ids.includes(902) && inventoryFailures<3 && path.includes('/actions/runs?') && path.includes('status=queued')){
   injected=true;inventoryFailures++;return {total_count:1,workflow_runs:[]};
  }
  if(fault!=='inventory' && !injected && ids.includes(902) && ((fault==='marker-http' && path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')) || (fault==='head-http' && path.endsWith('DISPOSABLE_TESTS_HEAD')) || (!fault.startsWith('marker') && !fault.startsWith('head') && (fault==='rate-pr'?path.endsWith('/pulls/12'):path.includes('/runs?'))))){
   injected=true;
   if(interrupted)return interrupted.get(path);
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
  api:f.api,transport:{healthy:async()=>true},wait:async ms=>{waits.push(ms);if(fault.startsWith('rate-'))assert.ok(ms>=(fault==='rate-reset'?88000:74000) && ms<=(fault==='rate-reset'?90000:75000),'Respect the server retry time');else assert.equal(ms,30000);},runWorker:async ci=>{ids.push(ci.jobId);if(ci.jobId===901)await held;else if(ci.jobId===903){thirdWhileHeld=heldActive;release();}return {code:0};}});}
 catch(error){failure=error;}
 assert.equal(failure,undefined);assert.deepEqual(ids,[901,902,903]);assert.equal(thirdWhileHeld,true,'The third job starts before the first finishes');
 if(fault==='inventory')assert.ok(waits.includes(30000));
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
 const sibling={...f.jobs[1],conclusion:'cancelled',status:state==='running'?'in_progress':state==='assigned-queued'?'queued':'completed',runner_id:['running','assigned-queued'].includes(state)?77:0,
  ...(state==='other-attempt'?{run_attempt:2}:state==='other-run'?{run_id:790}:{})};
 f.api.get=async path=>path.endsWith('/actions/jobs/901')?f.jobs[0]:path.endsWith('/actions/runs/789')?{...f.run,status:forced?'completed':'queued'}:
  path.includes('/jobs?')?{total_count:2,jobs:[f.jobs[0],sibling]}:get(path);
 f.api.post=async path=>{if(path.endsWith('/force-cancel')){assert.equal(state,'completed');forced=true;}else assert.ok(path.endsWith('/rerun'));};
 const leases={inspect:()=>({ciInvocation:{ordinaryStage:'cancel-requested',runId:789,attempt:1,jobId:901}}),setInvocation:()=>{}};
 const result=await controller.fallbackOrdinary({api:routingVariables(f.api),policy,ci,leases,automatic:true,wait:async()=>assert.fail('Recovery must yield')});
 assert.equal(forced,state==='completed');assert.equal(result.retry,state==='completed');if(state!=='completed')assert.equal(['running','assigned-queued'].includes(state)?result.started:result.pending,true);
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

for(const state of ['cancel-not-sent','cancel-ack-lost','rerun-ack-lost','active-hosted','newer-attempt','stale-head','closed','foreign-repository','foreign-workflow','foreign-path','foreign-event','force-queued','completed-runner','terminal-failure','running-sibling','incomplete-jobs'])test(`hosted overflow recovery handles ${state}`,async()=>{
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
 if(state==='completed-runner'){f.jobs[0].status='completed';f.jobs[0].conclusion='cancelled';f.jobs[0].runner_id=42;}
 if(state==='terminal-failure'){f.run.status='completed';f.run.conclusion='failure';}
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
 const expected=['cancel-not-sent','force-queued','completed-runner'].includes(state)?['force-cancel']:state==='running-sibling'?['cancel']:['cancel-ack-lost','rerun-ack-lost'].includes(state)?['rerun']:[];
 assert.deepEqual(actions,expected);
 assert.equal(value,['newer-attempt','stale-head','closed'].includes(state)?'{}':'{"789":2}');
});

test('recovery retirement preserves another movement marker written after its first read',async()=>{
 const f=fixture(),get=f.api.get;f.run.run_attempt=2;f.run.status='completed';let reads=0,written;
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:written?JSON.stringify(written):++reads===1?'{"789":2}':'{"789":2,"790":2}'}:get(path);
 f.api.patch=async(_path,body)=>{written=JSON.parse(body.value);};
 await controller.recoverHostedAttempts({api:f.api,policy});
 assert.deepEqual(written,{'790':2});
});

for(const change of ['successor','head','local'])test(`recovery refreshes ${change} after its job inventory before cancelling`,async()=>{
 const f=fixture(),get=f.api.get,excluded=new Set(),actions=[];let runs=0,pulls=0;
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{"789":2}'};
  if(path.endsWith('/runs/789'))return {...f.run,run_attempt:++runs>1&&change==='successor'?2:1};
  if(path.endsWith('/pulls/12')){const pull=await get(path);return ++pulls>1&&change==='head'?{...pull,head:{...pull.head,sha:'9'.repeat(40)}}:pull;}
  if(path.includes('/jobs?')&&change==='local')excluded.add(789);
  return get(path);
 };
 f.api.post=async path=>actions.push(path);f.api.patch=async()=>assert.fail('Keep unresolved movement intent');
 await controller.recoverHostedAttempts({api:f.api,policy,excludeRuns:excluded});
 assert.deepEqual(actions,[]);
});

for(const [state,running,wave,wantCancel] of [
 ['no room',20,5,false],['exact room',15,5,true],['one short',16,5,true],
 ['large wave',0,21,true],['queued hosted',0,5,true],['unknown jobs',0,5,false],
 ['unknown runs',0,5,false],['wrong attempt',0,5,false],['duplicate runs',0,5,false],
 ['reserved retry',15,5,true],['balanced queue',0,5,false],...['waiting','pending','requested'].map(state=>[state,0,5,true])
])test(`overflow requires observed hosted room: ${state}`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 const target=f.jobs[0];f.jobs.splice(0,f.jobs.length,...Array.from({length:wave},(_,i)=>({...target,id:901+i})));
 const other={...f.run,id:790},hosted=Array.from({length:running},(_,i)=>({...target,id:1000+i,run_id:790,status:'in_progress',runner_id:42,labels:['ubuntu-latest']}));
 if(state==='balanced queue')hosted.push(...Array.from({length:17},(_,i)=>({...target,id:2000+i,run_id:790,labels:['ubuntu-latest']})));
 if(state==='queued hosted')hosted.push({...target,id:2000,run_id:790,labels:['ubuntu-latest']});
 if(['waiting','pending','requested'].includes(state))hosted.push({...target,id:2000,run_id:790,status:state,labels:['ubuntu-latest']});
 if(state==='wrong attempt')hosted.push({...target,id:2000,run_id:790,run_attempt:2,labels:['ubuntu-latest']});
 let marker=state==='reserved retry'?'{"790":2}':'{}';const posts=[];
 f.api.get=async(path,options)=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.endsWith('/actions/jobs/901'))return target;
  if(path.includes('/actions/runs?')){
   const runs=path.includes('status=queued')?[]:[f.run,other];
   if(state==='duplicate runs' && runs.length)runs.push(other);
   return {total_count:runs.length+(state==='unknown runs'?1:0),workflow_runs:runs};
  }
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:hosted.length+(state==='unknown jobs'?1:0),jobs:hosted};
  return get(path,options);
 };
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 let error;try{await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});}catch(e){error=e;}
 if(state.startsWith('unknown') || state==='wrong attempt' || state==='duplicate runs')assert.match(error?.message??'',/inventory/i);
 else assert.equal(error,undefined);
 assert.deepEqual(posts,wantCancel?['/repos/fixture/waitron/actions/runs/789/cancel']:[]);
 assert.deepEqual(JSON.parse(marker),wantCancel?{...(state==='reserved retry'?{790:2}:{}),789:2}:state==='reserved retry'?{790:2}:{});
});

for(const names of ['distinct','repeated'])test(`overflow reserves a marked retry while its hosted job list is still growing: ${names}`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0],target=f.jobs[0];
 const prior=Array.from({length:20},(_,i)=>({...target,id:2000+i,run_id:790,name:names==='repeated'?'changes':'job-'+i,status:'completed',conclusion:'cancelled'}));
 const retry={...f.run,id:790,run_attempt:2};const changes={...target,id:3000,run_id:790,run_attempt:2,name:'changes',status:'completed',conclusion:'success',labels:['ubuntu-latest']};
 let marker='{"790":2}';const posts=[];
 f.api.get=async(path,options)=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.endsWith('/actions/jobs/901'))return target;
  if(path.includes('/actions/runs?'))return {total_count:1,workflow_runs:[retry]};
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:20,jobs:prior};
  if(path.includes('/runs/790/attempts/2/jobs?'))return {total_count:1,jobs:[changes]};
  return get(path,options);
 };
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});
 assert.deepEqual(posts,[]);assert.equal(marker,'{"790":2}');
});

for(const state of ['missing marked run','missing skipped run','stale marker','skipped reservation','foreign run','foreign commit','retry visible'])test(`overflow checks reservation authority: ${state}`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0],target=f.jobs[0];
 const retry=state==='retry visible',other={...f.run,id:790,run_attempt:retry?2:1,...(state==='foreign run'?{repository:{id:999}}:{})};
 const jobs=Array.from({length:20},(_,i)=>({...target,id:2000+i,run_id:790,name:'job-'+i,status:'completed',conclusion:['skipped reservation','missing skipped run'].includes(state)?'skipped':'cancelled',...(state==='foreign commit'?{head_sha:'f'.repeat(40)}:{})}));
 let marker=state==='stale marker'?'{"790":1}':'{"790":2}';const posts=[];
 f.api.get=async(path,options)=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.endsWith('/actions/jobs/901'))return target;
  if(path.includes('/actions/runs?'))return {total_count:state.startsWith('missing')?0:1,workflow_runs:state.startsWith('missing')?[]:[other]};
  if(path.endsWith('/runs/790'))return other;
  if(path.includes('/runs/790/attempts/'))return {total_count:20,jobs:path.includes('/attempts/2/')?jobs.map(job=>({...job,run_attempt:2,conclusion:'success',labels:['ubuntu-latest']})):jobs};
  return get(path,options);
 };
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>posts.push(path);
 if(state.startsWith('foreign'))await assert.rejects(controller.overflowOrdinary({local:f.local,api:f.api,policy,ci}),/inventory/);
 else await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});
 assert.deepEqual(posts,['stale marker','skipped reservation','missing skipped run','retry visible'].includes(state)?['/repos/fixture/waitron/actions/runs/789/cancel']:[]);
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
 await assert.rejects(controller.overflowOrdinary({local:f.local,api:f.api,policy,ci}));assert.equal(posts,0);
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
 await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});
 assert.equal(posts,0);assert.equal(marker,'{}');if(state!=='late-assignment')assert.equal(writes,0);
});

for(const obsolete of ['deleted','merged'])test(`hosted overflow retires a ${obsolete} run without stopping other recovery`,async()=>{
 const f=fixture(),get=f.api.get,posts=[];let value='{"789":2,"790":2}';
 const other={...f.run,id:790,event:'push',pull_requests:[],status:'completed',conclusion:'cancelled'};
 f.api.get=async path=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value};
  if(path.endsWith('/runs/789')){if(obsolete==='deleted')throw Object.assign(new Error('Not found'),{status:404});return {...f.run,pull_requests:[]};}
  if(path.endsWith('/runs/790'))return other;
  if(path.includes('/runs/790/attempts/1/jobs?'))return {total_count:0,jobs:[]};
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

for(const clock of ['attempt','job'])test(`overflow gives a newly queued ${clock} its own minute`,async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let marker='{}';const posts=[];
 if(clock==='attempt')f.run.run_started_at=new Date().toISOString();
 else f.jobs[0].started_at=new Date().toISOString();
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});assert.equal(marker,'{}');assert.deepEqual(posts,[]);
});

test('overflow leaves a workflow without hosted-attempt routing on the server',async()=>{
 const f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let marker='{}';const posts=[];
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.includes('/contents/')?{encoding:'base64',content:Buffer.from('legacy workflow').toString('base64')}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 f.api.patch=async(path,body)=>{marker=body.value;};f.api.post=async path=>{posts.push(path);};
 await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});assert.equal(marker,'{}');assert.deepEqual(posts,[]);
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
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2,"790":2}'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/runs/790')?{...f.run,id:790,event:'push',pull_requests:[],run_attempt:2}:path.includes('/runs/790/attempts/')?{total_count:0,jobs:[]}:get(path);
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
 const currentGet=f.api.get;f.api.get=async path=>path.includes('/attempts/1/jobs?')?{total_count:0,jobs:[]}:currentGet(path);
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
 await controller.overflowOrdinary({local:f.local,api:f.api,policy,ci});
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
 for(const job of f.jobs)if(job!==f.target){job.conclusion='skipped';job.runner_id=0;}
 f.jobs[82]={...f.target,id:2000,status:assigned?'in_progress':'queued',runner_id:assigned?77:0};
 f.api.get=async(path,options)=>path.endsWith('/actions/jobs/901')?f.target:get(path,options);
 f.api.post=async path=>{posts.push(path);f.run.status='completed';};
 const api=routingVariables(f.api),ci={repositoryId:123,workflowId:456,workflowSha:head,sourceSha:head,runId:789,attempt:1,jobId:901};
 await controller.overflowOrdinary({local:f.local,api,policy,ci});
 assert.deepEqual(posts,assigned?[]:['/repos/fixture/waitron/actions/runs/789/cancel']);
 assert.deepEqual(await controller.hostedAttempts({api,policy}),assigned?{}:{789:2});
});

for(const assigned of [true,false])test(`hosted-attempt recovery reads the page-three sibling before ${assigned?'resending cancellation for':'forcing cancellation for'} the run`,async()=>{
 const f=pagedJobFixture(),posts=[];f.run.status='queued';
 for(const job of f.jobs)if(job!==f.target){job.conclusion='skipped';job.runner_id=0;}
 f.jobs[82]={...f.target,id:2000,status:assigned?'in_progress':'queued',runner_id:assigned?77:0};
 f.api.post=async path=>{posts.push(path);};
 const api=routingVariables(f.api);
 await api.patch('/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS',{name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:'{"789":2}'});
 assert.deepEqual(await controller.recoverHostedAttempts({api,policy}),{789:2});
 assert.deepEqual(posts,['/repos/fixture/waitron/actions/runs/789/'+(assigned?'cancel':'force-cancel')]);
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

test('a refused capacity snapshot leaves a full manual pool unchanged',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 for(let slot=0;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/actions/runs?')?{total_count:1,workflow_runs:[{...f.run,repository:{id:999}}]}:get(path);
 f.api.post=async()=>assert.fail('No cancellation from an unreadable snapshot');
 assert.deepEqual(await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api)}),{code:0,served:0});
});

test('capacity publication waits a minute while a completed slot refills',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 for(let slot=0;slot<4;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 f.jobs.splice(3);f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 let now=Date.now(),release,writes=0;const held=new Promise(resolve=>release=resolve);t.after(()=>release());t.mock.method(Date,'now',()=>now);
 const api=routingVariables(f.api),observed=new Proxy(api,{get(target,key){if(key==='patch')return async(path,...args)=>{if(path.endsWith('/DISPOSABLE_TESTS_CAPACITY'))writes++;return target.patch(path,...args);};return Reflect.get(target,key);}});
 await automaticTick({configuration:'/fixture/config',config,api:observed,transport:{healthy:async()=>true},runWorker:async ci=>{if(ci.jobId===901)await held;if(ci.jobId===903){now+=31000;release();}return {code:0};}});
 assert.equal(writes,1);
});

for(const marker of [0,1,2])test(`automatic measured routes stay on their queue with marker ${marker}`,async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,actions=[];
 for(let slot=0;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'manual-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker?JSON.stringify({789:marker}):'{}'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/actions/jobs/901')?f.jobs[0]:get(path);
 const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6}),before=leases.inspect();
 f.api.post=async path=>actions.push(path);f.api.patch=async(path,body)=>{if(!path.endsWith('DISPOSABLE_TESTS_CAPACITY'))actions.push([path,body]);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,runWorker:async()=>assert.fail('Pool is full')});
 assert.deepEqual(actions,[],'A completed tick must never rebalance a measured route');assert.deepEqual(leases.inspect(),before);
});

test('a stale hosted marker permits pickup without rewriting the marker',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get,served=[],writes=[];
 f.run.run_attempt=3;f.jobs.forEach(job=>{job.run_attempt=3;job.labels=job.labels.map(label=>label.replace('-789-1-','-789-3-'));});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2}'}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 f.api.patch=async(path,body)=>{if(!path.endsWith('DISPOSABLE_TESTS_CAPACITY'))writes.push([path,body]);};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{served.push(ci.jobId);return {code:0};}});
 assert.deepEqual(served,[901,902,903,904,905]);assert.deepEqual(writes,[]);
});

test('automatic worker failure retires its intent without invoking fallback',async()=>{
 const f=fixture(),ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];let pending;
 const leases={inspect:()=>({slots:[{state:'free'}],ciInvocation:pending}),setInvocation:value=>{pending=value;},clearInvocation:()=>{pending=undefined;}};
 const get=f.api.get;f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const calls=[];
 const result=await controller.executeOrdinary({api:f.api,policy,ci,leases,lane:'I',automatic:true,transport:{healthy:async()=>false},fallback:async()=>{calls.push('fallback');return {retry:true};}});
 assert.equal(result.code,125);assert.equal(result.retry,false);assert.deepEqual(calls,[]);assert.equal(pending,undefined);
});


test('automatic capacity publication ignores deleted runs in retained hosted markers',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 let capacity='',markerWrites=0,marker=JSON.stringify({777:2});
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:marker}:path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('DISPOSABLE_TESTS_CAPACITY')?{value:capacity}:path.endsWith('/runs/777')?Promise.reject(Object.assign(new Error('Not Found'),{status:404})):get(path);
 f.api.patch=async(path,body)=>{if(path.endsWith('DISPOSABLE_TESTS_CAPACITY'))capacity=body.value;else {markerWrites++;marker=body.value;}};
 const result=await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async()=>({code:0})});
 assert.equal(result.served,5);assert.equal(JSON.parse(capacity).slots,6);assert.equal(markerWrites,1);assert.equal(marker,'{}');
});

for(const [label,output] of [['bounded','x'.repeat(6000)],['partial line','guest partial '+JSON.stringify({event:'github-request-counts',requests:2})+'\nreal error\n'],['short lines','x\n'.repeat(3000)]])test('the real automatic worker tags bounded stderr and forwards the original bytes: '+label,async t=>{
 const {writeFileSync}=await import('node:fs'),{automaticTick}=await import('./control.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get;f.jobs.splice(1);
 f.api.get=async path=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);
 const node=process.execPath,worker=config.state+'/stderr-worker';
 const count=JSON.stringify({event:'github-request-counts',requests:1})+'\n';
 writeFileSync(worker,'#!'+node+'\n'+'process.stderr.write('+JSON.stringify(count)+');process.stderr.write('+JSON.stringify(output)+');process.exit(125);\n',{mode:0o700});
 const error=console.error,write=process.stderr.write,records=[],forwarded=[];
 t.after(()=>{process.execPath=node;console.error=error;process.stderr.write=write;});
 console.error=line=>{records.push(JSON.parse(line));};process.stderr.write=data=>{forwarded.push(Buffer.from(data));return true;};process.execPath=worker;
 let result;
 try{result=await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>true}});}
 finally{process.execPath=node;console.error=error;process.stderr.write=write;}
 const diagnostics=records.filter(row=>row.event==='automatic-ci-admission-stderr');
 assert.equal(result.served,1);assert.equal(diagnostics.map(row=>row.stderr).join(''),output.startsWith('guest')?'guest partial real error\n':output.slice(0,4096));
 assert.ok(diagnostics.length<=forwarded.length+1,'A chunk of short lines must not create one tagged record per line');
 for(const row of diagnostics){assert.equal(row.runId,789);assert.equal(row.attempt,1);assert.equal(row.jobId,901);assert.ok(Number.isFinite(Date.parse(row.at)));}
 assert.equal(Buffer.concat(forwarded).toString(),'{"event":"github-request-counts","requests":1}\n'+output);
});

for(const state of ['replaced','closed','closed-with-current-other','merged-empty-links','assigned','current-fail-fast','unknown-link','foreign','main','schedule','advanced-during-read','incomplete-jobs'])test(`dead-run reconciliation handles ${state}`,async()=>{
 const f=fixture(),get=f.api.get,posts=[];let refreshes=0;
 const obsolete=!['current-fail-fast','unknown-link','foreign','main','schedule'].includes(state);
 if(state==='merged-empty-links'||state==='unknown-link')f.run.pull_requests=[];
 if(state==='foreign')f.run.head_repository={id:999};
 if(state==='main')f.run.event='push';
 if(state==='schedule')f.run.event='schedule';
 if(['main','schedule'].includes(state))f.run.pull_requests=[];
 if(state==='assigned'){f.jobs[0].runner_id=42;f.jobs[0].status='in_progress';}
 if(state==='current-fail-fast'){f.jobs[0].status='completed';f.jobs[0].conclusion='cancelled';}
 f.api.get=async(path,options)=>{
  if(path.includes('/pulls?state=open')&&state==='closed-with-current-other')return [{number:13,state:'open',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}}];
  if(path.includes('/pulls?state=open')&&['merged-empty-links','unknown-link'].includes(state))return [];
  if(path.endsWith('/pulls/12'))return {number:12,state:['closed','closed-with-current-other','merged-empty-links','main','schedule'].includes(state)?'closed':'open',head:{sha:obsolete?'a'.repeat(40):head,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/commits/'+head+'/pulls')&&state==='unknown-link')return [];
  if(path.endsWith('/runs/789')&&state==='advanced-during-read')return {...f.run,run_attempt:++refreshes===1?1:2};
  if(path.includes('/jobs?')&&state==='incomplete-jobs')return {total_count:6,jobs:f.jobs};
  return get(path,options);
 };
 f.api.post=async path=>posts.push(path);
 const errors=[];
 assert.equal(typeof controller.reconcileDeadRuns,'function');
 await controller.reconcileDeadRuns({api:f.api,policy,onError:error=>errors.push(error.message)});
 assert.deepEqual(posts,obsolete&&!['advanced-during-read','incomplete-jobs'].includes(state)?['/repos/fixture/waitron/actions/runs/789/'+(state==='assigned'?'cancel':'force-cancel')]:[]);
 if(state==='incomplete-jobs')assert.match(errors.join(),/inventory/);
});
for(const state of ['completed','missing','active','pending-move','closed-before-retry'])test(`dead-run reconciliation retires only finished hosted markers: ${state}`,async()=>{
 const f=fixture(),get=f.api.get;let value=JSON.stringify({789:['pending-move','closed-before-retry'].includes(state)?2:1});const posts=[];
 f.api.get=async(path,options)=>{
  if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value};
  if(path.includes('/runs?'))return {total_count:0,workflow_runs:[]};
  if(path.endsWith('/pulls/12')&&state==='closed-before-retry')return {number:12,state:'closed',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}};
  if(path.endsWith('/runs/789')){
   if(state==='missing')throw Object.assign(new Error('Gone'),{status:404});
   return {...f.run,status:['completed','closed-before-retry','pending-move'].includes(state)?'completed':'in_progress',conclusion:state==='completed'?'success':state==='pending-move'?'cancelled':null};
  }
  return get(path,options);
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));value=body.value;};
 f.api.post=async path=>posts.push(path);
 assert.equal(typeof controller.reconcileDeadRuns,'function');
 await controller.reconcileDeadRuns({api:f.api,policy});
 assert.deepEqual(JSON.parse(value),['completed','missing','closed-before-retry'].includes(state)?{}:{789:state==='pending-move'?2:1});assert.deepEqual(posts,[]);
});
test('a full pool still cancels an obsolete run before returning',async t=>{
 const {automaticTick}=await import('./control.mjs'),{LocalLeases}=await import('./leases.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,posts=[];
 for(let slot=0;slot<6;slot++)new LocalLeases(config.state+'/ledger',{hostGeneration:'test',slots:6,slot}).reserveLocal({lane:'I',turn:'full-'+slot,snapshot:'a'.repeat(64),argv:['true']});
 f.api.get=async(path,options)=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('/pulls/12')?{number:12,state:'closed',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}}:get(path,options);
 f.api.post=async path=>posts.push(path);
 await automaticTick({configuration:'/fixture/config',config,api:f.api,runWorker:async()=>assert.fail('Pool is full')});
 assert.deepEqual(posts,['/repos/fixture/waitron/actions/runs/789/force-cancel']);
});
test('one automatic pass shares run, PR and job observations across its readers',async()=>{
 const f=fixture(),get=f.api.get,reads=[];
 f.api.get=async(path,options)=>{reads.push(path);if(path.includes('/pulls?state=open'))return [{number:12,state:'open',head:{sha:head,repo:{id:123}},base:{repo:{id:123}}}];return get(path,options);};
 assert.equal(typeof controller.readAutomaticPass,'function');
 const pass=await controller.readAutomaticPass({api:f.api,policy});
 await controller.reconcileDeadRuns({api:f.api,policy,pass,hosted:{}});
 assert.equal((await controller.findAutomatic({api:pass.api,policy,limit:1,runs:pass.runs})).length,1);
 assert.equal((await controller.overflowInventory({api:pass.api,policy,runs:pass.runs,includeHosted:false})).size,1);
 assert.equal(reads.filter(path=>path.includes('/runs?')).length,2);
 assert.equal(reads.filter(path=>path.includes('/pulls?state=open')).length,1);
 assert.equal(reads.filter(path=>path.includes('/jobs?')).length,1);
 assert.equal(reads.filter(path=>path.endsWith('/runs/789')||path.endsWith('/pulls/12')).length,0);
});

test('a large unrelated workflow queue does not stop ordinary pickup',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get,ids=[];
 f.api.get=async(path,options)=>{
  if(path.endsWith('DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.endsWith('DISPOSABLE_TESTS_MODE'))return {value:'server'};
  if(path.includes('/actions/runs?')&&path.includes('status=in_progress'))return {total_count:101,workflow_runs:[f.run,...Array.from({length:99},(_,i)=>({...f.run,id:1000+i,workflow_id:999}))]};
  return get(path,options);
 };
 f.api.post=async()=>assert.fail('No cancellation is justified by a partial inventory');
 const result=await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async ci=>{ids.push(ci.jobId);return {code:0};}});
 assert.equal(result.code,0);assert.deepEqual(ids,[901,902,903,904,905]);
});
test('shared capacity keeps the observation time from before worker waits',async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 const now=Date.now,start=now();let clock=start,capacity='{}';Date.now=()=>clock;t.after(()=>{Date.now=now;});
 f.api.get=async(path,options)=>path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.endsWith('DISPOSABLE_TESTS_CAPACITY')?{value:capacity}:get(path,options);
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('DISPOSABLE_TESTS_CAPACITY'));capacity=body.value;};
 await automaticTick({configuration:'/fixture/config',config,api:f.api,transport:{healthy:async()=>true},runWorker:async()=>{clock=start+30000;return {code:0};}});
 assert.equal(JSON.parse(capacity).observedAt,start);
});

for(const age of ['fresh','stale','aging','gone'])test(`workers use ${age} shared admission before taking a guest`,async t=>{
 const {automaticJob}=await import('./control.mjs'),{CITransport}=await import('./transport.mjs');
 const config=await refusalPool(t),f=fixture(),get=f.api.get,ci=(await controller.findAutomatic({api:f.api,policy,limit:1}))[0];
 config.host='new.invalid';config.recipe='/opt/waitron-disposable-fixture';config.slotHosts=Array(6).fill('new.invalid');let permissions=0,elapsed=0;const now=Date.now();t.mock.method(Date,'now',()=>now+elapsed);
 f.api.get=async path=>{if(path.endsWith('fork-pr-contributor-approval'))permissions++;return path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:path.includes('/runners?')?{total_count:0,runners:[]}:get(path);};
 for(const [name,method] of Object.entries({healthySlots:async()=>{if(age==='aging' || age==='gone')elapsed=2000;if(age==='gone')f.jobs.length=0;return [0];},healthy:async()=>true,transfer:async()=>{throw new Error('fixture transfer failed');},destroy:async()=>{},inspect:async({resourceId})=>({resourceId,absent:true})}))t.mock.method(CITransport.prototype,name,method);
 const result=await automaticJob({config,api:f.api,runId:789,jobId:901,admission:{ci,checkedAt:now-(age==='stale'?61000:age==='aging' || age==='gone'?59000:0)}});
 if(age==='gone'){assert.equal(result.code,75);assert.equal(result.reason,'job-no-longer-queued');}
 else{assert.equal(result.code,125);assert.match(result.error,/fixture transfer failed/);assert.equal(result.cleanup,'absent');}
 assert.equal(permissions,age==='fresh'?0:1,'fresh per-run permission evidence is shared; stale evidence is reread');
});

for(const mode of ['fresh','stale','expired-refresh'])test(`pickup sends bounded ${mode} admission to its workers`,async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get;
 const now=Date.now();let elapsed=0,permissions=0;const admissions=[];t.mock.method(Date,'now',()=>now+elapsed);
 f.api.get=async path=>{if(path.endsWith('fork-pr-contributor-approval')){permissions++;if(mode==='expired-refresh' && permissions>1)elapsed+=61000;}return path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);};
 await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>{if(mode!=='fresh')elapsed=61000;return true;}},
  runWorker:async(ci,admission)=>{admissions.push({ci,admission});return {code:0};}});
 assert.equal(admissions.length,mode==='expired-refresh'?0:5);
 for(const {ci,admission} of admissions){assert.deepEqual(admission?.ci,ci);assert.ok(admission.checkedAt>=now+(mode==='fresh'?0:61000) && admission.checkedAt<=Date.now());}
 assert.ok(mode==='fresh'?permissions===1:permissions>=2);
});

for(const fork of [true,false])test(`shared pickup rejects ${fork?'fork code even with contributor approval':'unapproved same-repository code'}`,async t=>{
 const {automaticTick}=await import('./control.mjs'),config=await refusalPool(t),f=fixture(),get=f.api.get,admissions=[],refusals=[];let permissionReads=0;
 if(fork)f.run.head_repository.id=999;
 t.mock.method(console,'error',line=>refusals.push(JSON.parse(line)));
 f.api.get=async path=>{if(path.endsWith('fork-pr-contributor-approval')){permissionReads++;return {approval_policy:fork?'all_external_contributors':'first_time_contributors'};}return path.endsWith('DISPOSABLE_TESTS_HEAD')?{value:''}:get(path);};
 await automaticTick({configuration:'/fixture/config',config,api:routingVariables(f.api),transport:{healthy:async()=>true},runWorker:async ci=>{admissions.push(ci);return {code:0};}});
 assert.deepEqual(admissions,[]);
 if(!fork){assert.equal(permissionReads,1);assert.ok(refusals.some(row=>row.event==='automatic-ci-refused' && /External contributor approval/.test(row.error)));}
});
