import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {GithubApp} from './github-app.mjs';
import {LocalLeases,configuredSlots,withAvailableSlot} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {CITransport,protectOutputStreams,runProcess} from './transport.mjs';
import {validateCIConfig,routingMode,setRoutingMode,routingHead,setRoutingHead,findOrdinary,executeOrdinary,qualifyOrdinaryHosted,findAutomatic,fallbackOrdinary,overflowOrdinary,recoverHostedAttempts,hostedAttempts} from './ci-canary.mjs';

export async function withOrdinaryController({state,hostGeneration,api,policy,approvedHead,runId,lane,transport,signal,wait=delay}){
 const {refuseLegacy,withTemporaryState}=await import('./manual.mjs');
 const end=Date.now()+900000;
 while(true){
  assert.equal(await routingMode({api,policy,signal}),'server','Server routing is disabled');
  assert.equal(await routingHead({api,policy,signal}),approvedHead,'Ordinary CI selected head differs');
  const ci=await findOrdinary({api,policy,approvedHead,runId,signal});
  if(ci){const result=await withKernelLock(state,async()=>{
   refuseLegacy(state);return withTemporaryState(state,async()=>{
    const leases=new LocalLeases(state+'/ledger',{hostGeneration,slots:1});
    if(leases.inspect().ciInvocation || leases.inspect().slots.some(slot=>slot.state!=='free'))return {code:75,reason:'capacity-busy'};
    return executeOrdinary({api,policy,leases,ci,lane,transport,signal});
   });
  },{deadline:Date.now()+7500,signal});
   if(result.retry)return {...result,code:0,hosted:await qualifyOrdinaryHosted({api,policy,retry:result,signal,wait})};
   return result;
  }
  assert.ok(Date.now()<end,'Ordinary CI queue deadline exceeded');await wait(15000,undefined,{signal});
 }
}

// Each child owns one slot lock and its temporary directory through guest cleanup.
export async function automaticTick({configuration,config,api,signal,runWorker,transport,recover,wait=delay}){
 const policy=config.ci,slots=configuredSlots(config);
 const active=new Map(),seen=new Set(),refusedRuns=new Set(),cleanups=[];
 const waitForWorker=async()=>{
  const wake=new AbortController();
  try{await Promise.race([...active.keys(),delay(30000,undefined,{signal:signal?AbortSignal.any([signal,wake.signal]):wake.signal})]);}
  finally{wake.abort();}
 };
 const pendingFailure=(error,runId)=>{
  signal?.throwIfAborted();
  if(error.status===401 || error.status===403 && !Number.isFinite(error.retryAt))throw error;
  console.error(JSON.stringify({event:'automatic-ci-overflow-pending',runId,error:error.message}));
 };
 let served=0,healthy;
 try{do{
 let readFailed=false;
 const read=async work=>{try{return await work();}catch(error){readFailed=true;throw error;}};
 try{
 await recover?.();
 const pending=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
 const ownedRuns=new Set(pending.slots.map(slot=>slot.ciInvocation?.runId??slot.lease?.ci?.runId).filter(Boolean));
 let hosted=await read(()=>hostedAttempts({api,policy,signal}));
 if(Object.keys(hosted).some(id=>!ownedRuns.has(Number(id)))){
  let retryAt=0;
  const recovered=await withKernelLock(config.state,()=>recoverHostedAttempts({api,policy,signal,excludeRuns:ownedRuns,onError:(error,runId)=>{
   pendingFailure(error,runId);if(Number.isFinite(error.retryAt)){retryAt=error.retryAt;return false;}
  }}),{signal});
  if(recovered.code!==75)hosted=recovered;
  if(retryAt)await wait(Math.max(30000,retryAt-Date.now()),undefined,{signal});
 }
 const excludeRuns=new Set(Object.keys(hosted).map(Number));
 const selectedHead=await read(()=>routingHead({api,policy,signal}));
 if(selectedHead && await read(()=>routingMode({api,policy,signal}))!=='server')return {code:0,served};
 assert.equal(selectedHead,'','Automatic CI requires unrestricted same-repository routing');
 const state=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
 const recorded=new Set(state.slots.map(slot=>slot.ciInvocation?.jobId).filter(Boolean));
 for(const turn of Object.keys(state.turns)){const match=/^[A-K]:ci-[0-9]+-[0-9]+-([0-9]+)$/.exec(turn);if(match)recorded.add(Number(match[1]));}
 const exclude=new Set([...seen,...recorded]);
 const starting=[...active.values()].filter(ci=>!recorded.has(ci.jobId)).length;
 const free=Math.max(0,state.slots.filter(slot=>slot.state==='free' && !slot.ciInvocation).length-starting);
 if(!free){
  const occupiedRuns=new Set([...excludeRuns,...state.slots.map(slot=>slot.ciInvocation?.runId??slot.lease?.ci?.runId).filter(Boolean),...[...active.values()].map(ci=>ci.runId)]);
  const queued=await read(()=>findAutomatic({api,policy,limit:16,onePerRun:true,exclude,excludeRuns:occupiedRuns,signal}));
  for(const ci of new Map(queued.map(ci=>[ci.runId,ci])).values()){
  const outcome=await withKernelLock(config.state,async()=>{
   const fresh=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
   if(fresh.slots.some(slot=>slot.state==='free' && !slot.ciInvocation))return;
   if(fresh.slots.some(slot=>(slot.ciInvocation?.runId??slot.lease?.ci?.runId)===ci.runId) || [...active.values()].some(job=>job.runId===ci.runId))return;
   try{await overflowOrdinary({api,policy,ci,signal});}catch(error){return {error};}
  },{signal});
  if(outcome?.error){pendingFailure(outcome.error,ci.runId);if(Number.isFinite(outcome.error.retryAt))await wait(Math.max(30000,outcome.error.retryAt-Date.now()),undefined,{signal});}
  }
  if(active.size){await waitForWorker();continue;}break;
 }
 transport??=new CITransport(config);
 if(healthy===undefined){
  healthy=false;
  try{healthy=await transport.healthy({signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7500)]):AbortSignal.timeout(7500)});}catch{signal?.throwIfAborted();}
  if(!healthy){
   if(await read(()=>routingMode({api,policy,signal}))!=='hosted')await setRoutingMode({api,policy,mode:'hosted',signal});
   return {code:0,served,route:'hosted',reason:'host-unavailable'};
  }
 }
 const refused=[];
 const jobs=await read(()=>findAutomatic({api,policy,limit:free,exclude,excludeRuns,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),
  onRefused:job=>{if(!refusedRuns.has(job.runId) && !state.slots.some(slot=>slot.ciInvocation?.runId===job.runId && slot.ciInvocation.ordinaryStage!=='admitted')){refusedRuns.add(job.runId);refused.push(job);}}}));
 // Guest removal, runner removal and hosted fallback have separate cleanup budgets.
 runWorker??=ci=>runProcess(process.execPath,[new URL('./control.mjs',import.meta.url).pathname,configuration,'job',String(ci.runId),String(ci.jobId)],{signal,terminationGraceMs:500000});
 let cleanup;
 jobs.forEach(ci=>{
  seen.add(ci.jobId);served++;
  const worker=(async()=>{
  let result=await runWorker(ci);
  const recorded=()=>{
   const latest=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
   return latest.slots.some(slot=>slot.ciInvocation?.jobId===ci.jobId) ||
    Object.keys(latest.turns).some(turn=>turn.endsWith(`:ci-${ci.runId}-${ci.attempt}-${ci.jobId}`));
  };
  if(refused.length && result.code===75){
   await cleanup;signal?.throwIfAborted();
   if(!recorded())result=await runWorker(ci);
  }
  // Refused work without a job admission stays eligible at the normal polling interval.
  if(result.code===75 && !recorded()){
   try{await wait(30000,undefined,{signal});}
   catch(error){if(signal?.aborted)return {code:143,reason:'cancelled'};throw error;}
   seen.delete(ci.jobId);
  }
  return result;
  })().then(result=>console.log(JSON.stringify({event:'automatic-ci-job',at:new Date().toISOString(),runId:ci.runId,jobId:ci.jobId,...result})),
   error=>console.log(JSON.stringify({event:'automatic-ci-job',at:new Date().toISOString(),runId:ci.runId,jobId:ci.jobId,code:125,error:error.message})))
   .finally(()=>active.delete(worker));
  active.set(worker,ci);
 });
 cleanup=Promise.allSettled(refused.map(job=>fallbackRefused({config,api,...job,signal})));
 cleanups.push(cleanup.then(fallbacks=>{for(let i=0;i<fallbacks.length;i++)if(fallbacks[i].status==='rejected'){
  refusedRuns.delete(refused[i].runId);
  console.error(JSON.stringify({event:'automatic-ci-refused-fallback-pending',...refused[i],error:fallbacks[i].reason.message}));
 }}));
 if(active.size)await waitForWorker();
 signal?.throwIfAborted();
 }catch(error){
  signal?.throwIfAborted();
  if(!readFailed)throw error;
  const transient=error.status===403 && Number.isFinite(error.retryAt) || error.status===408 || error.status===429 || error.status>=500 && error.status<=599 ||
   error.code==='GITHUB_RESPONSE_INTERRUPTED' || error instanceof TypeError && error.message==='fetch failed' || error instanceof SyntaxError ||
   ['TimeoutError','AbortError'].includes(error.name) || /Incomplete automatic run inventory/.test(error.message);
  if(!transient)throw error;
  console.error(JSON.stringify({event:'automatic-ci-inventory-pending',error:error.message}));
  const retryDelay=Math.max(30000,Number.isFinite(error.retryAt)?error.retryAt-Date.now():0);
  if(!active.size){
   if(Number.isFinite(error.retryAt))await wait(retryDelay,undefined,{signal});
   return {code:0,served,reason:'inventory-unavailable'};
  }
  await wait(retryDelay,undefined,{signal});
 }
 }while(active.size);
 }finally{await Promise.allSettled([...active.keys(),...cleanups]);}
 return {code:0,served};
}
async function fallbackRefused({config,api,runId,jobId,name,label,signal}){
 const {randomBytes}=await import('node:crypto');
 const policy=config.ci,base=`/repos/${policy.repository}`;
 // Refusal may prevent execution, but cancellation still needs a current owned label.
 const run=await api.get(`${base}/actions/runs/${runId}`,{signal});
 assert.ok(run.id===runId && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0 && run.workflow_id===policy.workflowId && run.path===policy.workflowPath &&
  ['pull_request','push','schedule','workflow_dispatch'].includes(run.event) && run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId && (run.event!=='pull_request' || run.pull_requests?.length===1),'Refused run identity differs');
 const job=await api.get(`${base}/actions/jobs/${jobId}`,{signal});
 assert.ok(job.id===jobId && job.name===name && job.run_id===runId && job.run_attempt===run.run_attempt && job.head_sha===run.head_sha && job.status==='queued' && !job.runner_id &&
  job.labels?.length===2 && job.labels.includes('self-hosted') && job.labels.includes(label),'Refused job identity differs');
 const ci={repositoryId:policy.repositoryId,workflowId:policy.workflowId,runId,attempt:run.run_attempt,jobId,sourceSha:run.head_sha,workflowSha:run.head_sha};
 return withAvailableSlot(config,async({leases})=>{
  const invocation={nonce:randomBytes(16).toString('hex'),sourceSha:run.head_sha,workflowSha:run.head_sha,route:'server',createdAt:Date.now(),runId,attempt:run.run_attempt,jobId,ordinaryStage:'refused'};
  leases.setInvocation(invocation);
  const result=await withKernelLock(config.state,()=>fallbackOrdinary({api,policy,ci,leases,automatic:true,signal:AbortSignal.timeout(240000)}));
  if(!result.pending)leases.clearInvocation(invocation.nonce);
  console.log(JSON.stringify({event:'automatic-ci-refused-fallback',runId,jobId,...result}));return result;
 },{signal});
}
async function automaticJob({config,api,runId,jobId,signal}){
 const {withAvailableSlot,withTemporaryState}=await import('./manual.mjs');
 const policy=config.ci,run=await api.get(`/repos/${policy.repository}/actions/runs/${runId}`,{signal});
 const ci=await findOrdinary({api,policy,approvedHead:run.head_sha,runId,jobId,automatic:true,signal});
 if(!ci)return {code:75,reason:'job-no-longer-queued'};
 return withAvailableSlot({...config,slots:configuredSlots(config)},context=>withTemporaryState(context.temporaryState,()=>
  executeOrdinary({api,policy,leases:context.leases,ci,lane:'I',transport:new CITransport(config),signal,automatic:true,
   fallback:options=>withKernelLock(config.state,()=>fallbackOrdinary(options),{signal:options.signal})})),{signal});
}

export async function main(args){
 const {refuseLegacy}=await import('./manual.mjs');
 const [configuration,command,...values]=args;
 assert.ok(configuration?.startsWith('/') && ['status','mode','run','job'].includes(command),
  'Usage: control.mjs CONFIG status | mode hosted --reason REASON | mode server --reason REASON --head SHA | run LANE APPROVED_HEAD RUN_ID');
 const config=JSON.parse(readFileSync(configuration,'utf8'));validateCIConfig(config);const slots=configuredSlots(config);
 assert.equal(config.ci.workflowPath,'.github/workflows/ci.yml','Ordinary CI needs its reviewed workflow configuration');
 const api=new GithubApp(config.ci),policy=config.ci;
 if(command==='job'){
  assert.ok(values.length===2 && values.every(v=>/^[1-9][0-9]*$/.test(v)) && values.every(v=>Number.isSafeInteger(Number(v))),'Invalid automatic job identity');
  const cancellation=new AbortController(),cancel=()=>cancellation.abort();
  for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,cancel);
  protectOutputStreams();
  try{return await automaticJob({config,api,runId:Number(values[0]),jobId:Number(values[1]),signal:cancellation.signal});}
  finally{for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.off(name,cancel);}
 }
 if(command==='status'){
  assert.equal(values.length,0);return {code:0,mode:await routingMode({api,policy}),selectedHead:await routingHead({api,policy}),state:new LocalLeases(config.state+'/ledger',
   {hostGeneration:config.hostGeneration,slots}).inspect()};
 }
 if(command==='mode'){
  assert.ok((values[0]==='hosted' && values.length===3 || values[0]==='server' && values.length===5 && values[3]==='--head' && /^[a-f0-9]{40}$/.test(values[4])) &&
   values[1]==='--reason' && /^[a-z0-9-]{1,80}$/.test(values[2]),'A short mode reason and server head are required');
  return withKernelLock(config.state,async()=>{
   refuseLegacy(config.state);
   const leases=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots});
   const current=leases.inspect();
   assert.ok(!current.ciInvocation && current.slots.every(slot=>slot.state==='free' && !slot.ciInvocation),'CI work must finish before changing selection');
   if(values[0]==='server')await setRoutingHead({api,policy,approvedHead:values[4]});
   return {code:0,mode:await setRoutingMode({api,policy,mode:values[0]}),reason:values[2]};
  });
 }
 assert.ok(values.length===3 && /^[A-K]$/.test(values[0]) && /^[a-f0-9]{40}$/.test(values[1]) && /^[1-9][0-9]*$/.test(values[2]),
  'Ordinary CI needs lane, approved immutable PR head and numeric run ID');
 assert.equal(slots,1,'The selected typecheck entry uses the original one-slot controller; use scoped runCI for a multi-slot measurement');
 const [lane,approvedHead,run]=values,runId=Number(run);assert.ok(Number.isSafeInteger(runId));
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,cancel);
 protectOutputStreams();
 try{return await withOrdinaryController({state:config.state,hostGeneration:config.hostGeneration,api,policy,approvedHead,runId,lane,
  transport:new CITransport(config),signal:cancellation.signal});}
 finally{for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.off(name,cancel);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));process.exitCode=result.code;}
 catch(error){console.error(error.message);process.exitCode=125;}
}
