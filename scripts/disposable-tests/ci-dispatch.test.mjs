import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {LocalLeases} from './leases.mjs';
const workflow='reviewed bytes',sourceSha='3'.repeat(40),workflowSha='1'.repeat(40);
const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex')};
function setup(t){const root=mkdtempSync(join(tmpdir(),'ci-dispatch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 return new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});}
test('lost dispatch reply is reconciled by persisted nonce without a second dispatch',async t=>{
 const {dispatchCanary}=await import('./ci-canary.mjs');const leases=setup(t);let calls=0,record;
 const api={post:async(path,body)=>{calls++;record=leases.inspect().ciInvocation;assert.equal(body.inputs.nonce,record.nonce);throw new Error('lost response');},
 get:async()=>({total_count:1,workflow_runs:[{id:789,run_attempt:1,workflow_id:456,head_sha:workflowSha,event:'workflow_dispatch',display_title:'disposable-'+record.nonce}]})};
 const result=await dispatchCanary({api,leases,policy,sourceSha,workflowSha,route:'server',wait:async()=>{}});
 assert.equal(calls,1);assert.equal(result.runId,789);assert.equal(leases.inspect().ciInvocation.runId,789);
});
test('server unavailable before dispatch chooses hosted and never asks for a runner',async t=>{
 const {startCanary}=await import('./ci-canary.mjs');const leases=setup(t);let sent;
 const api={get:async path=>path.includes('fork-pr')?{approval_policy:'all_external_contributors'}:
  path.includes('/commits/')?{sha:sourceSha,commit:{tree:{sha:'4'.repeat(40)}}}:
  path.includes('/contents/')?{content:Buffer.from(workflow).toString('base64'),encoding:'base64'}:
  {total_count:1,workflow_runs:[{id:789,run_attempt:1,workflow_id:456,head_sha:workflowSha,event:'workflow_dispatch',display_title:'disposable-'+leases.inspect().ciInvocation.nonce}]},
 post:async(path,body)=>{sent=body;}};
 const result=await startCanary({api,leases,policy,sourceSha,workflowSha,transport:{healthy:async()=>false},wait:async()=>{}});
 assert.equal(sent.inputs.route,'hosted');assert.equal(result.route,'hosted');assert.equal(leases.inspect().slots[0].state,'free');
});

test('recovery of a recorded server invocation cancels that attempt and dispatches the same source hosted',async t=>{
 const {recoverCanary}=await import('./ci-canary.mjs');const leases=setup(t);
 const old={repositoryId:123,nonce:'a'.repeat(32),sourceSha,workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1};leases.setInvocation(old);
 let cancelled=false,newNonce,dispatched;
 const api={get:async path=>path.includes('/workflows/')?{workflow_runs:[{id:790,run_attempt:1,workflow_id:456,head_sha:workflowSha,event:'workflow_dispatch',display_title:'disposable-'+newNonce}]}:
  {id:789,run_attempt:1,workflow_id:456,head_sha:workflowSha,display_title:'disposable-'+old.nonce,status:cancelled?'completed':'queued'},
 post:async(path,body)=>{if(path.endsWith('/cancel'))cancelled=true;else{dispatched=body;newNonce=body.inputs.nonce;}}};
 const result=await recoverCanary({api,leases,policy,wait:async()=>{}});
 assert.equal(cancelled,true);assert.equal(dispatched.inputs.source_sha,sourceSha);assert.equal(dispatched.inputs.route,'hosted');assert.equal(result.runId,790);
});
test('a terminal failed hosted attempt stops visibly and does not strand the next invocation',async t=>{
 const {recoverCanary}=await import('./ci-canary.mjs');const leases=setup(t);
 const invocation={repositoryId:123,nonce:'a'.repeat(32),sourceSha,workflowSha,route:'hosted',createdAt:Date.now(),runId:789,attempt:1};leases.setInvocation(invocation);
 const api={get:async()=>({id:789,run_attempt:1,workflow_id:456,head_sha:workflowSha,display_title:'disposable-'+invocation.nonce,event:'workflow_dispatch',status:'completed',conclusion:'failure'})};
 await assert.rejects(recoverCanary({api,leases,policy}),/789.*failure|failure.*789/);
 assert.equal(leases.inspect().ciInvocation,undefined);assert.equal(leases.inspect().slots[0].state,'free');
});
test('a definite dispatch refusal clears the intent without polling for a run',async t=>{
 const {dispatchCanary}=await import('./ci-canary.mjs');const leases=setup(t);let polled=false;
 const api={post:async()=>{const error=new Error('GitHub POST refused (422)');error.status=422;throw error;},get:async()=>{polled=true;throw new Error('Unexpected poll');}};
 await assert.rejects(dispatchCanary({api,leases,policy,sourceSha,workflowSha,route:'server'}),/422/);
 assert.equal(polled,false);assert.equal(leases.inspect().ciInvocation,undefined);
});
test('a dispatch racing main is cancelled by its owned nonce and retired without a runner',async t=>{
 const {dispatchCanary}=await import('./ci-canary.mjs');const leases=setup(t);let nonce,cancelled=false;
 const run=()=>({id:789,run_attempt:1,workflow_id:456,head_sha:'5'.repeat(40),event:'workflow_dispatch',display_title:'disposable-'+nonce,status:cancelled?'completed':'queued'});
 const api={post:async(path,body)=>{if(path.endsWith('/cancel'))cancelled=true;else nonce=body.inputs.nonce;},get:async path=>path.includes('/workflows/')?{workflow_runs:[run()]}:run()};
 await assert.rejects(dispatchCanary({api,leases,policy,sourceSha,workflowSha,route:'server',wait:async()=>{}}),/commit|identity|revision/i);
 assert.equal(cancelled,true);assert.equal(leases.inspect().ciInvocation,undefined);assert.equal(leases.inspect().slots[0].state,'free');
});
test('a completed server execution awaiting only summary is not cancelled by recovery',async t=>{
 const {recoverCanary}=await import('./ci-canary.mjs');const leases=setup(t);
 const invocation={repositoryId:123,nonce:'a'.repeat(32),sourceSha,workflowSha,route:'server',createdAt:Date.now(),runId:789,attempt:1,serverRunnerId:1001};
 leases.setInvocation(invocation);let cancelled=false;
 const api={get:async()=>({id:789,run_attempt:1,workflow_id:456,head_sha:workflowSha,event:'workflow_dispatch',display_title:'disposable-'+invocation.nonce,status:'in_progress'}),post:async()=>{cancelled=true;}};
 assert.deepEqual(await recoverCanary({api,leases,policy}),invocation);assert.equal(cancelled,false);
});
test('an unresolved dispatch retires after its existing readback budget without sending another request',async t=>{
 const {dispatchCanary}=await import('./ci-canary.mjs');const leases=setup(t);
 const invocation={repositoryId:123,nonce:'a'.repeat(32),sourceSha,workflowSha,route:'server',createdAt:Date.now()-120001,runId:null,attempt:null};leases.setInvocation(invocation);
 let posts=0;
 const api={get:async()=>({workflow_runs:[]}),post:async()=>{posts++;}};
 await assert.rejects(dispatchCanary({api,leases,policy,...invocation,wait:async()=>{throw new Error('Unexpected extra wait');}}),/ambiguous|unconfirmed/i);
 assert.equal(posts,0);assert.equal(leases.inspect().ciInvocation,undefined);
});
