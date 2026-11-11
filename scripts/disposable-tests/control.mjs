import assert from 'node:assert/strict';
import {readFileSync,readSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {GithubApp,withRequestCounts} from './github-app.mjs';
import {LocalLeases,configuredSlots,ciRetryReady} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {ciIdentity} from './ci-identity.mjs';
import {CITransport,protectOutputStreams,runProcess} from './transport.mjs';
import {validateCIConfig,routingMode,setRoutingMode,routingHead,setRoutingHead,findOrdinary,executeOrdinary,qualifyOrdinaryHosted,findAutomatic,overflowInventory,overflowOrdinary,recoverHostedAttempts,hostedAttempts,publishCapacity,reconcileDeadRuns,readAutomaticPass} from './ci-canary.mjs';

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
 const active=new Map(),seen=new Set();
 const waitForWorker=async()=>{
  const wake=new AbortController();
  try{await Promise.race([...active.keys(),delay(30000,undefined,{signal:signal?AbortSignal.any([signal,wake.signal]):wake.signal})]);}
  finally{wake.abort();}
 };
 let served=0,healthy,lastCapacity=-Infinity;
 const local=()=>{
  const state=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
  const usable=state.slots.filter(slot=>slot.state!=='quarantined'&&!slot.orphanRunners?.length&&(!Array.isArray(healthy)||healthy.includes(slot.id)));
  const identities=state.slots.flatMap(slot=>[slot.ciInvocation,slot.lease?.ci,...(slot.orphanRunners??[]).map(runner=>runner.ci)]).filter(Boolean);
  const starting=[...active.values()].filter(ci=>!identities.some(value=>value.jobId===ci.jobId));
  return {slots:usable.length,busy:usable.filter(slot=>slot.state!=='free'||slot.ciInvocation).length+starting.length,
   owned:new Set([...identities,...active.values()].map(ci=>ci.runId)),jobs:new Set(identities.map(ci=>ci.jobId))};
 };
 const pending=(error,runId)=>{
  signal?.throwIfAborted();
  console.error(JSON.stringify({event:'automatic-ci-overflow-pending',runId,error:error.message}));
  if(error.status===401 || error.status===403 || error.status===429 || Number.isFinite(error.retryAt))throw error;
 };
 const publish=async pass=>{
  if(!pass || Date.now()-lastCapacity<60000)return;
  lastCapacity=Date.now();
  const state=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
  let snapshot;
  try{
   snapshot=await overflowInventory({api:pass.api,policy,signal,runs:pass.runs});
   await publishCapacity({api,policy,state,snapshot,healthy:healthy??true,signal,now:pass.observedAt});lastCapacity=Date.now();
  }catch(error){signal?.throwIfAborted();console.error(JSON.stringify({event:'automatic-ci-capacity-pending',error:error.message}));
   if(error.status===401 || error.status===403 || error.status===429 || Number.isFinite(error.retryAt))throw error;
  }
  const capacity=local();
  if(snapshot && capacity.busy>=capacity.slots && capacity.slots){
   try{
    const runs=new Map([...pass.runs].filter(([,run])=>run.event==='pull_request'&&run.run_attempt===1));
    const [ci]=await findAutomatic({api:pass.api,policy,signal,runs,limit:1,hosted:await hostedAttempts({api,policy,signal}),excludeRuns:local().owned,onePerRun:true,untouched:true});
    if(ci)await overflowOrdinary({api,policy,ci,signal,snapshot,local});
   }catch(error){pending(error);}
  }
  return snapshot;
 };
 try{do{
 let readFailed=false;
 const read=async work=>{try{return await work();}catch(error){readFailed=true;throw error;}};
 try{
 await recover?.();
 const hosted=await read(()=>hostedAttempts({api,policy,signal}));
 const selectedHead=await read(()=>routingHead({api,policy,signal}));
 if(selectedHead && await read(()=>routingMode({api,policy,signal}))!=='server')return {code:0,served};
 assert.equal(selectedHead,'','Automatic CI requires unrestricted same-repository routing');

 const state=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
 const recorded=new Set(state.slots.map(slot=>slot.ciInvocation?.jobId).filter(Boolean));
 for(const [turn,history] of Object.entries(state.turns)){
  const match=/^[A-K]:ci-[0-9]+-[0-9]+-([0-9]+)$/.exec(turn);if(!match)continue;
  const id=Number(match[1]);
  if(ciRetryReady(history,state,id) && !recorded.has(id))seen.delete(id);else recorded.add(id);
 }
 const exclude=new Set([...seen,...recorded,...[...active.values()].map(ci=>ci.jobId)]);
 const starting=[...active.values()].filter(ci=>!recorded.has(ci.jobId)).length;
 let free=Math.max(0,state.slots.filter(slot=>slot.state==='free' && !slot.ciInvocation).length-starting);
 let pass;
 try{pass=await read(()=>readAutomaticPass({api,policy,signal}));}
 catch(error){
  if(error.code!=='CI_REPOSITORY_RUN_LIMIT')throw error;
  readFailed=false;console.error(JSON.stringify({event:'automatic-ci-wide-inventory-pending',error:error.message}));
 }
 if(pass)await read(()=>reconcileDeadRuns({api,policy,signal,pass,hosted,onError:(error,runId)=>{
  console.error(JSON.stringify({event:'automatic-ci-dead-run-pending',runId,error:error.message}));
  if(error.status===401 || error.status===403 || Number.isFinite(error.retryAt))throw error;
 }}));
 await read(()=>recoverHostedAttempts({api,policy,signal,excludeRuns:{has:id=>local().owned.has(id)},onError:pending}));
 if(config.slotHosts!==undefined){
  transport??=new CITransport(config);
  healthy=await transport.healthySlots({signal});
  // Host health checks room for another guest; occupied leases still consume capacity.
  healthy=[...new Set([...healthy,...state.slots.filter(slot=>slot.state!=='free'&&slot.state!=='quarantined'&&!slot.orphanRunners?.length).map(slot=>slot.id)])];
  free=Math.max(0,state.slots.filter(slot=>healthy.includes(slot.id)&&slot.state==='free'&&!slot.ciInvocation).length-starting);
  if(!healthy.length){
   if(await read(()=>routingMode({api,policy,signal}))!=='hosted')await setRoutingMode({api,policy,mode:'hosted',signal});
   await read(()=>publish(pass));return {code:0,served,route:'hosted',reason:'host-unavailable'};
  }
 }
 if(!free){
  await read(()=>publish(pass));
  if(active.size){await waitForWorker();continue;}break;
 }
 transport??=new CITransport(config);
 if(healthy===undefined){
  healthy=false;
  try{healthy=await transport.healthy({signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7500)]):AbortSignal.timeout(7500)});}catch{signal?.throwIfAborted();}
  if(!healthy){
   if(await read(()=>routingMode({api,policy,signal}))!=='hosted')await setRoutingMode({api,policy,mode:'hosted',signal});
   await read(()=>publish(pass));
   return {code:0,served,route:'hosted',reason:'host-unavailable'};
  }
 }
 const selectionStarted=Date.now();
 const jobs=await read(()=>findAutomatic({api:pass?.api??api,policy,runs:pass?.runs,limit:free,exclude,hosted,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)}));
 // Each admission keeps a bounded diagnostic alongside the child's original stderr.
 runWorker??=(ci,admission)=>{
  let remaining=4096,pending=Buffer.alloc(0);
  const marker=Buffer.from('{"event":"github-request-counts",');
  const withoutCount=data=>{const start=data.indexOf(marker);return start===-1?data:data.subarray(0,start);};
  const tag=data=>{const excerpt=data.subarray(0,remaining);remaining-=excerpt.length;
   if(excerpt.length)console.error(JSON.stringify({event:'automatic-ci-admission-stderr',at:new Date().toISOString(),runId:ci.runId,attempt:ci.attempt,jobId:ci.jobId,stderr:excerpt.toString()}));
  };
  return runProcess(process.execPath,[new URL('./control.mjs',import.meta.url).pathname,configuration,'job',String(ci.runId),String(ci.jobId),'--admission'],{input:JSON.stringify(admission),signal,terminationGraceMs:500000,onStderr:data=>{
   if(!remaining)return;
   pending=Buffer.concat([pending,data]);let end;const excerpts=[];
   while((end=pending.indexOf(10))!==-1){excerpts.push(withoutCount(pending.subarray(0,end+1)));pending=pending.subarray(end+1);}
   if(pending.length>=4096){excerpts.push(withoutCount(pending));pending=Buffer.alloc(0);}
   tag(Buffer.concat(excerpts));
  }}).finally(()=>tag(withoutCount(pending)));
 };
 for(let ci of jobs){
  let checkedAt=pass?.observedAt??selectionStarted;
  if(Date.now()-checkedAt>60000){
   checkedAt=Date.now();
   try{ci=await read(()=>findOrdinary({api,policy,approvedHead:ci.workflowSha,runId:ci.runId,jobId:ci.jobId,automatic:true,signal}));}
   catch(error){signal?.throwIfAborted();if(error.status===401 || error.status===403 || Number.isFinite(error.retryAt))throw error;
    readFailed=false;console.error(JSON.stringify({event:'automatic-ci-refused',runId:ci.runId,error:error.message}));continue;}
   if(!ci || Date.now()-checkedAt>60000)continue;
  }
  const admission={ci,checkedAt};
  seen.add(ci.jobId);served++;
  const worker=(async()=>{
  let result=await runWorker(ci,admission);
  const recorded=()=>{
   const latest=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
   return latest.slots.some(slot=>slot.ciInvocation?.jobId===ci.jobId) ||
    Object.keys(latest.turns).some(turn=>turn.endsWith(`:ci-${ci.runId}-${ci.attempt}-${ci.jobId}`));
  };
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
 }
 if(active.size)await waitForWorker();
 await read(()=>publish(pass));
 signal?.throwIfAborted();
 }catch(error){
  signal?.throwIfAborted();
  if(!readFailed)throw error;
  const transient=error.status===403 && Number.isFinite(error.retryAt) || error.status===408 || error.status===429 || error.status>=500 && error.status<=599 ||
   error.code==='GITHUB_RESPONSE_INTERRUPTED' || error instanceof TypeError && error.message==='fetch failed' || error instanceof SyntaxError ||
   ['TimeoutError','AbortError'].includes(error.name) || /Incomplete (?:automatic run|open PR) inventory/.test(error.message);
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
 }finally{await Promise.allSettled([...active.keys()]);}
 return {code:0,served};
}
export async function automaticJob({config,api,runId,jobId,signal,admission}){
 const {withAvailableSlot,withTemporaryState}=await import('./manual.mjs');
 const policy=config.ci;let ci,checkedAt=admission?.checkedAt??Date.now();
 if(admission!==undefined){
  assert.ok(admission && Object.keys(admission).sort().join(',')==='checkedAt,ci' &&
   Number.isSafeInteger(checkedAt) && checkedAt>=0 && checkedAt<=Date.now(),'Invalid shared admission timestamp');
  ci=ciIdentity(admission.ci);
  assert.ok(ci.repositoryId===policy.repositoryId && ci.workflowId===policy.workflowId && ci.workflowPath===policy.workflowPath &&
   ci.runId===runId && ci.jobId===jobId,'Shared admission identity differs');
 }
 const refresh=async()=>{
  checkedAt=Date.now();const head=ci?.workflowSha??(await api.get(`/repos/${policy.repository}/actions/runs/${runId}`,{signal})).head_sha;
  return findOrdinary({api,policy,approvedHead:head,runId,jobId,automatic:true,signal});
 };
 if(!ci)ci=await refresh();
 if(!ci)return {code:75,reason:'job-no-longer-queued'};
 const healthySlots=config.slotHosts===undefined?undefined:await new CITransport(config).healthySlots({signal});
 return withAvailableSlot({...config,slots:configuredSlots(config)},context=>withTemporaryState(context.temporaryState,async()=>{
  if(Date.now()-checkedAt>60000)ci=await refresh();
  if(!ci)return {code:75,reason:'job-no-longer-queued'};
  if(Date.now()-checkedAt>60000)return {code:75,reason:'admission-check-expired'};
  return executeOrdinary({api,policy,leases:context.leases,ci,lane:'I',transport:new CITransport({...config,slot:context.slot}),signal,automatic:true});
 }),{signal,healthySlots});
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
  const shared=values.length===3 && values[2]==='--admission';
  assert.ok((values.length===2 || shared) && values.slice(0,2).every(v=>/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))),'Invalid automatic job identity');
  let admission;
  if(shared){
   const input=Buffer.alloc(4097);let size=0,count;
   while(size<input.length && (count=readSync(0,input,size,input.length-size,null))>0)size+=count;
   assert.ok(size<=4096,'Shared admission input is too large');admission=JSON.parse(input.subarray(0,size).toString());
  }
  const cancellation=new AbortController(),cancel=()=>cancellation.abort();
  for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,cancel);
  protectOutputStreams();
  try{return await automaticJob({config,api,runId:Number(values[0]),jobId:Number(values[1]),signal:cancellation.signal,admission});}
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
 try{const result=await withRequestCounts(()=>main(process.argv.slice(2)),process.argv[3]==='job'?'worker':process.argv[3]==='run'?'lane':'operator');console.log(JSON.stringify(result));process.exitCode=result.code;}
 catch(error){console.error(error.message);process.exitCode=125;}
}
