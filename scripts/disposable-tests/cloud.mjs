import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLeases,configuredSlots,withAvailableSlot} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {setRoutingMode,setRoutingHead,routingMode,routingHead,findOrdinary,runCI,fallbackOrdinary,cancelCIJob} from './ci-canary.mjs';

function matchingRun(policy,head,run){
 return Number.isSafeInteger(run.id) && run.id>0 && run.event==='pull_request' && run.workflow_id===policy.workflowId &&
  run.path===policy.workflowPath && run.head_sha===head && run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId;
}
async function inventory({api,policy,head,signal}){
 const data=await api.get(`/repos/${policy.repository}/actions/workflows/${policy.workflowId}/runs?event=pull_request&head_sha=${head}&per_page=100`,{signal});
 assert.ok(Number.isSafeInteger(data.total_count) && data.total_count<=100 && Array.isArray(data.workflow_runs) && data.workflow_runs.length===data.total_count,'Incomplete Cloud run inventory');
 return data.workflow_runs.filter(run=>matchingRun(policy,head,run)).sort((a,b)=>a.id-b.id);
}
async function typecheck({api,policy,run,signal}){
 const data=await api.get(`/repos/${policy.repository}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`,{signal});
 assert.ok(Number.isSafeInteger(data.total_count) && data.total_count<=100 && Array.isArray(data.jobs) && data.jobs.length===data.total_count,'Incomplete Cloud job inventory');
 const jobs=data.jobs.filter(job=>job.name==='typecheck');assert.ok(jobs.length<=1,'Ambiguous Cloud typecheck');return jobs[0];
}
function ownedJob(policy,run,job){
 return job?.run_id===run.id && job.run_attempt===1 && job.head_sha===run.head_sha && Number.isSafeInteger(job.id) && job.id>0 &&
  job.name==='typecheck' && job.labels?.length===2 && job.labels.includes('self-hosted') && job.labels.includes(`dt-${policy.repositoryId}-${run.id}-1-typecheck`);
}
function bind(leases,pending,run,job,ordinaryStage){
 const value={...pending,runId:run.id,attempt:1,jobId:job.id,label:`dt-${pending.repositoryId}-${run.id}-1-typecheck`,ordinaryStage};
 leases.setInvocation(value);return value;
}
async function drainRecorded({api,policy,leases,pending,signal,wait}){
 const base=`/repos/${policy.repository}`,run=await api.get(`${base}/actions/runs/${pending.runId}`,{signal});
 assert.ok(matchingRun(policy,pending.sourceSha,run) && [1,2].includes(run.run_attempt),'Recorded Cloud run differs');
 const job=await api.get(`${base}/actions/jobs/${pending.jobId}`,{signal});
 assert.ok(ownedJob(policy,run,job) && job.id===pending.jobId,'Recorded Cloud job differs');
 if(job.status==='completed' && (pending.ordinaryStage!=='cancel-requested' || job.conclusion==='success'))return {code:0};
 const pull=await api.get(`${base}/pulls/${run.pull_requests?.[0]?.number}`,{signal});
 assert.ok(run.pull_requests?.length===1 && pull.number===run.pull_requests[0].number && pull.head?.repo?.id===policy.repositoryId && pull.base?.repo?.id===policy.repositoryId,'Recorded Cloud PR identity differs');
 if(pull.state!=='open' || pull.head.sha!==pending.sourceSha){
  if(run.run_attempt!==1 || job.status==='completed')return {code:0};
  if(job.status!=='queued' || job.runner_id)return {code:75};
  leases.setInvocation({...pending,ordinaryStage:'cancel-requested'});
  await cancelCIJob({api,repository:policy.repository,ci:{repositoryId:policy.repositoryId,workflowId:policy.workflowId,workflowSha:pending.workflowSha,runId:pending.runId,attempt:1,jobId:pending.jobId},signal,wait});
  return {code:0};
 }
 const ci={repositoryId:policy.repositoryId,workflowId:policy.workflowId,workflowSha:pending.workflowSha,sourceSha:pending.sourceSha,runId:pending.runId,attempt:1,jobId:pending.jobId};
 const outcome=await fallbackOrdinary({api,policy,ci,leases,signal,wait});
 return {...outcome,code:outcome.pending?75:0};
}

// The HEAD inventory stays attached until every planner has exposed its typecheck.
export async function drainCloud({api,policy,leases,signal,wait=delay}){
 const pending=leases.inspect().ciInvocation;
 assert.ok(pending?.repositoryId===policy.repositoryId && Number.isSafeInteger(pending.afterRunId),'Cloud recovery identity is missing');
 await setRoutingMode({api,policy,mode:'hosted',signal});
 assert.ok(leases.inspect().slots.every(slot=>slot.state==='free'),'Cloud guest absence must precede job cleanup');
 const retries=[];
 if(pending.runId!==null){
  const outcome=await drainRecorded({api,policy,leases,pending,signal,wait});
  if(outcome.code===75)return outcome;if(outcome.retry)retries.push(outcome);
 }
 const runs=(await inventory({api,policy,head:pending.sourceSha,signal})).filter(run=>run.id>pending.afterRunId);
 let unsettled=false;
 for(const run of runs){
  const job=await typecheck({api,policy,run,signal});
  if(!job){if(run.status!=='completed')unsettled=true;continue;}
  if(!ownedJob(policy,run,job) || job.status==='completed' || run.run_attempt!==1)continue;
  if(job.status!=='queued' || job.runner_id){unsettled=true;continue;}
  const concrete=bind(leases,pending,run,job,'refused');
  const outcome=await drainRecorded({api,policy,leases,pending:concrete,signal,wait});
  if(outcome.code===75)return {...outcome,retries};if(outcome.retry)retries.push(outcome);
 }
 if(unsettled)return {code:75,reason:'cloud-planner-pending',retries};
 leases.clearInvocation(pending.nonce);return {code:0,retries};
}

export async function withCloudController({config,api,approvedHead,lane,transport,signal,wait=delay}){
 const {withTemporaryState}=await import('./manual.mjs');
 assert.match(approvedHead,/^[a-f0-9]{40}$/);assert.match(lane,/^[A-K]$/);
 const policy=config.cloudCi;assert.ok(policy,'Cloud CI policy is missing');const slots=configuredSlots(config);
 return withAvailableSlot({...config,slots},({leases,temporaryState})=>withTemporaryState(temporaryState,async()=>{
  let admitted=false,result,drain;
  try{
   const runs=await inventory({api,policy,head:approvedHead,signal});
   if(runs.some(run=>run.status!=='completed'))return {code:75,reason:'cloud-earlier-run-pending'};
   const admission=await withKernelLock(config.state,async()=>{
    const all=new LocalLeases(config.state+'/ledger',{hostGeneration:config.hostGeneration,slots}).inspect();
    if(all.slots.some(slot=>slot.ciInvocation?.repositoryId===policy.repositoryId || slot.lease?.ci?.repositoryId===policy.repositoryId))return {code:75,reason:'cloud-already-recorded'};
    leases.setInvocation({repositoryId:policy.repositoryId,nonce:randomBytes(16).toString('hex'),sourceSha:approvedHead,workflowSha:approvedHead,route:'server',createdAt:Date.now(),runId:null,attempt:null,ordinaryStage:'awaiting-run',afterRunId:Math.max(0,...runs.map(run=>run.id))});
    admitted=true;
    await setRoutingHead({api,policy,approvedHead,signal});await setRoutingMode({api,policy,mode:'server',signal});return {code:0};
   },{signal});
   if(admission.code!==0)return admission;
   console.log(JSON.stringify({event:'cloud-ci-admitted',head:approvedHead}));
   const pending=leases.inspect().ciInvocation;
   while(true){
    signal?.throwIfAborted();
    assert.equal(await routingMode({api,policy,signal}),'server','Cloud server selection closed');
    assert.equal(await routingHead({api,policy,signal}),approvedHead,'Cloud selected head changed');
    const candidates=(await inventory({api,policy,head:approvedHead,signal})).filter(run=>run.id>pending.afterRunId);
    for(const run of candidates){
     const job=await typecheck({api,policy,run,signal});
     if(run.run_attempt===1 && job?.run_id===run.id && job.run_attempt===1 && job.head_sha===approvedHead && job.labels?.length===1 && job.labels[0]==='ubuntu-latest'){result={code:0,route:'hosted',reason:'hosted-typecheck',runId:run.id,jobId:job.id,status:job.status,conclusion:job.conclusion};break;}
     if(job?.status==='completed' && job.conclusion==='skipped'){result={code:0,reason:'typecheck-skipped'};break;}
     if(!job || !ownedJob(policy,run,job) || job.status!=='queued' || job.runner_id || run.run_attempt!==1)continue;
     const ci=await findOrdinary({api,policy,approvedHead,runId:run.id,signal});if(!ci)continue;
     bind(leases,pending,run,job,'admitted');
     assert.equal(await transport.healthy({signal}),true,'Cloud CI server unavailable');
     assert.equal(await routingMode({api,policy,signal}),'server','Cloud server selection closed before guest');
     assert.equal(await routingHead({api,policy,signal}),approvedHead,'Cloud selected head changed before guest');
     result={...await runCI({api,leases,transport,repository:policy.repository,lane,ci,signal}),ci};break;
    }
    if(result)break;
    assert.ok(Date.now()-pending.createdAt<900000,'Cloud CI queue deadline exceeded');await wait(15000,undefined,{signal});
   }
  }catch(error){result={code:125,error:error.message};}
  finally{
   if(admitted){
    try{
     const cleanup=AbortSignal.timeout(240000);
     // This slot still owns the Cloud intent, so another Cloud admission cannot reopen it.
     await setRoutingMode({api,policy,mode:'hosted',signal:cleanup});
     drain=await withKernelLock(config.state,()=>drainCloud({api,policy,leases,signal:cleanup,wait}));
    }
    catch(error){drain={code:125,error:error.message};}
   }
  }
  return {...result,...(drain?.code?{code:drain.code,cleanup:'pending'}:{}),...(drain?{drain}:{})};
 }),{signal});
}
