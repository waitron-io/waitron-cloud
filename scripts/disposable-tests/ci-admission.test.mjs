import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
const workflow='reviewed workflow bytes';
const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',
 workflowDigest:createHash('sha256').update(workflow).digest('hex')};
const input={runId:789,attempt:1,sourceSha:'3'.repeat(40),nonce:'a'.repeat(32)};
function evidence(){return {repository:{id:123,full_name:'fixture/cloud'},workflow,
 run:{id:789,run_attempt:1,repository:{id:123},head_repository:{id:123},head_sha:'1'.repeat(40),workflow_id:456,
 path:policy.workflowPath,event:'workflow_dispatch',display_title:'disposable-'+input.nonce,status:'in_progress'},
 job:{id:901,run_id:789,run_attempt:1,head_sha:'1'.repeat(40),name:'typecheck',status:'queued',
 labels:['self-hosted','dt-123-789-1-typecheck'],runner_id:null},
 source:{sha:input.sourceSha,commit:{tree:{sha:'4'.repeat(40)}}}};}
test('admission binds current concrete API job and independent Git tree to reviewed workflow',async()=>{
 const {admitCI}=await import('./ci-canary.mjs');const ci=admitCI(policy,input,evidence());
 assert.equal(ci.jobId,901);assert.equal(ci.sourceTree,'4'.repeat(40));assert.equal(ci.workflowSha,'1'.repeat(40));
});
test('foreign, stale, changed-workflow, wrong-label and wrong-source requests refuse admission',async()=>{
 const {admitCI}=await import('./ci-canary.mjs');
 for(const change of [e=>e.repository.id++,e=>e.repository.full_name='other/cloud',
 e=>{e.run.run_attempt=2;e.job.run_attempt=2;e.job.labels=['self-hosted','dt-123-789-2-typecheck'];},e=>e.run.repository.id++,e=>e.run.head_repository.id++,e=>e.run.workflow_id++,
 e=>e.run.run_attempt++,e=>e.run.event='pull_request_target',e=>e.run.path='other',e=>e.run.display_title='foreign',
 e=>e.job.run_attempt++,e=>e.job.run_id++,e=>e.job.head_sha='5'.repeat(40),e=>e.job.name='summary',
 e=>e.job.labels=['self-hosted'],e=>e.job.labels=['self-hosted','foreign-label'],e=>e.job.status='in_progress',e=>e.workflow+='changed',e=>e.source.sha='6'.repeat(40)]){
 const value=evidence();change(value);assert.throws(()=>admitCI(policy,input,value));
 }
});
test('a stale attempt cannot cancel a newer run and fallback keeps the identical source',async()=>{
 const {fallbackCI}=await import('./ci-canary.mjs');let cancelled=false,dispatched;
 const api={get:async()=>({...evidence().run,run_attempt:2}),post:async()=>{cancelled=true;}};
 await assert.rejects(fallbackCI({api,policy,invocation:{...input,route:'server'},dispatch:async x=>dispatched=x}),/attempt/i);
 assert.equal(cancelled,false);assert.equal(dispatched,undefined);
});

test('terminal canary qualification requires both jobs, actual route and source tree in its log',async()=>{
 const {qualifyCanary}=await import('./ci-canary.mjs');const invocation={...input,workflowSha:'1'.repeat(40),route:'hosted'};
 const job={id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:invocation.workflowSha,status:'completed',conclusion:'success',labels:['ubuntu-latest'],runner_id:1001};
 const summary={...job,id:902,name:'summary'};
 const api={get:async path=>path.includes('/commits/')?evidence().source:path.includes('/jobs?')?{total_count:2,jobs:[job,summary]}:
  {...evidence().run,status:'completed',conclusion:'success'},jobLog:async()=>`Source ${input.sourceSha} tree ${'4'.repeat(40)}\n`};
 assert.equal((await qualifyCanary({api,policy,invocation})).sourceTree,'4'.repeat(40));
 job.labels=['self-hosted'];await assert.rejects(qualifyCanary({api,policy,invocation}),/route/i);job.labels=['ubuntu-latest'];
 api.jobLog=async()=>`Source ${input.sourceSha} tree ${'5'.repeat(40)}\n`;
 await assert.rejects(qualifyCanary({api,policy,invocation}),/source|tree/i);
});
test('a recorded non-canary job cannot cancel a newer workflow attempt',async()=>{
 const {cancelCIJob}=await import('./ci-canary.mjs');assert.equal(typeof cancelCIJob,'function');let cancelled=false;
 const api={get:async path=>path.includes('/jobs/')?{...evidence().job,status:'queued'}:({...evidence().run,run_attempt:2}),post:async()=>{cancelled=true;}};
 await assert.rejects(cancelCIJob({api,repository:'fixture/cloud',ci:{repositoryId:123,workflowId:456,workflowSha:'1'.repeat(40),runId:789,attempt:1,jobId:901}}),/attempt|identity/i);
 assert.equal(cancelled,false);
});

test('recorded job cancellation refuses a different repository without cancelling',async()=>{
 const {cancelCIJob}=await import('./ci-canary.mjs');let cancelled=false;
 const api={get:async path=>path.includes('/jobs/')?{...evidence().job,status:'queued'}:{...evidence().run,repository:{id:999}},post:async()=>{cancelled=true;}};
 await assert.rejects(cancelCIJob({api,repository:'fixture/cloud',ci:{repositoryId:123,workflowId:456,workflowSha:'1'.repeat(40),runId:789,attempt:1,jobId:901}}),/identity/i);assert.equal(cancelled,false);
});
test('cancellation readback refuses a newer attempt that races the cancel request',async()=>{
 const {cancelCIJob}=await import('./ci-canary.mjs');let posts=0;
 const api={get:async path=>path.includes('/jobs/')?{...evidence().job,status:'queued'}:{...evidence().run,run_attempt:posts?2:1,status:posts?'completed':'in_progress'},post:async()=>{posts++;}};
 await assert.rejects(cancelCIJob({api,repository:'fixture/cloud',ci:{repositoryId:123,workflowId:456,workflowSha:'1'.repeat(40),runId:789,attempt:1,jobId:901}}),/attempt/i);assert.equal(posts,1);
});
