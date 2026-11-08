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
 path.endsWith('/jobs?per_page=100')?{total_count:1,jobs:[{id:901,run_id:789,run_attempt:1,head_sha:ci.workflowSha,name:'typecheck',status:'queued',labels:['self-hosted','dt-123-789-1-typecheck'],runner_id:null}]}:
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
