import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ciIdentity,routingLabel,jobName,ciJobKeyPattern} from './ci-identity.mjs';
import {configuredSlots} from './leases.mjs';

async function runInventory(api,path,signal){
 for(let attempt=1;attempt<=3;attempt++){
  const data=await api.get(path,{signal});
  if(attempt===3 || !Number.isSafeInteger(data.total_count) || data.total_count<0 || data.total_count>100 ||
   !Array.isArray(data.workflow_runs) || data.workflow_runs.length===data.total_count)return data;
 }
}

async function jobInventory(api,path,signal,limit=100,message='Incomplete job inventory'){
 const jobs=[];let total;
 for(let page=1;page<=Math.ceil(limit/30);page++){
  const data=await api.get(path+`?per_page=30&page=${page}`,{signal});
  total??=data.total_count;
  assert.ok(Array.isArray(data.jobs) && Number.isSafeInteger(total) && total>=0 && total<=limit && data.total_count===total,message);
  jobs.push(...data.jobs);
  assert.ok(jobs.length<=total && new Set(jobs.map(job=>job.id)).size===jobs.length,message);
  if(jobs.length===total)return {total_count:total,jobs};
  assert.ok(data.jobs.length>0,message);
 }
 assert.fail(message);
}

function ordinaryKey(name,labels){
 if(name==='image / smoke')return 'image-smoke-1';
 if(name==='typecheck')return Array.isArray(labels) && labels.some(label=>typeof label==='string' && label.endsWith('-typecheck-1'))?'typecheck-1':'typecheck';
 if(['server-probe','changes','ci','publish','server-queue-watchdog','mutation-shared-aggregate','test-server-stream','test-server-merge','test-heavy-merge','test-fiscal-verifactu-merge','test-till-merge','test-dashboard-merge','test-venue-service-merge','test-provisioning-merge','lint','root-guards','bundle-smoke','test-ui','test-setup','test-staffing','test-bookings','test-media','test-payments-stripe','test-payments-sumup','test-identity','test-workforce','test-light-a','test-light-b','test-adjustments'].includes(name))return name+'-1';
 const match=/^((?:test-(?:server|heavy|till|dashboard|fiscal-verifactu|venue-service|provisioning)|mutation-shared)) \(([1-9][0-9]*)\)$/.exec(name);
 return match?`${match[1]}-${match[2]}`:null;
}

export function admitOrdinary(policy,approvedHead,{repository,run,job,workflow,source,pull}){
 assert.equal(policy.workflowPath,'.github/workflows/ci.yml');
 assert.ok(repository.id===policy.repositoryId && repository.full_name===policy.repository,'Foreign CI repository');
 assert.ok(run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId &&
  run.workflow_id===policy.workflowId && run.path===policy.workflowPath && ['pull_request','push','schedule','workflow_dispatch'].includes(run.event) &&
  Number.isSafeInteger(run.run_attempt) && run.run_attempt>0 && run.head_sha===approvedHead && ['queued','in_progress'].includes(run.status),'Unapproved ordinary CI run');
 if(run.event==='pull_request')assert.ok(run.pull_requests?.length===1 && run.pull_requests[0].number===pull.number && pull.state==='open' &&
  pull.head?.sha===approvedHead && pull.head.repo?.id===policy.repositoryId && pull.base?.repo?.id===policy.repositoryId,'Unapproved ordinary PR head');
 assert.equal(createHash('sha256').update(workflow).digest('hex'),policy.workflowDigest,'CI workflow definition changed');
 assert.equal(source.sha,approvedHead,'CI source commit differs');
 const ci=ciIdentity({repositoryId:repository.id,workflowId:run.workflow_id,workflowPath:run.path,
  workflowSha:run.head_sha,workflowDigest:policy.workflowDigest,event:run.event,sourceSha:source.sha,sourceTree:source.commit.tree.sha,
  runId:run.id,attempt:run.run_attempt,jobId:job.id,jobKey:ordinaryKey(job.name,job.labels)});
 assert.ok(job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha &&
  job.name===jobName(ci) && job.status==='queued' && !job.runner_id && Array.isArray(job.labels) &&
  job.labels.length===2 && job.labels.includes('self-hosted') && job.labels.includes(routingLabel(ci)),'Foreign or already assigned ordinary CI job');
 return ci;
}
const variablePath=(policy,name)=>`/repos/${policy.repository}/actions/variables/${name}`;
const modePath=policy=>variablePath(policy,'DISPOSABLE_TESTS_MODE');
export async function routingMode({api,policy,signal}){
 try{return String((await api.get(modePath(policy),{signal})).value).toLowerCase()==='server'?'server':'hosted';}
 catch(error){if(error.status===404)return 'hosted';throw error;}
}
export async function setRoutingMode({api,policy,mode,signal}){
 assert.ok(['server','hosted'].includes(mode),'Invalid routing mode');
 await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_MODE',value:mode,signal});
 return mode;
}
async function writeRoutingVariable({api,policy,name,value,signal}){
 const path=variablePath(policy,name);let present=true;
 try{await api.get(path,{signal});}catch(error){if(error.status!==404)throw error;present=false;}
 if(present)await api.patch(path,{name,value},{signal});
 else await api.post(`/repos/${policy.repository}/actions/variables`,{name,value},{signal});
 assert.equal((await api.get(path,{signal})).value,value,'Routing variable readback differs');
}
export async function hostedAttempts({api,policy,signal}){
 let values={};
 try{const raw=(await api.get(variablePath(policy,'DISPOSABLE_TESTS_HOSTED_ATTEMPTS'),{signal})).value||'{}';
  try{values=JSON.parse(raw);}catch{assert.fail('Invalid hosted attempt routing JSON');}
 }
 catch(error){if(error.status!==404)throw error;}
 assert.ok(values && typeof values==='object' && !Array.isArray(values) &&
  Object.entries(values).every(([run,attempt])=>/^[1-9][0-9]*$/.test(run) && Number.isSafeInteger(attempt) && attempt>0),'Invalid hosted attempt routing');
 return values;
}
async function markHostedAttempt({api,policy,ci,signal}){
 const values=await hostedAttempts({api,policy,signal});
 if(values[String(ci.runId)]===ci.attempt+1)return;
 values[String(ci.runId)]=ci.attempt+1;
 await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});
}
export async function readAutomaticPass({api,policy,signal}){
 const base=`/repos/${policy.repository}`,runs=new Map(),reads=new Map();
 for(const status of ['queued','in_progress']){
  const data=await runInventory(api,`${base}/actions/runs?status=${status}&per_page=100`,signal);
  assert.ok(Number.isSafeInteger(data.total_count) && data.total_count<=100 && Array.isArray(data.workflow_runs) &&
   data.workflow_runs.length===data.total_count && new Set(data.workflow_runs.map(run=>run.id)).size===data.total_count,'Incomplete automatic run inventory');
  for(const run of data.workflow_runs)runs.set(run.id,run);
 }
 const pulls=[...runs.values()].some(run=>run.event==='pull_request')?await api.get(`${base}/pulls?state=open&per_page=100`,{signal}):[];
 assert.ok(Array.isArray(pulls) && pulls.length<100,'Incomplete open PR inventory');
 for(const run of runs.values())reads.set(`${base}/actions/runs/${run.id}`,Promise.resolve(run));
 for(const pull of pulls)reads.set(`${base}/pulls/${pull.number}`,Promise.resolve(pull));
 return {runs,pulls,api:{get:(path,options)=>{
  if(!reads.has(path))reads.set(path,api.get(path,options));return reads.get(path);
 }}};
}
export async function overflowInventory({api,policy,signal,includeHosted=true,runs:observed}){
 const marked=includeHosted?await hostedAttempts({api,policy,signal}):{},runs=new Map(observed),snapshot=new Map();
 if(!observed)for(const status of ['queued','in_progress']){
  const data=await runInventory(api,`/repos/${policy.repository}/actions/runs?status=${status}&per_page=100`,signal);
  assert.ok(Number.isSafeInteger(data.total_count) && data.total_count<=100 && Array.isArray(data.workflow_runs) &&
   data.workflow_runs.length===data.total_count && new Set(data.workflow_runs.map(run=>run.id)).size===data.total_count,'Incomplete hosted run inventory');
  for(const run of data.workflow_runs)runs.set(run.id,run);
 }
 for(const id of Object.keys(marked))if(!runs.has(Number(id)))runs.set(Number(id),await api.get(`/repos/${policy.repository}/actions/runs/${id}`,{signal}));
 for(const [id,run] of runs){
  assert.ok(run.id===id && run.repository?.id===policy.repositoryId && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0,'Foreign hosted run inventory');
  const read=async attempt=>{
   const {jobs}=await jobInventory(api,`/repos/${policy.repository}/actions/runs/${id}/attempts/${attempt}/jobs`,signal);
   assert.ok(jobs.every(job=>job.run_id===id && job.run_attempt===attempt && job.head_sha===run.head_sha && Array.isArray(job.labels)),'Foreign hosted job inventory');
   return jobs;
  };
  const jobs=await read(run.run_attempt);
  const previous=marked[id]===run.run_attempt && run.run_attempt>1 && run.status!=='completed'?await read(run.run_attempt-1):[];
  snapshot.set(id,{run,jobs,previous});
 }
 return snapshot;
}
function startedWork(job){
 if(job.name==='server-queue-watchdog'||job.name==='changes'&&job.status==='completed'&&job.conclusion==='success')return false;
 return job.runner_id>0 || job.status==='in_progress' || job.status==='completed'&&!['skipped','cancelled'].includes(job.conclusion);
}
const blocksRecovery=job=>job.name!=='ci' && startedWork(job);
export async function publishCapacity({api,policy,state,snapshot,healthy,signal,now=Date.now()}){
 const usable=healthy?state.slots.filter(s=>s.state!=='quarantined'&&!s.orphanRunners?.length):[];
 const admitted=new Set(state.slots.flatMap(s=>[s.ciInvocation?.jobId,s.lease?.ci?.jobId]).filter(Boolean));
 const value={observedAt:now,slots:usable.length,serverRunning:usable.filter(s=>s.state!=='free'||s.ciInvocation).length,serverWaiting:0,hostedRunning:0,hostedWaiting:0};
 for(const {jobs} of snapshot.values())for(const job of jobs){
  if(!job.labels.length)continue;
  const server=job.labels.includes('self-hosted');
  if(['queued','pending','waiting','requested'].includes(job.status)&&!admitted.has(job.id))value[server?'serverWaiting':'hostedWaiting']++;
  if(!server&&job.status==='in_progress')value.hostedRunning++;
 }
 await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_CAPACITY',value:JSON.stringify(value),signal});
 return value;
}
// The repository variable survives a full pool and a controller restart.
export async function overflowOrdinary({api,policy,ci,signal,snapshot}){
 const current=await findOrdinary({api,policy,approvedHead:ci.sourceSha,runId:ci.runId,jobId:ci.jobId,automatic:true,requireHostedRouting:true,signal});
 if(!current)return;
 assert.equal(current.attempt,ci.attempt,'Overflow attempt changed');
 if(ci.attempt>1)return;
 const base=`/repos/${policy.repository}/actions/runs/${ci.runId}`;
 const run=await api.get(base,{signal});
 const job=await api.get(`/repos/${policy.repository}/actions/jobs/${ci.jobId}`,{signal});
 const queuedAt=Date.parse(job.started_at??run.run_started_at??run.created_at);
 if(!Number.isFinite(queuedAt) || Date.now()-queuedAt<60000)return;
 const started=async()=>{
  const inventory=await jobInventory(api,base+`/attempts/${ci.attempt}/jobs`,signal);
  assert.ok(Number.isSafeInteger(inventory.total_count) && inventory.total_count<=100 && inventory.jobs.length===inventory.total_count &&
   inventory.jobs.some(job=>job.id===ci.jobId),'Incomplete overflow admission inventory');
  const busy=inventory.jobs.some(job=>job.run_id!==ci.runId || job.run_attempt!==ci.attempt || job.head_sha!==ci.workflowSha || startedWork(job) ||
   job.labels?.includes('self-hosted') && (job.runner_id || job.status!=='queued' &&
    !(job.status==='completed' && job.conclusion==='skipped')));
  return {busy,jobs:inventory.jobs};
 };
 const selected=await started();
 if(selected.busy)return;
 const wave=selected.jobs.filter(job=>job.conclusion!=='skipped').length;
 if(wave>20)return;
 snapshot??=await overflowInventory({api,policy,signal});
 const marked=await hostedAttempts({api,policy,signal});
 if(Object.keys(marked).some(id=>!snapshot.has(Number(id))))return;
 let occupied=0;
 for(const [id,{run,jobs,previous}] of snapshot){
  if(id===ci.runId)continue;
  if(marked[id]===run.run_attempt+1)occupied+=jobs.filter(job=>job.conclusion!=='skipped').length;
  if(marked[id]===run.run_attempt && run.run_attempt>1 && run.status!=='completed'){
   if(!previous.length)return;
   const appeared=jobs.map(job=>job.name);
   for(const job of previous)if(job.conclusion!=='skipped'){
    const index=appeared.indexOf(job.name);if(index<0)occupied++;else appeared.splice(index,1);
   }
  }
  for(const job of jobs){
   if(!job.labels.length || job.labels.includes('self-hosted'))continue;
   if(!['completed','in_progress'].includes(job.status))return;
   if(job.status==='in_progress')occupied++;
  }
 }
 if(occupied+wave>20)return;
 await markHostedAttempt({api,policy,ci,signal});
 if((await started()).busy){
  const values=await hostedAttempts({api,policy,signal});
  if(values[String(ci.runId)]===ci.attempt+1){delete values[String(ci.runId)];await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});}
  return;
 }
 await cancelCIJob({api,repository:policy.repository,ci,signal,waitForCompletion:false});
 console.log(JSON.stringify({event:'automatic-ci-overflow',at:new Date().toISOString(),runId:ci.runId,hostedAttempt:ci.attempt+1}));
}
export async function reconcileDeadRuns({api,policy,signal,onError,pass,hosted}){
 const base=`/repos/${policy.repository}`,marked=hosted??await hostedAttempts({api,policy,signal});
 const identity=run=>run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId &&
  run.workflow_id===policy.workflowId && run.path===policy.workflowPath && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0;
 pass??=await readAutomaticPass({api,policy,signal});
 const {runs,pulls}=pass;
 const pullFor=async run=>{
  let links=run.pull_requests;
  if(!links?.length){
   links=pulls.filter(pull=>pull.head?.sha===run.head_sha && pull.head.repo?.id===policy.repositoryId);
   if(!links.length)links=await api.get(`${base}/commits/${run.head_sha}/pulls`,{signal});
  }
  if(!Array.isArray(links) || links.length!==1 || !Number.isSafeInteger(links[0].number))return;
  const pull=await api.get(`${base}/pulls/${links[0].number}`,{signal});
  if(pull.number!==links[0].number || pull.head?.repo?.id!==policy.repositoryId || pull.base?.repo?.id!==policy.repositoryId ||
   !['open','closed'].includes(pull.state))return;
  return pull;
 };
 const dead=(pull,run)=>pull && (pull.state==='closed' || pull.head.sha!==run.head_sha);
 for(const [id,observed] of runs)try{
  if(!identity(observed) || observed.event!=='pull_request')continue;
  if(pulls.some(pull=>(!observed.pull_requests?.length || observed.pull_requests.some(link=>link.number===pull.number)) &&
   pull.state==='open' && pull.head?.sha===observed.head_sha &&
   pull.head.repo?.id===policy.repositoryId && pull.base?.repo?.id===policy.repositoryId))continue;
  const path=`${base}/actions/runs/${id}`,run=await api.get(path,{signal});
  if(!identity(run) || run.id!==id || run.event!=='pull_request' || run.head_sha!==observed.head_sha ||
   run.run_attempt!==observed.run_attempt || !['queued','in_progress'].includes(run.status))continue;
  if(!dead(await pullFor(run),run))continue;
  const {jobs}=await jobInventory(api,path+`/attempts/${run.run_attempt}/jobs`,signal);
  assert.ok(jobs.every(job=>job.run_id===id && job.run_attempt===run.run_attempt && job.head_sha===run.head_sha),'Foreign dead-run job inventory');
  const latest=await api.get(path,{signal});
  if(!identity(latest) || latest.id!==id || latest.event!=='pull_request' || latest.head_sha!==run.head_sha ||
   latest.run_attempt!==run.run_attempt || !['queued','in_progress'].includes(latest.status))continue;
  const action=jobs.every(job=>job.status==='completed' || !job.runner_id)?'force-cancel':'cancel';
  await api.post(path+'/'+action,undefined,{signal});
  console.log(JSON.stringify({event:'automatic-ci-dead-run',at:new Date().toISOString(),runId:id,attempt:run.run_attempt,action}));
 }catch(error){signal?.throwIfAborted();if(!onError)throw error;if(await onError(error,id)===false)break;}
 for(const [id,attempt] of Object.entries(marked))try{
  let run;
  try{run=await api.get(`${base}/actions/runs/${id}`,{signal});}catch(error){if(error.status!==404)throw error;}
  if(run && (!identity(run) || run.id!==Number(id) || run.status!=='completed'))continue;
  if(run && run.run_attempt<attempt && !(run.event==='pull_request' && dead(await pullFor(run),run)))continue;
  const current=await hostedAttempts({api,policy,signal});
  if(current[id]!==attempt)continue;
  delete current[id];
  await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(current),signal});
  console.log(JSON.stringify({event:'automatic-ci-marker-retired',at:new Date().toISOString(),runId:Number(id),attempt}));
 }catch(error){signal?.throwIfAborted();if(!onError)throw error;if(await onError(error,Number(id))===false)break;}
}
export async function recoverHostedAttempts({api,policy,signal,excludeRuns=new Set(),onError}){
 const values=await hostedAttempts({api,policy,signal}),base=`/repos/${policy.repository}`;
 for(const [id,attempt] of Object.entries(values)){
  if(excludeRuns.has(Number(id)))continue;
  try{
  const path=`${base}/actions/runs/${id}`;let run;
  try{run=await api.get(path,{signal});}catch(error){
   if(error.status!==404)throw error;
   delete values[id];await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});continue;
  }
  assert.ok(run.id===Number(id) && run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId &&
   run.workflow_id===policy.workflowId && run.path===policy.workflowPath && ['pull_request','push','schedule','workflow_dispatch'].includes(run.event) &&
   Number.isSafeInteger(run.run_attempt) && run.run_attempt>=attempt-1,'Hosted overflow run identity differs');
  let obsolete=run.event==='pull_request' && run.pull_requests?.length===0;
  if(run.event==='pull_request' && !obsolete){
   assert.equal(run.pull_requests?.length,1,'Hosted overflow needs one PR');
   const pull=await api.get(`${base}/pulls/${run.pull_requests[0].number}`,{signal});
   obsolete=pull.number!==run.pull_requests[0].number || pull.state!=='open' || pull.head?.sha!==run.head_sha ||
    pull.head.repo?.id!==policy.repositoryId || pull.base?.repo?.id!==policy.repositoryId;
  }
  if(obsolete || attempt>2 || run.run_attempt>attempt || run.run_attempt===attempt && run.status==='completed' || run.run_attempt===attempt-1 && run.status==='completed' && run.conclusion==='success'){
   delete values[id];
   await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});
   continue;
  }
  if(run.run_attempt===attempt)continue;
  assert.equal((await api.get(`${base}/actions/permissions/fork-pr-contributor-approval`,{signal})).approval_policy,'all_external_contributors','External contributor approval is not enabled');
  const inventory=await jobInventory(api,path+`/attempts/${run.run_attempt}/jobs`,signal);
  assert.ok(inventory.jobs.length===inventory.total_count && inventory.total_count<=100,'Incomplete overflow job inventory');
  if(inventory.jobs.some(job=>job.run_id!==run.id || job.run_attempt!==run.run_attempt || job.head_sha!==run.head_sha || blocksRecovery(job))){
   delete values[id];await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});continue;
  }
  if(run.status==='completed'){
   await api.post(path+'/rerun',undefined,{signal});
   console.log(JSON.stringify({event:'automatic-ci-overflow-rerun',at:new Date().toISOString(),runId:run.id,hostedAttempt:attempt}));
  }
  else {
   let force=false;
   if(run.status==='queued'){
    force=inventory.jobs.every(job=>job.run_id===run.id && job.run_attempt===run.run_attempt && job.head_sha===run.head_sha &&
     (job.status==='completed' || job.status==='queued' && !job.runner_id));
   }
   await api.post(path+(force?'/force-cancel':'/cancel'),undefined,{signal});
  }
  }catch(error){signal?.throwIfAborted();if(!onError)throw error;if(await onError(error,Number(id))===false)break;}
 }
 return values;
}
export async function routingHead({api,policy,signal}){
 try{const value=(await api.get(variablePath(policy,'DISPOSABLE_TESTS_HEAD'),{signal})).value;
  return typeof value==='string' && /^[a-f0-9]{40}$/i.test(value)?value.toLowerCase():'';}
 catch(error){if(error.status===404)return '';throw error;}
}
export async function setRoutingHead({api,policy,approvedHead,signal}){
 assert.match(approvedHead,/^[a-f0-9]{40}$/);
 await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HEAD',value:approvedHead,signal});return approvedHead;
}
export async function fallbackOrdinary({api,policy,ci,leases,signal,wait=delay,automatic=false}){
 const path=`/repos/${policy.repository}/actions/runs/${ci.runId}`;
 const check=run=>assert.ok(run.id===ci.runId && run.workflow_id===ci.workflowId && run.head_sha===ci.workflowSha &&
  run.repository?.id===ci.repositoryId && run.head_repository?.id===ci.repositoryId,'Ordinary fallback identity differs');
 let run=await api.get(path,{signal});check(run);
 const job=await api.get(`/repos/${policy.repository}/actions/jobs/${ci.jobId}`,{signal});
 assert.ok(job.id===ci.jobId && job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha && (ci.jobKey?job.name===jobName(ci):ciJobKeyPattern.test(ordinaryKey(job.name,job.labels)??'')),'Ordinary fallback job differs');
 const pending=leases?.inspect().ciInvocation;
 const ownedCancel=pending?.ordinaryStage==='cancel-requested' && pending.runId===ci.runId && pending.attempt===ci.attempt && pending.jobId===ci.jobId;
 const refused=pending?.ordinaryStage==='refused' && pending.runId===ci.runId && pending.attempt===ci.attempt && pending.jobId===ci.jobId;
 // A refusal owns no guest and cannot take over a job assigned during an API gap.
 if(refused && (job.status!=='queued' || job.runner_id))return {retry:false,assigned:true};
 if(job.status==='completed' && (!ownedCancel || job.conclusion==='success'))return {retry:false};
 assert.ok(run.run_attempt===ci.attempt || ownedCancel && run.run_attempt===ci.attempt+1,'Ordinary fallback attempt differs');
 const currentPR=async run=>{
  if(['push','schedule','workflow_dispatch'].includes(run.event))return true;
  assert.ok(run.event==='pull_request' && run.pull_requests?.length===1,'Ordinary fallback PR identity differs');
  const pull=await api.get(`/repos/${policy.repository}/pulls/${run.pull_requests[0].number}`,{signal});
  assert.equal(pull.number,run.pull_requests[0].number,'Ordinary fallback PR identity changed');
  const current=pull.state==='open' && pull.head?.sha===(ci.sourceSha??ci.workflowSha) &&
   pull.head.repo?.id===ci.repositoryId && pull.base?.repo?.id===ci.repositoryId;
  if(!automatic)assert.ok(current,'Ordinary fallback PR head changed');
  return current;
 };
 if(!await currentPR(run))return {retry:false,obsolete:true};
 if(ownedCancel && run.run_attempt===ci.attempt+1)return {retry:true,runId:ci.runId,previousAttempt:ci.attempt,sourceSha:ci.sourceSha??ci.workflowSha};
 assert.equal(run.run_attempt,ci.attempt,'Ordinary fallback attempt differs');
 if(automatic)for(const marked of [false,true]){
  const inventory=await jobInventory(api,path+`/attempts/${ci.attempt}/jobs`,signal,1000,'Incomplete cancellation job inventory');
  if(!inventory.jobs.every(job=>job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha))return {retry:false,pending:true};
  if(ci.attempt>1 || inventory.jobs.some(ownedCancel?blocksRecovery:startedWork)){
   if(marked){const values=await hostedAttempts({api,policy,signal});if(values[ci.runId]===ci.attempt+1){delete values[ci.runId];await writeRoutingVariable({api,policy,name:'DISPOSABLE_TESTS_HOSTED_ATTEMPTS',value:JSON.stringify(values),signal});}}
   return {retry:false,started:true};
  }
  if(!marked)await markHostedAttempt({api,policy,ci,signal});
 }
 if(ownedCancel && run.status==='queued'){
  const outcome=await cancelCIJob({api,repository:policy.repository,ci,signal,wait,force:true,waitForCompletion:!automatic});
  if(outcome?.pending)return {retry:false,pending:true};
 }else if(job.status!=='completed'){
  assert.ok(pending?.ordinaryStage==='admitted' || refused || ownedCancel,'Ordinary fallback needs its persisted intent');
  if(!automatic)await setRoutingMode({api,policy,mode:'hosted',signal});
  leases.setInvocation({...pending,ordinaryStage:'cancel-requested'});
  await cancelCIJob({api,repository:policy.repository,ci,signal,wait,waitForCompletion:!automatic});
 }
 run=await api.get(path,{signal});check(run);
 assert.equal(run.run_attempt,ci.attempt,'Ordinary fallback attempt changed before retry');
 if(run.status!=='completed')return {retry:false,pending:true};
 if(!await currentPR(run))return {retry:false,obsolete:true};
 await api.post(path+'/rerun',undefined,{signal});
 return {retry:true,runId:ci.runId,previousAttempt:ci.attempt,sourceSha:ci.sourceSha??ci.workflowSha};
}
export async function findOrdinary({api,policy,approvedHead,runId,jobId,automatic=false,requireHostedRouting=false,signal}){
 assert.match(approvedHead,/^[a-f0-9]{40}$/);
 assert.ok(Number.isSafeInteger(runId) && runId>0,'Invalid ordinary run ID');
 assert.equal((await api.get(`/repos/${policy.repository}/actions/permissions/fork-pr-contributor-approval`,{signal})).approval_policy,
  'all_external_contributors','External contributor approval is not enabled');
 const base=`/repos/${policy.repository}`,run=await api.get(`${base}/actions/runs/${runId}`,{signal});
 assert.ok(run.id===runId && run.head_sha===approvedHead && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0 && ['pull_request','push','schedule','workflow_dispatch'].includes(run.event) &&
  run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId && run.workflow_id===policy.workflowId &&
  run.path===policy.workflowPath && ['queued','in_progress'].includes(run.status),'Unapproved ordinary CI run');
 if(run.event==='pull_request')assert.equal(run.pull_requests?.length,1,'Ordinary run needs one PR');
 const inventory=await jobInventory(api,`${base}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs`,signal);
 assert.ok(Number.isSafeInteger(inventory.total_count) && inventory.total_count<=100 && inventory.jobs.length===inventory.total_count,
  'Incomplete ordinary CI job inventory');
 const candidates=inventory.jobs.filter(job=>jobId===undefined?job.name==='typecheck':job.id===jobId);
 assert.ok(candidates.length<=1,'Ambiguous ordinary typecheck job');
 if(!candidates.length)return null;
 const [repository,blob,source,pull]=await Promise.all([
  api.get(base,{signal}),api.get(`${base}/contents/${policy.workflowPath}?ref=${run.head_sha}`,{signal}),
  api.get(`${base}/commits/${approvedHead}`,{signal}),run.event==='pull_request'?api.get(`${base}/pulls/${run.pull_requests[0].number}`,{signal}):undefined]);
 assert.equal(blob.encoding,'base64','Invalid workflow blob encoding');
 const workflow=Buffer.from(blob.content,'base64').toString(),digest=createHash('sha256').update(workflow).digest('hex');
 if(requireHostedRouting && !workflow.includes('vars.DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return null;
 const admittedPolicy=automatic?{...policy,workflowDigest:digest}:policy;
 return admitOrdinary(admittedPolicy,approvedHead,{repository,run,job:candidates[0],workflow,source,pull});
}
export async function findAutomatic({api,policy,limit,signal,exclude=new Set(),excludeRuns=new Set(),hosted={},onePerRun=false,onRefused,runs:observed}){
 assert.ok(Number.isSafeInteger(limit) && limit>=0 && limit<=16,'Invalid free-slot count');
 if(!limit)return [];
 const base=`/repos/${policy.repository}`,found=[];
 const upstream=api,reads=new Map();
 api={get:async(path,options)=>{if(!reads.has(path))reads.set(path,upstream.get(path,options));return reads.get(path);}};
 const inventories=observed?[]:await Promise.all(['queued','in_progress'].map(status=>runInventory(upstream,`${base}/actions/workflows/${policy.workflowId}/runs?status=${status}&per_page=100`,signal)));
 const runs=new Map(observed);
 for(const inventory of inventories){
  assert.ok(Number.isSafeInteger(inventory.total_count) && inventory.total_count<=100 && inventory.workflow_runs.length===inventory.total_count,'Incomplete automatic run inventory');
  for(const run of inventory.workflow_runs)runs.set(run.id,run);
 }
 for(const run of [...runs.values()].sort((a,b)=>(a.created_at??'').localeCompare(b.created_at??'') || a.id-b.id)){
  if(excludeRuns.has(run.id) || hosted[run.id]===run.run_attempt)continue;
  let candidate;
  try{
  if(!['pull_request','push','schedule','workflow_dispatch'].includes(run.event) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt<1 || run.repository?.id!==policy.repositoryId || run.head_repository?.id!==policy.repositoryId ||
   run.workflow_id!==policy.workflowId || run.path!==policy.workflowPath || !['queued','in_progress'].includes(run.status))continue;
  if(run.event==='pull_request'){
   if(run.pull_requests?.length!==1)continue;
   const pull=await api.get(`${base}/pulls/${run.pull_requests[0].number}`,{signal});
   if(pull.state!=='open' || pull.head?.sha!==run.head_sha || pull.head.repo?.id!==policy.repositoryId || pull.base?.repo?.id!==policy.repositoryId)continue;
  }
  const inventory=await jobInventory(api,`${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,signal);
  assert.ok(Number.isSafeInteger(inventory.total_count) && inventory.total_count<=100 && inventory.jobs.length===inventory.total_count,'Incomplete automatic job inventory');
  for(const job of inventory.jobs){
   if(exclude.has(job.id) || job.status!=='queued' || job.runner_id || !ordinaryKey(job.name,job.labels) || job.labels?.length!==2 || !job.labels.includes('self-hosted'))continue;
   const key=ordinaryKey(job.name,job.labels);
   if(!ciJobKeyPattern.test(key) || !job.labels.includes(`dt-${policy.repositoryId}-${run.id}-${run.run_attempt}-${key}`))continue;
   candidate={runId:run.id,jobId:job.id,name:job.name,label:`dt-${policy.repositoryId}-${run.id}-${run.run_attempt}-${key}`};
   const ci=await findOrdinary({api,policy,approvedHead:run.head_sha,runId:run.id,jobId:job.id,automatic:true,signal});
   if(ci)found.push(ci);
   if(found.length===limit)return found;
   if(ci && onePerRun)break;
  }
  }catch(error){signal?.throwIfAborted();if(error.status===401 || error.status===403 || Number.isFinite(error.retryAt))throw error;console.error(JSON.stringify({event:'automatic-ci-refused',runId:run.id,error:error.message}));
   if(candidate && error.code==='ERR_ASSERTION' && onRefused)try{await onRefused(candidate);}catch(fallbackError){
    signal?.throwIfAborted();console.error(JSON.stringify({event:'automatic-ci-refused-fallback-pending',runId:run.id,error:fallbackError.message}));
   }
  }
 }
 return found;
}
export async function executeOrdinary({api,policy,leases,ci,lane,transport,signal,automatic=false,fallback}){
 assert.ok(!leases.inspect().ciInvocation && leases.inspect().slots.every(slot=>slot.state==='free'),'CI capacity is occupied');
 if(!automatic)assert.equal(await routingMode({api,policy,signal}),'server','Ordinary CI server admission is closed');
 assert.equal(await routingHead({api,policy,signal}),automatic?'':ci.sourceSha,'Ordinary CI selected head differs');
 const {randomBytes}=await import('node:crypto');
 const invocation={nonce:randomBytes(16).toString('hex'),sourceSha:ci.sourceSha,workflowSha:ci.workflowSha,
  route:'server',createdAt:Date.now(),runId:ci.runId,attempt:ci.attempt,jobId:ci.jobId,ordinaryStage:'admitted'};
 leases.setInvocation(invocation);
 let result;
 try{
  const health=signal?AbortSignal.any([signal,AbortSignal.timeout(7500)]):AbortSignal.timeout(7500);
  assert.equal(await transport.healthy({signal:health}),true,'CI server unavailable');
  if(!automatic)assert.equal(await routingMode({api,policy,signal}),'server','Ordinary CI server admission closed during health check');
  assert.equal(await routingHead({api,policy,signal}),automatic?'':ci.sourceSha,'Ordinary CI selected head changed during health check');
  result=await runCI({api,leases,transport,repository:policy.repository,lane,ci,signal});
  if(result.completion?.code===0)return result;
  assert.ok(result.code===0 && result.cleanup==='absent' && !result.runnerCleanup,result.error??'Ordinary server job did not qualify');
  leases.clearInvocation(invocation.nonce);return result;
 }catch(error){
  assert.ok(leases.inspect().slots.every(slot=>slot.state==='free'),`Ordinary CI cleanup remains uncertain: ${error.message}`);
  const retry=automatic?{retry:false}:await (fallback??fallbackOrdinary)({api,policy,ci,leases,automatic,signal:AbortSignal.timeout(240000)});
  if(!retry.pending && retry.code!==75)leases.clearInvocation(invocation.nonce);return {...result,code:125,error:error.message,...retry};
 }
}
export async function qualifyOrdinaryHosted({api,policy,retry,signal,wait=delay}){
 const base=`/repos/${policy.repository}`,end=Date.now()+3300000;
 while(true){
  const run=await api.get(`${base}/actions/runs/${retry.runId}`,{signal});
  assert.ok(run.id===retry.runId && run.head_sha===retry.sourceSha && run.workflow_id===policy.workflowId && ['pull_request','push','schedule','workflow_dispatch'].includes(run.event) &&
   run.path===policy.workflowPath && run.repository?.id===policy.repositoryId && run.head_repository?.id===policy.repositoryId &&
   [retry.previousAttempt,retry.previousAttempt+1].includes(run.run_attempt),'Hosted retry identity or attempt differs');
  if(run.run_attempt===retry.previousAttempt+1 && run.status==='completed'){
   assert.equal(run.conclusion,'success','Hosted retry failed');
   const inventory=await jobInventory(api,`${base}/actions/runs/${retry.runId}/attempts/${run.run_attempt}/jobs`,signal);
   assert.ok(inventory.jobs.length===inventory.total_count && inventory.total_count<=100 && inventory.jobs.every(job=>
    job.run_id===retry.runId && job.run_attempt===run.run_attempt && job.head_sha===retry.sourceSha && job.status==='completed'),'Hosted retry inventory is incomplete');
   const named=name=>{const jobs=inventory.jobs.filter(job=>job.name===name);assert.equal(jobs.length,1,`Hosted retry ${name} is missing or duplicated`);return jobs[0];};
   const job=named('typecheck'),summary=named('summary');
   for(const completed of [job,summary])assert.ok(completed.conclusion==='success' && completed.runner_id>0 &&
    completed.labels.includes('ubuntu-latest') && !completed.labels.includes('self-hosted'),`Hosted retry ${completed.name} did not qualify`);
   const source=await api.get(`${base}/commits/${retry.sourceSha}`,{signal});assert.equal(source.sha,retry.sourceSha);assert.match(source.commit.tree.sha,/^[a-f0-9]{40}$/);
   const log=await api.jobLog(`${base}/actions/jobs/${job.id}/logs`,{signal});
   assert.ok(new RegExp('git log -1 --format=%H[\\s\\S]{0,200}'+retry.sourceSha).test(log),'Hosted retry checkout differs');
   return {runId:run.id,attempt:run.run_attempt,sourceSha:source.sha,sourceTree:source.commit.tree.sha,route:'hosted',typecheck:job.id,summary:summary.id};
  }
  assert.ok(Date.now()<end,'Hosted retry overall deadline exceeded');await wait(15000,undefined,{signal});
 }
}

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

export async function cancelCIJob({api,repository,ci,signal,wait=delay,force=false,waitForCompletion=true}){
 assert.ok(Number.isSafeInteger(ci.jobId) && ci.jobId>0,'Recorded CI job identity is missing');
 const path=`/repos/${repository}/actions/runs/${ci.runId}`;
 const run=await api.get(path,{signal});
 assert.ok(run.id===ci.runId && run.workflow_id===ci.workflowId && run.head_sha===ci.workflowSha &&
  run.repository?.id===ci.repositoryId && run.head_repository?.id===ci.repositoryId,'Recorded CI cancellation identity differs');
 const job=await api.get(`/repos/${repository}/actions/jobs/${ci.jobId}`,{signal});
 assert.ok(job.id===ci.jobId && job.run_id===ci.runId && job.run_attempt===ci.attempt && job.head_sha===ci.workflowSha,'Recorded CI job identity differs');
 if(job.status==='completed' && !force)return;
 assert.equal(run.run_attempt,ci.attempt,'Recorded CI cancellation attempt differs');
 if(run.status==='completed')return;
 if(force){
  assert.equal(run.status,'queued','Force cancellation needs a queued run');
  if(job.status!=='completed' || job.conclusion!=='cancelled'){
   assert.ok(job.status==='queued' && !job.runner_id,'Force cancellation needs an unassigned queued job');
   const {jobs,total_count:total}=await jobInventory(api,path+`/attempts/${ci.attempt}/jobs`,signal,1000,'Incomplete cancellation job inventory');
   assert.equal(jobs.length,total,'Incomplete cancellation job inventory');
   assert.ok(jobs.some(candidate=>candidate.id===ci.jobId),'Cancellation job missing from inventory');
   if(jobs.some(candidate=>candidate.run_id!==ci.runId || candidate.run_attempt!==ci.attempt || candidate.head_sha!==ci.workflowSha ||
    !(candidate.status==='completed' || candidate.status==='queued' && !candidate.runner_id)))return {pending:true};
  }
 }
 await api.post(path+(force?'/force-cancel':'/cancel'),undefined,{signal});const end=Date.now()+120000;
 while(true){const current=await api.get(path,{signal});assert.equal(current.run_attempt,ci.attempt,'CI attempt changed during cancellation');
  if(current.status==='completed')return;
  if(!waitForCompletion)return {pending:true};
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
 let completion;
 let result=await runLocal({leases,request:ciRequest(lane,ci),signal,transport:{
  healthy:options=>transport.healthy(options),transfer:(lease,options)=>transport.transfer(lease,options),
  prepare:(lease,options)=>transport.prepare(lease,options),
  execute:async(lease,options)=>{
   const run=await api.get(`${base}/runs/${ci.runId}`,options),job=await api.get(`${base}/jobs/${ci.jobId}`,options);
   assert.ok(run.id===ci.runId && run.run_attempt===ci.attempt && run.workflow_id===ci.workflowId && run.head_sha===ci.workflowSha &&
    ['queued','in_progress'].includes(run.status) && run.repository?.id===ci.repositoryId && run.head_repository?.id===ci.repositoryId &&
    job.name===jobName(ci) && job.id===ci.jobId && job.run_id===ci.runId && job.run_attempt===ci.attempt &&
    job.head_sha===ci.workflowSha && job.status==='queued' && !job.runner_id,'CI identity changed before registration');
   assert.equal((await namedRunners(api,repository,name,options.signal)).length,0,'CI runner name already registered; do not remint');
   // Match hosted checkouts because coverage blobs key source files by absolute path.
   const registration=await api.post(`${base}/runners/generate-jitconfig`,{
    name,runner_group_id:1,labels:['self-hosted',routingLabel(ci)],work_folder:'/home/runner/work'},options);
   assert.ok(registration.runner?.name===name && Number.isSafeInteger(registration.runner.id) && registration.runner.id>0 &&
    typeof registration.encoded_jit_config==='string' && registration.encoded_jit_config.length>0 && registration.encoded_jit_config.length<=64000,'Invalid CI registration response');
   assert.ok(leases.bindRunner(lease,registration.runner.id),'CI runner lease changed before binding');
   const execution=new AbortController(),monitor=new AbortController();let ended=false,monitorFailure;
   const work=AbortSignal.any([options.signal,execution.signal]);
   const watching=(async()=>{
    let healthyAt=Date.now(),refusal,retryAt=0,reported=false,reportedLimit=false;
    while(!ended){
     try{await wait(15000,undefined,{signal:monitor.signal});}catch{if(ended)return;throw new Error('CI monitor stopped');}
     if(ended)return;
     try{
      let unavailable=false;
      const read=async (path,operation)=>{
       if(Date.now()<retryAt){unavailable=true;return undefined;}
       try{return await api.get(path,{signal:work});}
       catch(error){
        unavailable=true;
        const limited=[403,429].includes(error.status) && Number.isFinite(error.retryAt);
        if(!reported || limited && !reportedLimit){reported=true;reportedLimit||=limited;console.error(JSON.stringify({event:'automatic-ci-monitor-read-refused',at:new Date().toISOString(),runId:ci.runId,jobId:ci.jobId,
         operation,errorClass:error.name,status:error.status??null,retryAt:Number.isFinite(error.retryAt)?error.retryAt:null}));}
        if(limited)retryAt=Math.max(retryAt,error.retryAt);
        const transient=limited || error instanceof TypeError && error.message==='fetch failed' || error.name==='TimeoutError' ||
         error.code==='GITHUB_RESPONSE_INTERRUPTED' || Number.isInteger(error.status) && error.status>=500 && error.status<=599;
        if(!transient)refusal??={at:healthyAt,error};
        return undefined;
       }
      };
      const current=await read(`${base}/runs/${ci.runId}`,'run');
      if(current!==undefined)assert.equal(current.run_attempt,ci.attempt,'CI attempt changed during execution');
      const job=await read(`${base}/jobs/${ci.jobId}`,'job');
      if(job!==undefined){
       assert.ok(!job.runner_id || job.runner_id===registration.runner.id,'CI runner assignment differs');
       assert.ok(job.status!=='completed' || job.conclusion==='success','CI job assignment completed without success');
       if(!job.runner_id){
        const runner=await read(`${base}/runners/${registration.runner.id}`,'runner');
        if(runner!==undefined){
         assert.ok(runner.id===registration.runner.id && runner.name===name,'CI runner assignment readback identity differs');
         assert.equal(runner.busy,false,'CI runner assignment is busy elsewhere');
        }
       }
       if(job.status==='queued')assert.ok(Date.now()-lease.createdAt<900000,'CI queue deadline exceeded');
      }
      if(!unavailable)refusal=undefined;
      if(refusal && Date.now()-refusal.at>=60000)throw refusal.error;
      const observed=await transport.inspect(lease,{signal:work});
      assert.ok(observed.running===true,'CI guest is no longer running');healthyAt=Date.now();
     }catch(error){
      if(/assignment|attempt|deadline|no longer running/i.test(error.message) || refusal && Date.now()-refusal.at>=60000 || Date.now()-healthyAt>=60000)throw error;
     }
    }
   })().catch(error=>{monitorFailure=error;execution.abort();});
   let code;
   try{code=await transport.execute(lease,{signal:work,jitconfig:registration.encoded_jit_config});}
   catch(error){throw monitorFailure??error;}
   finally{ended=true;monitor.abort();await watching;}
   if(monitorFailure)throw monitorFailure;
   completion={code,observations:[],expected:{id:ci.jobId,run_id:ci.runId,run_attempt:ci.attempt,head_sha:ci.workflowSha,
    runner_id:registration.runner.id,runner_name:name,status:'completed',conclusion:'success'}};
   // A zero-exit listener’s final readback cannot justify cancelling siblings.
   // Retire fallback first; the lease and orphan runner still own cleanup.
   if(code===0 && ci.workflowPath==='.github/workflows/ci.yml'){
    const pending=leases.inspect().ciInvocation;
    assert.ok(pending && pending.runId===ci.runId && pending.attempt===ci.attempt && pending.jobId===ci.jobId,'Completion intent differs');
    assert.ok(leases.clearInvocation(pending.nonce),'Completion intent was not retired');
   }
   for(let attempt=0;attempt<5;attempt++){
    const observed=await api.get(`${base}/jobs/${ci.jobId}`,options);
    completion.observations.push(Object.fromEntries(Object.keys(completion.expected).map(key=>[key,observed[key]??null])));
    const assigned=observed.id===ci.jobId && observed.run_id===ci.runId && observed.run_attempt===ci.attempt &&
     observed.head_sha===ci.workflowSha && observed.runner_id===registration.runner.id && observed.runner_name===name;
    if(code===0 && assigned && observed.status==='completed' && observed.conclusion==='success')return code;
    assert.ok(code===0 && assigned && ['queued','in_progress'].includes(observed.status) && attempt<4,
     'CI assignment or job completion did not qualify');
    await wait(2000,undefined,options);
   }
  },destroy:(lease,options)=>transport.destroy(lease,options),inspect:(lease,options)=>transport.inspect(lease,options)
 }});
 if(completion)result={...result,completion};
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
 const inventory=await jobInventory(api,`${base}/actions/runs/${invocation.runId}/attempts/${invocation.attempt}/jobs`,signal);
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
    const jobs=await jobInventory(api,`${base}/actions/runs/${invocation.runId}/attempts/${invocation.attempt}/jobs`,signal);
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
 assert.equal(configuredSlots(config),1,'The canary entry uses its original one-slot rehearsal profile');
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
 assert.deepEqual(Object.keys(config).sort(),['ci','host','hostGeneration','mode','recipe','repository',...(config.mode==='manual-slots'?['slots']:[]),'state','version']);
 configuredSlots(config);
 const ci=config.ci;assert.deepEqual(Object.keys(ci).sort(),['appEnv','appKey',...(ci.candidateWorkflowDigest===undefined?[]:['candidateWorkflowDigest']),'repository','repositoryId','workflowDigest',...(ci.workflowHistory===undefined?[]:['workflowHistory']),'workflowId','workflowPath']);
 assert.ok(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(ci.repository) && ['.github/workflows/disposable-ci-canary.yml','.github/workflows/ci.yml'].includes(ci.workflowPath) &&
  [ci.repositoryId,ci.workflowId].every(v=>Number.isSafeInteger(v)&&v>0),'Invalid CI policy identity');
 assert.match(ci.workflowDigest,/^[a-f0-9]{64}$/);
 if(ci.candidateWorkflowDigest!==undefined)assert.match(ci.candidateWorkflowDigest,/^[a-f0-9]{64}$/);
 if(ci.workflowHistory!==undefined){
  assert.ok(ci.workflowPath==='.github/workflows/ci.yml' && Array.isArray(ci.workflowHistory) && ci.workflowHistory.length>0 && ci.workflowHistory.length<=10,'Invalid workflow history bound');
  for(const pin of ci.workflowHistory){
   assert.ok(pin && Object.keys(pin).sort().join(',')==='digest,sha' && /^[a-f0-9]{40}$/.test(pin.sha) && /^[a-f0-9]{64}$/.test(pin.digest),'Invalid workflow history pin');
  }
  assert.ok(new Set(ci.workflowHistory.map(pin=>pin.sha)).size===ci.workflowHistory.length && new Set(ci.workflowHistory.map(pin=>pin.digest)).size===ci.workflowHistory.length && ci.workflowHistory[0].digest===ci.workflowDigest,'Invalid workflow history versions');
 }
 for(const path of [config.state,ci.appEnv,ci.appKey])assert.ok(typeof path==='string' && path.startsWith('/'),'CI paths must be absolute');
}
const cli=process.argv[1];
if(cli && cli!=='-'){
 const {realpathSync}=await import('node:fs'),{pathToFileURL}=await import('node:url');
 if(import.meta.url===pathToFileURL(realpathSync(cli)).href){try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));process.exitCode=result.code;}
 catch(error){console.error(error.message);process.exitCode=125;}}
}
