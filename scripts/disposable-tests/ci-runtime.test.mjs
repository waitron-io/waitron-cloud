import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalLeases} from './leases.mjs';
const ci={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',workflowSha:'1'.repeat(40),
 workflowDigest:'2'.repeat(64),event:'workflow_dispatch',sourceSha:'3'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
function fixture(t,{lost=false,uncertain=false}={}){
 const root=mkdtempSync(join(tmpdir(),'ci-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true}),events=[];
 let registered=false;
 const api={get:async path=>{if(path.endsWith('/runs/789'))return {id:789,run_attempt:1,workflow_id:456,head_sha:ci.workflowSha,status:'in_progress'};if(path.includes('runners'))return {total_count:registered?1:0,runners:registered?[{id:1001,name:'dt-123-789-1-901'}]:[]};
  return {id:901,run_id:789,run_attempt:1,head_sha:ci.workflowSha,status:registered?'completed':'queued',conclusion:registered?'success':null,runner_id:registered?1001:null,runner_name:registered?'dt-123-789-1-901':null};},
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
