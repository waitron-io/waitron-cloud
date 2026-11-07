import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {GithubApp} from './github-app.mjs';
import {LocalLeases,configuredSlots,withAvailableSlot} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {CITransport,protectOutputStreams,runProcess} from './transport.mjs';
import {validateCIConfig,routingMode,setRoutingMode,routingHead,setRoutingHead,findOrdinary,executeOrdinary,qualifyOrdinaryHosted,findAutomatic,fallbackOrdinary} from './ci-canary.mjs';

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
export async function automaticTick({configuration,config,api,signal,runWorker,transport}){
 const policy=config.ci,slots=configuredSlots(config);
 if(await routingMode({api,policy,signal})!=='server')return {code:0,served:0};
 assert.equal(await routingHead({api,policy,signal}),'','Automatic CI requires unrestricted same-repository routing');
 const state=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
 const free=state.slots.filter(slot=>slot.state==='free' && !slot.ciInvocation).length;
 if(!free)return {code:0,served:0};
 transport??=new CITransport(config);
 let healthy=false;
 try{healthy=await transport.healthy({signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7500)]):AbortSignal.timeout(7500)});}catch{signal?.throwIfAborted();}
 if(!healthy){
  await setRoutingMode({api,policy,mode:'hosted',signal});
  return {code:0,served:0,route:'hosted',reason:'host-unavailable'};
 }
 const exclude=new Set(state.slots.map(slot=>slot.ciInvocation?.jobId).filter(Boolean));
 for(const turn of Object.keys(state.turns)){const match=/^[A-K]:ci-[0-9]+-[0-9]+-([0-9]+)$/.exec(turn);if(match)exclude.add(Number(match[1]));}
 const refused=[];
 const jobs=await findAutomatic({api,policy,limit:free,exclude,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),
  onRefused:job=>{refused.push(job);}});
 // Guest removal, runner removal and hosted fallback have separate cleanup budgets.
 runWorker??=ci=>runProcess(process.execPath,[new URL('./control.mjs',import.meta.url).pathname,configuration,'job',String(ci.runId),String(ci.jobId)],{signal,terminationGraceMs:500000});
 const [results,fallbacks]=await Promise.all([
  Promise.allSettled(jobs.map(ci=>runWorker(ci))),
  Promise.allSettled(refused.map(job=>fallbackRefused({config,api,...job,signal})))
 ]);
 for(let i=0;i<results.length;i++)console.log(JSON.stringify({event:'automatic-ci-job',at:new Date().toISOString(),runId:jobs[i].runId,jobId:jobs[i].jobId,
  ...(results[i].status==='fulfilled'?results[i].value:{code:125,error:results[i].reason.message})}));
 for(let i=0;i<fallbacks.length;i++)if(fallbacks[i].status==='rejected')console.error(JSON.stringify({event:'automatic-ci-refused-fallback-pending',...refused[i],error:fallbacks[i].reason.message}));
 signal?.throwIfAborted();
 return {code:0,served:jobs.length};
}
async function fallbackRefused({config,api,runId,jobId,name,label,signal}){
 const {randomBytes}=await import('node:crypto');
 const policy=config.ci,base=`/repos/${policy.repository}`;
 // Refusal may prevent execution, but cancellation still needs a current owned label.
 const run=await api.get(`${base}/actions/runs/${runId}`,{signal});
 assert.ok(run.id===runId && run.run_attempt===1 && run.workflow_id===policy.workflowId && run.path===policy.workflowPath &&
  run.event==='pull_request' && run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId && run.pull_requests?.length===1,'Refused run identity differs');
 const job=await api.get(`${base}/actions/jobs/${jobId}`,{signal});
 assert.ok(job.id===jobId && job.name===name && job.run_id===runId && job.run_attempt===1 && job.head_sha===run.head_sha && job.status==='queued' && !job.runner_id &&
  job.labels?.length===2 && job.labels.includes('self-hosted') && job.labels.includes(label),'Refused job identity differs');
 const ci={repositoryId:policy.repositoryId,workflowId:policy.workflowId,runId,attempt:1,jobId,sourceSha:run.head_sha,workflowSha:run.head_sha};
 return withAvailableSlot(config,async({leases})=>{
  const invocation={nonce:randomBytes(16).toString('hex'),sourceSha:run.head_sha,workflowSha:run.head_sha,route:'server',createdAt:Date.now(),runId,attempt:1,jobId,ordinaryStage:'refused'};
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
