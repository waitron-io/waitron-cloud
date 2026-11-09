import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {LocalLeases} from './leases.mjs';
const ci={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',workflowSha:'1'.repeat(40),
 workflowDigest:'2'.repeat(64),event:'workflow_dispatch',sourceSha:'3'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
test('a cancelled concrete job aborts its idle guest instead of retaining a slot until the guest deadline',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 f.api.get=async(path,options)=>{if(path.endsWith('/runners/1001'))return {id:1001,name:'dt-123-789-1-901',busy:false};
  const value=await get(path,options);
  return path.includes('/jobs/')?{...value,status:'completed',conclusion:'cancelled',runner_id:0}:value;};
 let executing=false;
 const inspect=f.transport.inspect,destroy=f.transport.destroy;
 f.transport.inspect=async(lease,options)=>executing?{resourceId:lease.resourceId,running:true}:inspect(lease,options);
 f.transport.destroy=async(...args)=>{executing=false;return destroy(...args);};
 const read=f.api.get;
 f.api.get=async(path,options)=>{const value=await read(path,options);
  return path.includes('/jobs/') && !executing?{...value,status:'queued',conclusion:null}:value;};
 f.transport.execute=async(_lease,{signal})=>{
  executing=true;
  await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('External deadline elapsed')),{once:true});});
 };
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud',signal:AbortSignal.timeout(300),
  wait:async()=>new Promise(resolve=>setTimeout(resolve,1))});
 assert.equal(result.code,125);assert.match(result.error,/job.*completed|job.*cancelled/i);
 assert.equal(result.cleanup,'absent');assert.equal(f.leases.inspect().slots[0].state,'free');
});
function fixture(t,{lost=false,uncertain=false,identity=ci,apiJobName}={}){
 const ci=identity;
 const root=mkdtempSync(join(tmpdir(),'ci-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true}),events=[];
 let registered=false;
 const api={get:async path=>{if(path.endsWith('/runs/789'))return {id:789,run_attempt:1,workflow_id:456,head_sha:ci.workflowSha,status:'in_progress',repository:{id:123},head_repository:{id:123}};if(path.includes('runners'))return {total_count:registered?1:0,runners:registered?[{id:1001,name:'dt-123-789-1-901'}]:[]};
  return {id:901,name:apiJobName??(ci.jobKey==='typecheck'?'typecheck':'test-dashboard (1)'),run_id:789,run_attempt:1,head_sha:ci.workflowSha,status:registered?'completed':'queued',conclusion:registered?'success':null,runner_id:registered?1001:null,runner_name:registered?'dt-123-789-1-901':null};},
 post:async()=>{events.push('register');assert.deepEqual(leases.inspect().slots[0].lease.ci,ci);registered=true;if(lost)throw new Error('lost response');
  return {runner:{id:1001,name:'dt-123-789-1-901'},encoded_jit_config:'synthetic-jit'};},delete:async()=>{events.push('deregister');registered=false;}};
 const transport={healthy:async()=>true,transfer:async()=>events.push('transfer'),prepare:async()=>events.push('prepare'),
 execute:async(lease,{jitconfig})=>{events.push('execute');assert.equal(leases.inspect().slots[0].lease.runnerId,1001);assert.equal(jitconfig,'synthetic-jit');return 0;},
 destroy:async()=>events.push('destroy'),inspect:async lease=>{events.push('inspect');return {resourceId:lease.resourceId,absent:!uncertain};}};
 return {leases,api,transport,events};
}
test('one CI turn persists registration and destroys its VM before deregistration',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t);
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud'});assert.equal(result.code,0);
 assert.deepEqual(f.events,['transfer','prepare','register','execute','destroy','inspect','deregister']);
 assert.equal(f.leases.inspect().slots[0].state,'free');assert.deepEqual(f.leases.inspect().orphanRunners,[]);
});
test('lost registration never remints and reconciliation removes the recorded name after VM destruction',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t,{lost:true});
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud'});assert.equal(result.code,125);
 assert.deepEqual(f.events,['transfer','prepare','register','destroy','inspect','deregister']);
 const replay=await runCI({...f,lane:'I',ci,repository:'fixture/cloud'});assert.equal(replay.code,75);
 assert.equal(f.events.filter(x=>x==='register').length,1);
});
test('uncertain guest cleanup leaves capacity closed and never removes the runner',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t,{uncertain:true});
 assert.equal((await runCI({...f,lane:'I',ci,repository:'fixture/cloud'})).code,125);
 assert.equal(f.leases.inspect().slots[0].state,'quarantined');assert.equal(f.events.includes('deregister'),false);
});

test('foreign runner assignment aborts a still-running guest before its command can finish',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t);let stopped=false;
 f.transport.execute=async(lease,{signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>{stopped=true;reject(new Error('assignment stopped'));},{once:true});
 });
 const get=f.api.get;f.api.get=async(path,options)=>{const value=await get(path,options);return path.includes('/jobs/') && value.runner_id?{...value,runner_id:2002}:value;};
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud',signal:AbortSignal.timeout(300),wait:async()=>{await new Promise(r=>setTimeout(r,1));}});
 assert.equal(stopped,true);assert.equal(result.code,125);assert.match(result.error,/assignment/i);
});
test('uncertain cleanup preserves the original preparation failure in the reported refusal',async t=>{
 const {executeCanary}=await import('./ci-canary.mjs');assert.equal(typeof executeCanary,'function');const f=fixture(t,{uncertain:true});
 const {createHash}=await import('node:crypto');const workflow='reviewed workflow';
 const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:ci.workflowPath,workflowDigest:createHash('sha256').update(workflow).digest('hex')};
 const invocation={nonce:'a'.repeat(32),sourceSha:ci.sourceSha,workflowSha:ci.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1};
 f.leases.setInvocation(invocation);f.transport.prepare=async()=>{throw new Error('original preparation refusal');};
 f.api.get=async path=>path.includes('/contents/')?{content:Buffer.from(workflow).toString('base64'),encoding:'base64'}:
 path.includes('/commits/')?{sha:ci.sourceSha,commit:{tree:{sha:ci.sourceTree}}}:
 path.endsWith('/jobs?per_page=30&page=1')?{total_count:1,jobs:[{id:901,run_id:789,run_attempt:1,head_sha:ci.workflowSha,name:'typecheck',status:'queued',labels:['self-hosted','dt-123-789-1-typecheck'],runner_id:null}]}:
 path.endsWith('/runs/789')?{id:789,run_attempt:1,head_sha:ci.workflowSha,workflow_id:456,path:ci.workflowPath,event:'workflow_dispatch',status:'in_progress',display_title:'disposable-'+invocation.nonce,repository:{id:123},head_repository:{id:123}}:
 {id:123,full_name:'fixture/cloud'};
 await assert.rejects(executeCanary({...f,policy,lane:'I',invocation}),error=>/original preparation refusal/.test(error.message)&&/independent guest absence/.test(error.message));
});

test('JIT registration binds the workflow label and the hosted checkout root',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),post=f.api.post;let workFolder;
 f.api.post=async(path,body,options)=>{assert.deepEqual(body.labels,['self-hosted','dt-123-789-1-typecheck']);workFolder=body.work_folder;return post(path,body,options);};
 assert.equal((await runCI({...f,lane:'I',ci,repository:'fixture/cloud'})).code,0);
 assert.equal(posix.resolve('/opt/actions-runner',workFolder),'/home/runner/work');
});

for(const [label,change] of [
 ['foreign repository',value=>{value.repository.id=999;}],
 ['fork repository',value=>{value.head_repository.id=999;}],
 ['missing head repository',value=>{value.head_repository=null;}]
])test(`registration refuses a ${label} before minting JIT`,async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 f.api.get=async(path,options)=>{const value=await get(path,options);if(path.endsWith('/runs/789'))change(value);return value;};
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud'});assert.equal(result.code,125);assert.equal(f.events.includes('register'),false);
});
test('registration refuses a different shard name before minting JIT',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 f.api.get=async(path,options)=>{const value=await get(path,options);return path.includes('/jobs/')?{...value,name:'test-dashboard (2)'}:value;};
 assert.equal((await runCI({...f,lane:'I',ci,repository:'fixture/cloud'})).code,125);assert.equal(f.events.includes('register'),false);
});
test('ordinary job admission requires its concrete persisted Mac intent before any host work',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const identity={...ci,workflowPath:'.github/workflows/ci.yml',jobKey:'test-dashboard-1'};
 const f=fixture(t,{identity});
 await assert.rejects(runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud'}),/recorded.*CI|CI.*intent/i);
 assert.deepEqual(f.events,[]);assert.equal(f.leases.inspect().slots[0].state,'free');
 f.leases.setInvocation({nonce:'a'.repeat(32),sourceSha:ci.sourceSha,workflowSha:ci.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 assert.equal((await runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud'})).code,0);
});
test('a busy runner with an unassigned intended job aborts the active guest promptly',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t);let stopped=false,registered=false,destroyed=false;
 const destroy=f.transport.destroy;f.transport.destroy=async(...args)=>{destroyed=true;return destroy(...args);};
 f.transport.inspect=async lease=>({resourceId:lease.resourceId,running:!destroyed,absent:destroyed});
 const post=f.api.post;f.api.post=async(...args)=>{const value=await post(...args);registered=true;return value;};
 f.transport.execute=async(lease,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped=true;reject(new Error('runner busy elsewhere'));},{once:true}));
 const get=f.api.get;f.api.get=async(path,options)=>path.endsWith('/runners/1001')?{id:1001,name:'dt-123-789-1-901',busy:true}:
 path.includes('/jobs/')&&registered?{id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:ci.workflowSha,status:'queued',runner_id:null}:get(path,options);
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud',signal:AbortSignal.timeout(300),wait:async()=>{await new Promise(r=>setTimeout(r,1));}});
 assert.equal(stopped,true);assert.equal(result.code,125);assert.match(result.error,/busy|assignment/i);
});

// Exact literal API names, including unsharded UI, must qualify before JIT minting.
for(const [jobKey,apiJobName] of [['test-till-1','test-till (1)'],['test-till-7','test-till (7)'],['test-ui-1','test-ui']])test(`ordinary ${apiJobName} binds its registration and independently cleans up`,async t=>{
 const {runCI}=await import('./ci-canary.mjs');
 const identity={...ci,event:'pull_request',workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,jobKey};
 const f=fixture(t,{identity,apiJobName});
 f.leases.setInvocation({nonce:'a'.repeat(32),sourceSha:identity.sourceSha,workflowSha:identity.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 const result=await runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud'});
 assert.equal(result.code,0,result.error);assert.deepEqual(f.events,['transfer','prepare','register','execute','destroy','inspect','deregister']);
 assert.equal(f.leases.inspect().slots[0].state,'free');assert.deepEqual(f.leases.inspect().orphanRunners,[]);
});

// Treating UI as a matrix could bind a runner to a different, unreviewed job name.
test('UI refuses a matrix-looking API job name before registering',async t=>{
 const {runCI}=await import('./ci-canary.mjs');
 const identity={...ci,event:'pull_request',workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,jobKey:'test-ui-1'};
 const f=fixture(t,{identity,apiJobName:'test-ui (1)'});
 f.leases.setInvocation({nonce:'a'.repeat(32),sourceSha:identity.sourceSha,workflowSha:identity.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901});
 assert.equal((await runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud'})).code,125);
 assert.equal(f.events.includes('register'),false);assert.equal(f.leases.inspect().slots[0].state,'free');
});

for(const [jobKey,apiJobName,label] of [
 ['lint-1','lint','dt-123-789-1-lint-1'],['typecheck-1','typecheck','dt-123-789-1-typecheck-1'],
 ['test-venue-service-4','test-venue-service (4)','dt-123-789-1-test-venue-service-4'],['test-adjustments-1','test-adjustments','dt-123-789-1-test-adjustments-1']
])test(`the routed ${apiJobName} keeps the fixed executor, exact label and cleanup`,async t=>{
 const {runCI}=await import('./ci-canary.mjs');const identity={...ci,event:'pull_request',workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,jobKey};
 const f=fixture(t,{identity,apiJobName}),post=f.api.post,execute=f.transport.execute;
 f.api.post=async(path,body,options)=>{assert.deepEqual(body.labels,['self-hosted',label]);return post(path,body,options);};
 f.transport.execute=async(lease,options)=>{assert.deepEqual(lease.argv,['/opt/actions-runner/bin/Runner.Listener','run']);return execute(lease,options);};
 f.leases.setInvocation({nonce:'a'.repeat(32),sourceSha:identity.sourceSha,workflowSha:identity.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'admitted'});
 const result=await runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud'});assert.equal(result.code,0,result.error);
 assert.deepEqual(f.events,['transfer','prepare','register','execute','destroy','inspect','deregister']);assert.equal(f.leases.inspect().slots[0].state,'free');assert.deepEqual(f.leases.inspect().orphanRunners,[]);
});

test('a cancelled concrete job aborts its idle guest instead of retaining a slot until the guest deadline',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 f.api.get=async(path,options)=>{if(path.endsWith('/runners/1001'))return {id:1001,name:'dt-123-789-1-901',busy:false};
  const value=await get(path,options);
  return path.includes('/jobs/')?{...value,status:'completed',conclusion:'cancelled',runner_id:0}:value;};
 let executing=false;
 const inspect=f.transport.inspect,destroy=f.transport.destroy;
 f.transport.inspect=async(lease,options)=>executing?{resourceId:lease.resourceId,running:true}:inspect(lease,options);
 f.transport.destroy=async(...args)=>{executing=false;return destroy(...args);};
 const read=f.api.get;
 f.api.get=async(path,options)=>{const value=await read(path,options);
  return path.includes('/jobs/') && !executing?{...value,status:'queued',conclusion:null}:value;};
 f.transport.execute=async(_lease,{signal})=>{
  executing=true;
  await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('External deadline elapsed')),{once:true});});
 };
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud',signal:AbortSignal.timeout(300),
  wait:async()=>new Promise(resolve=>setTimeout(resolve,1))});
 assert.equal(result.code,125);assert.match(result.error,/job.*completed|job.*cancelled/i);
 assert.equal(result.cleanup,'absent');assert.equal(f.leases.inspect().slots[0].state,'free');
});

for(const automatic of [true,false])for(const changesDuringHealth of [false,true])test(`${automatic?'automatic':'manual'} admission with hosted mode ${changesDuringHealth?'during':'before'} health`,async t=>{
 const {executeOrdinary}=await import('./ci-canary.mjs');
 const identity={...ci,workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,event:'pull_request'};
 const f=fixture(t,{identity}),get=f.api.get,healthy=f.transport.healthy;let mode=changesDuringHealth?'server':'hosted';
 f.api.get=async(path,options)=>path.endsWith('/DISPOSABLE_TESTS_MODE')?{value:mode}:path.endsWith('/DISPOSABLE_TESTS_HEAD')?{value:automatic?'':identity.sourceSha}:get(path,options);
 f.transport.healthy=async options=>{mode='hosted';return healthy(options);};
 const work=()=>executeOrdinary({...f,ci:identity,policy:{repository:'fixture/cloud'},lane:'I',automatic,fallback:async()=>({retry:false})});
 if(!automatic && !changesDuringHealth)await assert.rejects(work(),/admission is closed/);
 else {
  const result=await work();assert.equal(result.code,automatic?0:125);
  if(!automatic)assert.match(result.error,/admission closed during health/);
 }
 assert.deepEqual(f.events,automatic?['transfer','prepare','register','execute','destroy','inspect','deregister']:[]);
});

for(const automatic of [true,false])test(`${automatic?'automatic':'manual'} admission refuses a selection changed during health`,async t=>{
 const {executeOrdinary}=await import('./ci-canary.mjs');
 const identity={...ci,workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,event:'pull_request'};
 const f=fixture(t,{identity}),get=f.api.get;let selected=automatic?'':identity.sourceSha;
 f.api.get=async(path,options)=>path.endsWith('/DISPOSABLE_TESTS_MODE')?{value:'server'}:path.endsWith('/DISPOSABLE_TESTS_HEAD')?{value:selected}:get(path,options);
 f.transport.healthy=async()=>{selected='9'.repeat(40);return true;};
 const result=await executeOrdinary({...f,ci:identity,policy:{repository:'fixture/cloud'},lane:'I',automatic,fallback:async()=>({retry:false})});
 assert.equal(result.code,125);assert.match(result.error,/selected head changed/);assert.deepEqual(f.events,[]);
});

for(const failure of ['stale status','read failure','uncertain cleanup'])test(`completed ordinary execution reports ${failure} without run-wide fallback`,async t=>{
 const {executeOrdinary}=await import('./ci-canary.mjs');
 const identity={...ci,workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,event:'pull_request'};
 const f=fixture(t,{identity,uncertain:failure==='uncertain cleanup'}),get=f.api.get,execute=f.transport.execute;
 let completed=false,fallbacks=0;
 f.transport.execute=async(...args)=>{await execute(...args);assert.ok(f.leases.inspect().ciInvocation);completed=true;return 0;};
 f.api.get=async(path,options)=>{
  if(path.endsWith('/DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(completed && path.includes('/jobs/')){
   assert.equal(f.leases.inspect().ciInvocation,undefined,'Final API reads must follow retirement of the fallback intent');
   if(failure==='read failure')throw new Error('completion API unavailable');
   const job=await get(path,options);
   return {...job,status:'in_progress',conclusion:null};
  }
  return get(path,options);
 };
 const result=await executeOrdinary({...f,ci:identity,policy:{repository:'fixture/cloud'},lane:'I',automatic:true,
  fallback:async()=>{fallbacks++;return {retry:true};}}).catch(error=>({code:125,error:error.message}));
 assert.equal(fallbacks,0,'A completion doubt must not cancel a running sibling');
 assert.equal(result.code,125);assert.ok(result.completion,'Retain the final execution receipt even when cleanup is uncertain');assert.equal(result.completion.code,0);
 assert.equal(result.completion.expected.runner_id,1001);
 if(failure!=='read failure'){assert.equal(result.completion.observations.at(-1).status,'in_progress');assert.equal(result.completion.observations.length,5);}
 assert.equal(result.cleanup,failure==='uncertain cleanup'?'quarantined':'absent');
 assert.equal(f.leases.inspect().ciInvocation,undefined,'Recovery must not retain a cancellation intent after execution ends');
 assert.equal(f.leases.inspect().slots[0].state,failure==='uncertain cleanup'?'quarantined':'free');
 if(failure==='uncertain cleanup'){
  const {writeFileSync}=await import('node:fs'),{dirname}=await import('node:path');
  const {reconcileManual}=await import('./manual.mjs'),state=dirname(f.leases.directory);
  writeFileSync(join(state,'mac-controller.lock'),'',{mode:0o600});
  f.transport.inspect=async lease=>({resourceId:lease.resourceId,absent:true});
  f.api.get=async(path,options)=>{assert.ok(path.includes('/runners'),'Recovery must only remove the recorded runner');return get(path,options);};
  assert.equal((await reconcileManual({...f,state,hostGeneration:'fixture',slots:1,ci:{repository:'fixture/cloud',workflowPath:identity.workflowPath}})).code,0);
  assert.equal(f.leases.inspect().slots[0].state,'free');assert.deepEqual(f.leases.inspect().orphanRunners,[]);
 }
});

test('a completed listener waits for an exact GitHub success after a stale status read',async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 let completedReads=0;
 f.api.get=async(path,options)=>{const job=await get(path,options);
  if(path.includes('/jobs/') && job.runner_id && ++completedReads===1)return {...job,status:'in_progress',conclusion:null};
  return job;
 };
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud',wait:async(ms,_value,{signal}={})=>{if(ms===15000)await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('monitor ended')),{once:true}));}});
 assert.equal(result.code,0,result.error);assert.equal(completedReads,2);assert.equal(result.completion.observations[0].status,'in_progress');
 assert.equal(result.completion.observations.at(-1).status,'completed');assert.equal(result.completion.observations.at(-1).conclusion,'success');
});

for(const [field,value] of [['id',902],['run_id',790],['run_attempt',2],['head_sha','9'.repeat(40)],
 ['runner_id',2002],['runner_name','foreign-runner'],['conclusion','failure'],['status','unknown']])test(`completion never accepts a changed ${field}`,async t=>{
 const {runCI}=await import('./ci-canary.mjs');const f=fixture(t),get=f.api.get;
 f.api.get=async(path,options)=>{const job=await get(path,options);return path.includes('/jobs/') && job.runner_id?{...job,[field]:value}:job;};
 const result=await runCI({...f,lane:'I',ci,repository:'fixture/cloud'});
 assert.equal(result.code,125);assert.match(result.error,/did not qualify/);
 assert.equal(result.completion.observations.length,1);assert.equal(result.completion.observations[0][field],value);
 assert.equal(result.cleanup,'absent');assert.deepEqual(f.leases.inspect().orphanRunners,[]);
});

for(const status of ['in_progress','completed'])test(`a failed listener keeps ordinary recovery when GitHub is ${status}`,async t=>{
 const {executeOrdinary}=await import('./ci-canary.mjs');
 const identity={...ci,workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,event:'push'};
 const f=fixture(t,{identity}),get=f.api.get,post=f.api.post,execute=f.transport.execute;
 let ended=false,marker='{}';const writes=[];
 f.transport.execute=async(...args)=>{await execute(...args);ended=true;return 137;};
 f.api.get=async(path,options)=>{
  if(path.endsWith('/DISPOSABLE_TESTS_HEAD'))return {value:''};
  if(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  const value=await get(path,options);
  if(path.endsWith('/runs/789'))return {...value,event:'push'};
  return ended && path.includes('/jobs/')?{...value,status,conclusion:status==='completed'?'success':null}:value;
 };
 f.api.patch=async(path,body)=>{assert.ok(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));writes.push('marker');marker=body.value;};
 f.api.post=async(path,...args)=>{if(path.endsWith('/cancel')){writes.push('cancel');return;}return post(path,...args);};
 const result=await executeOrdinary({...f,ci:identity,policy:{repository:'fixture/cloud'},lane:'I',automatic:true});
 assert.deepEqual(writes,status==='completed'?[]:['marker','cancel']);
 assert.equal(result.code,125);assert.equal(result.completion.code,137);
 assert.equal(result.cleanup,'absent');assert.equal(result.pending,status==='completed'?undefined:true);
 assert.equal(f.leases.inspect().ciInvocation?.ordinaryStage,status==='completed'?undefined:'cancel-requested');
});

test('stopping final readback still cleans up without cancelling the run',async t=>{
 const {executeOrdinary}=await import('./ci-canary.mjs'),stop=new AbortController();
 const identity={...ci,workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,event:'pull_request'};
 const f=fixture(t,{identity}),get=f.api.get;let stopped=false;
 f.api.get=async(path,options)=>{
  if(path.endsWith('/DISPOSABLE_TESTS_HEAD'))return {value:''};
  const value=await get(path,options);
  if(path.includes('/jobs/') && value.runner_id){setImmediate(()=>{stopped=true;stop.abort();});return {...value,status:'in_progress',conclusion:null};}
  return value;
 };
 const result=await executeOrdinary({...f,ci:identity,policy:{repository:'fixture/cloud'},lane:'I',automatic:true,
  signal:stop.signal,fallback:async()=>assert.fail('A final-read stop must not cancel siblings')});
 assert.equal(stopped,true);assert.equal(result.code,143);assert.equal(result.completion.code,0);
 assert.equal(result.cleanup,'absent');assert.equal(f.leases.inspect().ciInvocation,undefined);
 assert.deepEqual(f.leases.inspect().orphanRunners,[]);
});

async function monitorReadFailure(t, {failure, guestRunning=true}={}) {
 const {runCI}=await import('./ci-canary.mjs');
 const identity={...ci,event:'push',workflowPath:'.github/workflows/ci.yml',sourceSha:ci.workflowSha,jobKey:'test-workforce-1'};
 const f=fixture(t,{identity,apiJobName:'test-workforce'}),get=f.api.get,inspect=f.transport.inspect;
 f.leases.setInvocation({nonce:'c'.repeat(32),sourceSha:identity.sourceSha,workflowSha:identity.workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,jobId:901,ordinaryStage:'admitted'});
 const originalNow=Date.now;let elapsed=0,executing=false,aborted=false,finish,liveInspections=0;
 Date.now=()=>originalNow()+elapsed;t.after(()=>{Date.now=originalNow;});
 f.api.get=async(path,options)=>{
  if(executing && failure && path.endsWith('/runs/789'))throw failure;
  const value=await get(path,options);
  return executing && path.includes('/jobs/')?{...value,status:'in_progress',conclusion:null}:value;
 };
 f.transport.execute=async(_lease,{signal})=>{
  executing=true;
  try {await new Promise((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>{aborted=true;reject(new Error('execution aborted'));},{once:true});});return 0;}
  finally {executing=false;}
 };
 f.transport.inspect=async(lease,options)=>{
  if(executing){liveInspections++;if(guestRunning && liveInspections===3)finish();return {resourceId:lease.resourceId,running:guestRunning};}
  return inspect(lease,options);
 };
 const result=await runCI({...f,lane:'I',ci:identity,repository:'fixture/cloud',signal:AbortSignal.timeout(2000),wait:async(ms)=>{if(ms===15000)elapsed+=61000;await new Promise(resolve=>setTimeout(resolve,1));}});
 return {...result,aborted,liveInspections,events:f.events};
}

for(const [label,failure] of [
 ['network',new TypeError('fetch failed')],
 ['timeout',Object.assign(new Error('request timed out'),{name:'TimeoutError'})],
 ['HTTP 500',Object.assign(new Error('GitHub GET refused (500)'),{status:500})],
 ['HTTP 503',Object.assign(new Error('GitHub GET refused (503)'),{status:503})],
 ['HTTP 599',Object.assign(new Error('GitHub GET refused (599)'),{status:599})],
 ['interrupted body',Object.assign(new Error('GitHub response interrupted'),{code:'GITHUB_RESPONSE_INTERRUPTED'})],
])test(`transient GitHub reads (${label}) preserve an independently healthy ordinary guest`,async t=>{
 const result=await monitorReadFailure(t,{failure});
 assert.equal(result.code,0,result.error);assert.equal(result.aborted,false);assert.equal(result.liveInspections,3);
 assert.equal(result.cleanup,'absent');assert.ok(result.events.includes('deregister'));
});

test('transient GitHub reads still stop an independently missing ordinary guest',async t=>{
 const result=await monitorReadFailure(t,{failure:new TypeError('fetch failed'),guestRunning:false});
 assert.equal(result.code,125);assert.equal(result.aborted,true);assert.equal(result.liveInspections,1);
 assert.match(result.error,/guest is no longer running/);assert.equal(result.cleanup,'absent');
});

for(const status of [401,403])test(`permanent GitHub HTTP ${status} retains the existing monitor stop`,async t=>{
 const result=await monitorReadFailure(t,{failure:Object.assign(new Error('GitHub read refused'),{status})});
 assert.equal(result.code,125);assert.equal(result.aborted,true);assert.equal(result.liveInspections,0);
 assert.equal(result.error,'GitHub read refused');assert.equal(result.cleanup,'absent');
});

test('ordinary monitor checks retain a healthy guest with the same elapsed clock',async t=>{
 const result=await monitorReadFailure(t);assert.equal(result.code,0,result.error);
 assert.equal(result.aborted,false);assert.equal(result.liveInspections,3);assert.equal(result.cleanup,'absent');
});
