import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ciIdentity,routingLabel} from './ci-identity.mjs';

export function admitCI(policy,input,{repository,run,job,workflow,source}){
 assert.ok(repository.id===policy.repositoryId && repository.full_name===policy.repository,'Foreign CI repository');
 assert.ok(run.id===input.runId && run.run_attempt===input.attempt && run.repository?.id===policy.repositoryId &&
  run.head_repository?.id===policy.repositoryId && run.workflow_id===policy.workflowId && run.path===policy.workflowPath &&
  run.event==='workflow_dispatch' && run.display_title==='disposable-'+input.nonce && ['queued','in_progress'].includes(run.status),'Unapproved or stale CI run identity');
 assert.equal(createHash('sha256').update(workflow).digest('hex'),policy.workflowDigest,'CI workflow definition changed');
 assert.ok(source.sha===input.sourceSha,'CI source commit differs');
 const ci=ciIdentity({repositoryId:repository.id,workflowId:run.workflow_id,workflowPath:run.path,
  workflowSha:run.head_sha,workflowDigest:policy.workflowDigest,event:run.event,sourceSha:source.sha,sourceTree:source.commit.tree.sha,
  runId:run.id,attempt:run.run_attempt,jobId:job.id,jobKey:'typecheck'});
 assert.ok(job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha &&
  job.name===ci.jobKey && job.status==='queued' && !job.runner_id && Array.isArray(job.labels) &&
  job.labels.length===2 && job.labels.includes('self-hosted') && job.labels.includes(routingLabel(ci)),'Foreign or already assigned CI job');
 return ci;
}
export async function fallbackCI({api,policy,invocation,dispatch,signal,wait=delay}){
 const path=`/repos/${policy.repository}/actions/runs/${invocation.runId}`;
 const current=await api.get(path,{signal});
 assert.equal(current.run_attempt,invocation.attempt,'Stale CI attempt; cancellation refused');
 assert.equal(current.workflow_id,policy.workflowId,'Foreign CI workflow');
 assert.equal(current.display_title,'disposable-'+invocation.nonce,'Foreign CI invocation');
 if(current.status!=='completed'){
  await api.post(path+'/cancel',undefined,{signal});
  const deadline=Date.now()+120000;
  while(true){const run=await api.get(path,{signal});assert.equal(run.run_attempt,invocation.attempt,'CI attempt changed during cancellation');
   if(run.status==='completed')break;
   assert.ok(Date.now()<deadline,'CI cancellation readback deadline exceeded');await wait(15000,undefined,{signal});}
 }
 return dispatch({sourceSha:invocation.sourceSha,route:'hosted'});
}

export async function cancelCIJob({api,repository,ci,signal,wait=delay}){
 assert.ok(Number.isSafeInteger(ci.jobId) && ci.jobId>0,'Recorded CI job identity is missing');
 const path=`/repos/${repository}/actions/runs/${ci.runId}`;
 const run=await api.get(path,{signal});
 assert.ok(run.id===ci.runId && run.workflow_id===ci.workflowId && run.head_sha===ci.workflowSha &&
  run.repository?.id===ci.repositoryId && run.head_repository?.id===ci.repositoryId,'Recorded CI cancellation identity differs');
 const job=await api.get(`/repos/${repository}/actions/jobs/${ci.jobId}`,{signal});
 assert.ok(job.id===ci.jobId && job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha,'Recorded CI job identity differs');
 if(job.status==='completed')return;
 assert.equal(run.run_attempt,ci.attempt,'Recorded CI cancellation attempt differs');
 if(run.status==='completed')return;
 await api.post(path+'/cancel',undefined,{signal});const end=Date.now()+120000;
 while(true){const current=await api.get(path,{signal});assert.equal(current.run_attempt,ci.attempt,'CI attempt changed during cancellation');
  if(current.status==='completed')return;
  assert.ok(Date.now()<end,'CI cancellation readback deadline exceeded');await wait(15000,undefined,{signal});}
}

async function namedRunners(api,repository,name,signal){
 const found=[];
 for(let page=1;page<=10;page++){
  const data=await api.get(`/repos/${repository}/actions/runners?per_page=100&page=${page}`,{signal});
  assert.ok(Array.isArray(data.runners) && Number.isSafeInteger(data.total_count) && data.total_count<=1000,'Runner inventory exceeds bound');
  found.push(...data.runners.filter(runner=>runner.name===name));
  if(page*100>=data.total_count)return found;
 }
 throw new Error('Incomplete runner inventory');
}
export async function cleanupRunners({leases,api,repository,signal}){
 for(const orphan of leases.inspect().orphanRunners??[]){
  const found=await namedRunners(api,repository,orphan.runnerName,signal);
  assert.ok(found.length<=1,'Duplicate CI runner name');
  for(const runner of found){assert.ok(Number.isSafeInteger(runner.id) && runner.id>0 &&
   (orphan.runnerId===null || orphan.runnerId===runner.id),'CI runner ID differs; removal refused');
   await api.delete(`/repos/${repository}/actions/runners/${runner.id}`,{signal});}
  assert.equal((await namedRunners(api,repository,orphan.runnerName,signal)).length,0,'CI runner removal unconfirmed');
  leases.forgetRunner(orphan);
 }
}
export async function runCI({leases,transport,api,repository,lane,ci,signal,wait=delay}){
 const {ciRequest,runnerName,jobName}=await import('./ci-identity.mjs');
 const {runLocal}=await import('./local.mjs');
 ci=ciIdentity(ci);
 if(ci.workflowPath==='.github/workflows/ci.yml'){
  const pending=leases.inspect().ciInvocation;
  assert.ok(pending && pending.runId===ci.runId && pending.attempt===ci.attempt && pending.jobId===ci.jobId &&
   pending.sourceSha===ci.sourceSha && pending.workflowSha===ci.workflowSha,'Ordinary CI needs its recorded concrete Mac intent');
 }
 const base=`/repos/${repository}/actions`,name=runnerName(ci);
 const result=await runLocal({leases,request:ciRequest(lane,ci),signal,transport:{
  healthy:options=>transport.healthy(options),transfer:(lease,options)=>transport.transfer(lease,options),
  prepare:(lease,options)=>transport.prepare(lease,options),
  execute:async(lease,options)=>{
   const run=await api.get(`${base}/runs/${ci.runId}`,options),job=await api.get(`${base}/jobs/${ci.jobId}`,options);
   assert.ok(run.id===ci.runId && run.run_attempt===ci.attempt && run.workflow_id===ci.workflowId && run.head_sha===ci.workflowSha &&
    ['queued','in_progress'].includes(run.status) && run.repository?.id===ci.repositoryId && run.head_repository?.id===ci.repositoryId &&
    job.name===jobName(ci) && job.id===ci.jobId && job.run_id===ci.runId && job.run_attempt===ci.attempt &&
    job.head_sha===ci.workflowSha && job.status==='queued' && !job.runner_id,'CI identity changed before registration');
   assert.equal((await namedRunners(api,repository,name,options.signal)).length,0,'CI runner name already registered; do not remint');
   const registration=await api.post(`${base}/runners/generate-jitconfig`,{
    name,runner_group_id:1,labels:['self-hosted',routingLabel(ci)],work_folder:'_work'},options);
   assert.ok(registration.runner?.name===name && Number.isSafeInteger(registration.runner.id) && registration.runner.id>0 &&
    typeof registration.encoded_jit_config==='string' && registration.encoded_jit_config.length>0 && registration.encoded_jit_config.length<=64000,'Invalid CI registration response');
   assert.ok(leases.bindRunner(lease,registration.runner.id),'CI runner lease changed before binding');
   const execution=new AbortController(),monitor=new AbortController();let ended=false,monitorFailure;
   const work=AbortSignal.any([options.signal,execution.signal]);
   const watching=(async()=>{
    let healthyAt=Date.now();
    while(!ended){
     try{await wait(15000,undefined,{signal:monitor.signal});}catch{if(ended)return;throw new Error('CI monitor stopped');}
     if(ended)return;
     try{
      const current=await api.get(`${base}/runs/${ci.runId}`,{signal:work});
      assert.equal(current.run_attempt,ci.attempt,'CI attempt changed during execution');
      const job=await api.get(`${base}/jobs/${ci.jobId}`,{signal:work});
      assert.ok(!job.runner_id || job.runner_id===registration.runner.id,'CI runner assignment differs');
      if(!job.runner_id){
       const runner=await api.get(`${base}/runners/${registration.runner.id}`,{signal:work});
       assert.ok(runner.id===registration.runner.id && runner.name===name,'CI runner assignment readback identity differs');
       assert.equal(runner.busy,false,'CI runner assignment is busy elsewhere');
      }
      if(job.status==='queued')assert.ok(Date.now()-lease.createdAt<900000,'CI queue deadline exceeded');
      const observed=await transport.inspect(lease,{signal:work});
      assert.ok(observed.running===true,'CI guest is no longer running');healthyAt=Date.now();
     }catch(error){
      if(/assignment|attempt|deadline|no longer running/i.test(error.message) || Date.now()-healthyAt>=60000)throw error;
     }
    }
   })().catch(error=>{monitorFailure=error;execution.abort();});
   let code;
   try{code=await transport.execute(lease,{signal:work,jitconfig:registration.encoded_jit_config});}
   catch(error){throw monitorFailure??error;}
   finally{ended=true;monitor.abort();await watching;}
   if(monitorFailure)throw monitorFailure;
   const observed=await api.get(`${base}/jobs/${ci.jobId}`,options);
   assert.ok(code===0 && observed.id===ci.jobId && observed.run_id===ci.runId && observed.run_attempt===ci.attempt &&
    observed.head_sha===ci.workflowSha && observed.runner_id===registration.runner.id && observed.runner_name===name &&
    observed.status==='completed' && observed.conclusion==='success','CI assignment or job completion did not qualify');
   return code;
  },destroy:(lease,options)=>transport.destroy(lease,options),inspect:(lease,options)=>transport.inspect(lease,options)
 }});
 if(result.cleanup==='absent'){
  try{await cleanupRunners({leases,api,repository,signal:AbortSignal.timeout(120000)});}
  catch{return {...result,code:125,runnerCleanup:'pending'};}
 }
 return result;
}

export async function dispatchCanary({api,leases,policy,sourceSha,workflowSha,route,signal,wait=delay}){
 const {randomBytes}=await import('node:crypto');
 let invocation=leases.inspect().ciInvocation;
 if(!invocation){invocation={nonce:randomBytes(16).toString('hex'),sourceSha,workflowSha,route,createdAt:Date.now(),runId:null,attempt:null};
  leases.setInvocation(invocation);
  // A lost dispatch response is ambiguous. Persist before sending, and never
  // repeat this POST: reconcile the unique run-name or leave the intent intact.
  try{await api.post(`/repos/${policy.repository}/actions/workflows/${policy.workflowId}/dispatches`,{
   ref:policy.workflowRef??'main',inputs:{source_sha:sourceSha,nonce:invocation.nonce,route}}, {signal});}catch(error){
   if(Number.isInteger(error.status) && error.status>=400 && error.status<500 && error.status!==408){
    leases.clearInvocation(invocation.nonce);throw error;
   }
   signal?.throwIfAborted();
  }
 }else{assert.ok(invocation.sourceSha===sourceSha && invocation.workflowSha===workflowSha && invocation.route===route,'Existing CI invocation must be reconciled first');}
 if(invocation.runId!==null)return invocation;
 const end=invocation.createdAt+120000;
 while(true){
  const data=await api.get(`/repos/${policy.repository}/actions/workflows/${policy.workflowId}/runs?event=workflow_dispatch&per_page=100`,{signal});
  assert.ok(Array.isArray(data.workflow_runs) && data.workflow_runs.length<=100,'Invalid dispatch inventory');
  const matches=data.workflow_runs.filter(run=>run.display_title==='disposable-'+invocation.nonce);
  assert.ok(matches.length<=1,'Ambiguous CI dispatch response');
  if(matches.length){const run=matches[0];assert.ok(run.workflow_id===policy.workflowId && run.event==='workflow_dispatch','Dispatched run identity differs');
   invocation={...invocation,runId:run.id,attempt:run.run_attempt};leases.setInvocation(invocation);
   if(run.head_sha!==workflowSha)return retireMovedDispatch({api,leases,policy,invocation,signal,wait});
   return invocation;}
  if(Date.now()>=end){
   leases.clearInvocation(invocation.nonce);
   throw new Error('CI dispatch remains unconfirmed; intent retired without qualification or redispatch');
  }
  await wait(15000,undefined,{signal});
 }
}
export async function startCanary({api,leases,policy,sourceSha,workflowSha,transport,signal,wait=delay}){
 assert.match(sourceSha,/^[a-f0-9]{40}$/);assert.match(workflowSha,/^[a-f0-9]{40}$/);
 assert.equal(leases.inspect().slots[0].state,'free','Disposable slot is occupied');
 assert.equal((await api.get(`/repos/${policy.repository}/actions/permissions/fork-pr-contributor-approval`,{signal})).approval_policy,'all_external_contributors','External contributor approval is not enabled');
 const blob=await api.get(`/repos/${policy.repository}/contents/${policy.workflowPath}?ref=${workflowSha}`,{signal});
 assert.equal(blob.encoding,'base64');assert.equal(createHash('sha256').update(Buffer.from(blob.content,'base64')).digest('hex'),policy.workflowDigest,'Reviewed workflow digest differs');
 const source=await api.get(`/repos/${policy.repository}/commits/${sourceSha}`,{signal});assert.equal(source.sha,sourceSha);
 let healthy=false;try{healthy=await transport.healthy({signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7500)]):AbortSignal.timeout(7500)});}catch{signal?.throwIfAborted();}
 return dispatchCanary({api,leases,policy,sourceSha,workflowSha,route:healthy?'server':'hosted',signal,wait});
}

async function retireMovedDispatch({api,leases,policy,invocation,signal,wait}){
 return fallbackCI({api,policy,invocation,signal,wait,dispatch:async()=>{
  leases.clearInvocation(invocation.nonce);throw new Error('Dispatched workflow commit changed; owned run retired');
 }});
}
export async function recoverCanary({api,leases,policy,signal,wait=delay}){
 assert.ok(leases.inspect().slots.every(slot=>slot.state==='free'),'CI recovery waits for independent guest absence');
 let invocation=leases.inspect().ciInvocation;
 if(!invocation)return null;
 invocation=await dispatchCanary({api,leases,policy,...invocation,signal,wait});
 const recorded=await api.get(`/repos/${policy.repository}/actions/runs/${invocation.runId}`,{signal});
 if(recorded.head_sha!==invocation.workflowSha)return retireMovedDispatch({api,leases,policy,invocation,signal,wait});
 if(invocation.route==='hosted' || invocation.serverRunnerId!==undefined){
  const run=await api.get(`/repos/${policy.repository}/actions/runs/${invocation.runId}`,{signal});
  assert.ok(run.id===invocation.runId && run.run_attempt===invocation.attempt && run.workflow_id===policy.workflowId &&
   run.head_sha===invocation.workflowSha && run.display_title==='disposable-'+invocation.nonce && run.event==='workflow_dispatch','Hosted recovery identity differs');
  if(run.status==='completed' && run.conclusion!=='success'){
   leases.clearInvocation(invocation.nonce);
   throw new Error(`Canary ${invocation.runId} finished ${run.conclusion}; no passing qualification`);
  }
  return invocation;
 }
 return fallbackCI({api,policy,invocation,signal,wait,dispatch:async({sourceSha,route})=>{
  leases.clearInvocation(invocation.nonce);
  return dispatchCanary({api,leases,policy,sourceSha,workflowSha:invocation.workflowSha,route,signal,wait});
 }});
}

export async function qualifyCanary({api,policy,invocation,signal}){
 const base=`/repos/${policy.repository}`,run=await api.get(`${base}/actions/runs/${invocation.runId}`,{signal});
 assert.ok(run.id===invocation.runId && run.run_attempt===invocation.attempt && run.workflow_id===policy.workflowId &&
  run.head_sha===invocation.workflowSha && run.event==='workflow_dispatch' && run.display_title==='disposable-'+invocation.nonce &&
  run.status==='completed' && run.conclusion==='success','CI run is not qualified');
 const inventory=await api.get(`${base}/actions/runs/${invocation.runId}/attempts/${invocation.attempt}/jobs?per_page=100`,{signal});
 assert.ok(inventory.total_count===2 && inventory.jobs.length===2 && new Set(inventory.jobs.map(j=>j.name)).size===2 &&
  inventory.jobs.every(job=>['typecheck','summary'].includes(job.name) && job.run_id===invocation.runId && job.run_attempt===invocation.attempt &&
   job.head_sha===invocation.workflowSha && job.status==='completed' && job.conclusion==='success' && Number.isSafeInteger(job.runner_id) && job.runner_id>0),'CI jobs are incomplete or failed');
 const job=inventory.jobs.find(j=>j.name==='typecheck'),summary=inventory.jobs.find(j=>j.name==='summary');
 const label=`dt-${policy.repositoryId}-${invocation.runId}-${invocation.attempt}-typecheck`;
 assert.ok(invocation.route==='server'?job.labels.includes(label) && job.labels.includes('self-hosted'):
  job.labels.includes('ubuntu-latest') && !job.labels.includes('self-hosted'),'CI route differs');
 if(invocation.serverRunnerId!==undefined)assert.ok(job.runner_id===invocation.serverRunnerId && job.runner_name===`dt-${policy.repositoryId}-${invocation.runId}-${invocation.attempt}-${job.id}`,'Completed CI runner assignment differs');
 assert.ok(summary.labels.includes('ubuntu-latest') && !summary.labels.includes('self-hosted'),'CI summary route differs');
 const source=await api.get(`${base}/commits/${invocation.sourceSha}`,{signal});assert.equal(source.sha,invocation.sourceSha);
 const log=await api.jobLog(`${base}/actions/jobs/${job.id}/logs`,{signal});
 assert.ok(log.includes(`Source ${invocation.sourceSha} tree ${source.commit.tree.sha}`),'CI checkout source/tree is not verified');
 return {runId:run.id,attempt:run.run_attempt,workflowSha:run.head_sha,sourceSha:source.sha,sourceTree:source.commit.tree.sha,
  route:invocation.route,jobs:inventory.jobs.map(({id,name,runner_id,runner_name})=>({id,name,runner_id,runner_name}))};
}
async function waitCanary({api,policy,invocation,signal,wait=delay}){
 const end=invocation.createdAt+3300000;
 while(true){const run=await api.get(`/repos/${policy.repository}/actions/runs/${invocation.runId}`,{signal});
  assert.equal(run.run_attempt,invocation.attempt,'CI run attempt changed');
  if(run.status==='completed')return qualifyCanary({api,policy,invocation,signal});
  assert.ok(Date.now()<end,'CI overall deadline exceeded');await wait(15000,undefined,{signal});}
}
export async function executeCanary({api,policy,leases,transport,lane,invocation,signal}){
 if(invocation.route==='server'){
  try{
   const base=`/repos/${policy.repository}`;let ci;
   while(!ci){
    signal?.throwIfAborted();assert.ok(Date.now()-invocation.createdAt<900000,'CI queue deadline exceeded');
    const run=await api.get(`${base}/actions/runs/${invocation.runId}`,{signal});
    const jobs=await api.get(`${base}/actions/runs/${invocation.runId}/attempts/${invocation.attempt}/jobs?per_page=100`,{signal});
    assert.ok(jobs.total_count<=2 && jobs.jobs.length===jobs.total_count,'Unexpected CI job inventory');
    const candidates=jobs.jobs.filter(job=>job.name==='typecheck');assert.ok(candidates.length<=1,'Ambiguous typecheck job');
    if(candidates.length){const blob=await api.get(`${base}/contents/${policy.workflowPath}?ref=${run.head_sha}`,{signal});
     assert.equal(blob.encoding,'base64');ci=admitCI(policy,invocation,{repository:await api.get(base,{signal}),run,job:candidates[0],
      workflow:Buffer.from(blob.content,'base64').toString(),source:await api.get(`${base}/commits/${invocation.sourceSha}`,{signal})});}
    else await delay(15000,undefined,{signal});
   }
   const executed=await runCI({api,leases,policy,repository:policy.repository,ci,lane,transport,signal});
   assert.ok(executed.code===0 && executed.cleanup==='absent' && !executed.runnerCleanup,executed.error??'Server CI execution did not qualify');
   invocation={...invocation,serverRunnerId:executed.lease.runnerId};leases.setInvocation(invocation);
  }catch(error){
   // The guest cleanup path runs before this handoff. Unknown absence retains
   // the lease, so recovery cannot register another runner for that slot.
   let fallback;
   try{fallback=await recoverCanary({api,leases,policy,signal:AbortSignal.timeout(240000)});}
   catch(recovery){throw new AggregateError([error,recovery],`Server CI failure: ${error.message}; recovery: ${recovery.message}`);}
   console.error('Server canary did not qualify; same source dispatched on hosted.');
   if(signal?.aborted)return {code:143,runId:fallback.runId,route:'hosted'};
   invocation=fallback;
  }
 }
 return invocation;
}
export async function withCanaryController({state,hostGeneration,admit,api,policy,signal}){
 const {withKernelLock}=await import('./kernel-lock.mjs'),{LocalLeases}=await import('./leases.mjs');
 const invocation=await withKernelLock(state,admit,{deadline:Date.now()+7500,signal});
 if(invocation.code!==undefined)return invocation;
 const receipt=await waitCanary({api,policy,invocation,signal});
 const cleared=await withKernelLock(state,async()=>{
  const leases=new LocalLeases(state+'/ledger',{hostGeneration,slots:1});
  leases.clearInvocation(invocation.nonce);return {code:0};
 },{deadline:Date.now()+7500,signal});
 return {code:0,...receipt,...(cleared.code===75?{recordCleanup:'pending'}:{})};
}
export async function main(args){
 assert.ok(args.length===3 || args.length===4 && args[3]==='--hosted','Usage: ci-canary.mjs CONFIG LANE SOURCE_SHA [--hosted]');
 const [configuration,lane,sourceSha]=args;assert.match(lane,/^[A-K]$/);assert.match(sourceSha,/^[a-f0-9]{40}$/);
 const {readFileSync}=await import('node:fs');
 const {LocalLeases}=await import('./leases.mjs');
 const {refuseLegacy,withTemporaryState}=await import('./manual.mjs');
 const {CITransport}=await import('./transport.mjs'),{GithubApp}=await import('./github-app.mjs');
 const config=JSON.parse(readFileSync(configuration,'utf8'));validateCIConfig(config);
 assert.equal(config.ci.workflowPath,'.github/workflows/disposable-ci-canary.yml','The canary entry accepts only its reviewed canary workflow');
 const api=new GithubApp(config.ci),policy=config.ci;
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,cancel);
 try{return await withCanaryController({state:config.state,hostGeneration:config.hostGeneration,api,policy,signal:cancellation.signal,admit:async()=>{
  refuseLegacy(config.state);return withTemporaryState(config.state,async()=>{
   const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots:1});
   if(leases.inspect().ciInvocation)return {code:75,reason:'recorded-ci-invocation-needs-recovery'};
   if(leases.inspect().slots.some(slot=>slot.state!=='free'))return {code:75,reason:'capacity-busy'};
   const transport=new CITransport(config),workflowSha=(await api.get(`/repos/${policy.repository}/git/ref/heads/main`)).object.sha;
   const invocation=await startCanary({api,policy,leases,sourceSha,workflowSha,transport:args[3]==='--hosted'?{healthy:async()=>false}:transport,signal:cancellation.signal});
   return executeCanary({api,policy,leases,transport,lane,invocation,signal:cancellation.signal});
  });
 }});}
 finally{for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.off(name,cancel);}
}
export function validateCIConfig(config){
 assert.deepEqual(Object.keys(config).sort(),['ci','host','hostGeneration','mode','recipe','repository','state','version']);
 assert.ok(config.version===2 && config.mode==='manual-one-slot','Invalid coupled CI configuration');
 const ci=config.ci;assert.deepEqual(Object.keys(ci).sort(),['appEnv','appKey','repository','repositoryId','workflowDigest','workflowId','workflowPath']);
 assert.ok(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(ci.repository) && ['.github/workflows/disposable-ci-canary.yml','.github/workflows/ci.yml'].includes(ci.workflowPath) &&
  [ci.repositoryId,ci.workflowId].every(v=>Number.isSafeInteger(v)&&v>0),'Invalid CI policy identity');
 assert.match(ci.workflowDigest,/^[a-f0-9]{64}$/);
 for(const path of [config.state,ci.appEnv,ci.appKey])assert.ok(typeof path==='string' && path.startsWith('/'),'CI paths must be absolute');
}
const cli=process.argv[1];
if(cli && cli!=='-'){
 const {realpathSync}=await import('node:fs'),{pathToFileURL}=await import('node:url');
 if(import.meta.url===pathToFileURL(realpathSync(cli)).href){try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));process.exitCode=result.code;}
 catch(error){console.error(error.message);process.exitCode=125;}}
}
