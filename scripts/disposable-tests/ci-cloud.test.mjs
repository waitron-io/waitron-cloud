import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {LocalLeases} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import * as control from './control.mjs';

const head='1'.repeat(40),workflow='reviewed Cloud workflow';
const policy={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex'),appEnv:'/fixture/cloud.env',appKey:'/fixture/key'};
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'cloud-ci-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');
 const config={version:2,mode:'manual-slots',slots:6,state,hostGeneration:'fixture',host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture',repository:root,ci:{...policy,repository:'fixture/waitron',repositoryId:999,appEnv:'/fixture/waitron.env'},cloudCi:policy};
 await withKernelLock(state,async()=>{new LocalLeases(state+'/ledger',{hostGeneration:'fixture',slots:6,bootstrap:true});return {code:0};},{bootstrap:true});
 for(let slot=0;slot<6;slot++)await withKernelLock(state+'/slot-'+slot,async()=>({code:0}),{bootstrap:true});
 const leases=new LocalLeases(state+'/ledger',{hostGeneration:'fixture',slots:6});
 const f={config,leases,mode:'hosted',selected:'',runs:[],jobs:new Map(),pulls:new Map(),writes:[],registered:false};
 f.add=(id=789,{labels=['self-hosted',`dt-123-${id}-1-typecheck`],status='queued',jobStatus='queued',attempt=1,prHead=head,prState='open',job=true}={})=>{
  const run={id,run_attempt:attempt,head_sha:head,repository:{id:123},head_repository:{id:123},workflow_id:456,path:policy.workflowPath,event:'pull_request',status,pull_requests:[{number:id}]};f.runs.push(run);
  f.jobs.set(id,job?[{id:id+112,name:'typecheck',run_id:id,run_attempt:1,head_sha:head,status:jobStatus,labels,runner_id:null}]:[]);
  f.pulls.set(id,{number:id,state:prState,head:{sha:prHead,repo:{id:123}},base:{repo:{id:123}}});return run;
 };
 f.api={get:async path=>{
  assert.ok(path.startsWith('/repos/fixture/cloud'),'Cloud must use its own App');
  if(path.endsWith('/DISPOSABLE_TESTS_MODE'))return {value:f.mode};
  if(path.endsWith('/DISPOSABLE_TESTS_HEAD'))return {value:f.selected};
  if(path.includes('/runs?'))return {total_count:f.runs.length,workflow_runs:f.runs};
  if(path.endsWith('/fork-pr-contributor-approval'))return {approval_policy:'all_external_contributors'};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(workflow).toString('base64')};
  if(path.includes('/commits/'))return {sha:head,commit:{tree:{sha:'4'.repeat(40)}}};
  if(path.includes('/pulls/'))return f.pulls.get(Number(path.split('/').at(-1)));
  if(path.includes('/attempts/1/jobs?')){const id=Number(path.match(/runs\/(\d+)/)[1]);const jobs=f.jobs.get(id);return {total_count:jobs.length,jobs};}
  if(path.includes('/actions/jobs/'))return [...f.jobs.values()].flat().find(j=>j.id===Number(path.split('/').at(-1)));
  if(path.includes('/actions/runs/'))return f.runs.find(r=>r.id===Number(path.split('/').at(-1)));
  if(path.includes('/actions/runners'))return {total_count:f.registered?1:0,runners:f.registered?[{id:1001,name:'dt-123-789-1-901'}]:[]};
  assert.equal(path,'/repos/fixture/cloud');return {id:123,full_name:'fixture/cloud'};
 },patch:async(path,body)=>{
  f.writes.push([path,body.value]);if(path.endsWith('/DISPOSABLE_TESTS_MODE')){
   if(body.value==='server')assert.ok(f.leases.inspect().slots.some(s=>s.ciInvocation?.ordinaryStage==='awaiting-run'),'Intent must precede server selection');f.mode=body.value;
  }else {assert.ok(path.endsWith('/DISPOSABLE_TESTS_HEAD'));f.selected=body.value;}
 },post:async(path,body)=>{
  f.writes.push([path,body]);
  if(path.endsWith('/generate-jitconfig')){f.registered=true;return {runner:{id:1001,name:'dt-123-789-1-901'},encoded_jit_config:'synthetic-jit'};}
  assert.equal(f.mode,'hosted','Restore routing before fallback');
  const id=Number(path.match(/runs\/(\d+)/)?.[1]);const run=f.runs.find(r=>r.id===id);
  if(path.endsWith('/cancel')){assert.equal(f.leases.inspect().slots.find(s=>s.ciInvocation)?.ciInvocation.ordinaryStage,'cancel-requested');run.status='completed';for(const job of f.jobs.get(id)){job.status='completed';job.conclusion='cancelled';}}
  else {assert.ok(path.endsWith('/rerun'));run.run_attempt=2;}
 },delete:async()=>{f.registered=false;}};
 f.transport={healthy:async()=>true,prepare:async()=>{},transfer:async()=>{},execute:async lease=>{
  const job=f.jobs.get(lease.ci.runId)[0];Object.assign(job,{status:'completed',conclusion:'success',runner_id:1001,runner_name:'dt-123-789-1-901'});return 0;
 },destroy:async()=>{},inspect:async lease=>({resourceId:lease.resourceId,absent:true})};
 f.scoped=slot=>new LocalLeases(state+'/ledger',{hostGeneration:'fixture',slots:6,slot});
 f.intent=(extras={})=>({repositoryId:123,nonce:'a'.repeat(32),sourceSha:head,workflowSha:head,route:'server',createdAt:Date.now()-900001,runId:null,attempt:null,ordinaryStage:'awaiting-run',afterRunId:0,...extras});
 return f;
}

test('Cloud owns a pool slot and records intent before opening its first ordinary PR',async t=>{
 assert.equal(typeof control.withCloudController,'function');const f=await fixture(t);let opened=false;
 const result=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>{
  assert.equal(f.mode,'server');assert.equal(f.selected,head);const record=f.leases.inspect().slots.find(s=>s.ciInvocation).ciInvocation;
  assert.equal(record.runId,null);assert.equal(record.repositoryId,123);assert.equal(record.afterRunId,0);f.add();opened=true;
 }});
 assert.equal(opened,true);assert.equal(result.code,0);assert.equal(result.ci.sourceTree,'4'.repeat(40));assert.equal(result.ci.jobId,901);
 assert.equal(f.mode,'hosted');assert.ok(f.leases.inspect().slots.every(s=>s.state==='free' && !s.ciInvocation));assert.equal(f.registered,false);
});

for(const occupied of ['full','cloud-intent','cloud-lease'])test(`Cloud admission refuses ${occupied} before changing routing`,async t=>{
 assert.equal(typeof control.withCloudController,'function');const f=await fixture(t);
 if(occupied==='cloud-intent')f.scoped(4).setInvocation(f.intent());
 else if(occupied==='full')for(let slot=0;slot<6;slot++)f.scoped(slot).reserveLocal({lane:'D',turn:'fixture-'+slot,snapshot:'b'.repeat(64),argv:['true']});
 else {const {ciRequest}=await import('./ci-identity.mjs');f.scoped(4).reserveLocal(ciRequest('I',{repositoryId:123,workflowId:456,workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceSha:head,workflowSha:head,sourceTree:'4'.repeat(40),runId:700,attempt:1,jobId:800,jobKey:'typecheck'}));}
 const result=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>assert.fail('Refused admission waited for a run')});assert.equal(result.code,75);assert.deepEqual(f.writes,[]);
});

test('a prior incomplete run refuses Cloud admission without intent or routing writes',async t=>{
 assert.equal(typeof control.withCloudController,'function');const f=await fixture(t);f.add(700,{job:false});
 assert.equal((await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>assert.fail('Earlier run was admitted')})).code,75);assert.deepEqual(f.writes,[]);assert.ok(f.leases.inspect().slots.every(s=>!s.ciInvocation));
});

test('two simultaneous Cloud callers cannot pass the unscoped fence on different slots',async t=>{
 assert.equal(typeof control.withCloudController,'function');const f=await fixture(t);let ready,finish;const entered=new Promise(r=>ready=r),held=new Promise(r=>finish=r);
 const first=control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>{ready();await held;f.add();}});
 await entered;try{const second=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>assert.fail('Second Cloud caller was admitted')});assert.equal(second.code,75);}
 finally{finish();await first;}
 assert.equal((await first).code,0);
});

for(const obsolete of ['closed','advanced','foreign-label','foreign-repository'])test(`Cloud drain handles ${obsolete} without taking unowned work`,async t=>{
 assert.equal(typeof control.drainCloud,'function');const f=await fixture(t);f.mode='server';f.selected=head;
 f.scoped(0).setInvocation(f.intent());
 const run=f.add(789,{prState:obsolete==='closed'?'closed':'open',prHead:obsolete==='advanced'?'5'.repeat(40):head,
  labels:obsolete==='foreign-label'?['self-hosted','foreign']:undefined});
 if(obsolete==='foreign-repository')run.head_repository.id=999;
 const result=await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}});
 assert.equal(f.mode,'hosted');assert.equal(result.code,0);assert.equal(f.scoped(0).inspect().ciInvocation,undefined);
 const posts=f.writes.filter(([path])=>path.endsWith('/cancel') || path.endsWith('/rerun')).map(([path])=>path);
 assert.deepEqual(posts,obsolete.startsWith('foreign')?[]:['/repos/fixture/cloud/actions/runs/789/cancel']);
});

test('Cloud recovery drains every extra run and retries unchanged open heads hosted',async t=>{
 assert.equal(typeof control.drainCloud,'function');const f=await fixture(t);f.scoped(0).setInvocation(f.intent());f.mode='server';f.add(789);f.add(790);
 const result=await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}});
 assert.equal(result.code,0);assert.equal(f.mode,'hosted');assert.equal(f.scoped(0).inspect().ciInvocation,undefined);
 assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/rerun')).map(([p])=>p),['/repos/fixture/cloud/actions/runs/789/rerun','/repos/fixture/cloud/actions/runs/790/rerun']);
});

test('a pre-run crash recovers after the caller budget and keeps intent for an unsettled planner',async t=>{
 assert.equal(typeof control.drainCloud,'function');const f=await fixture(t);const intent=f.intent();f.scoped(0).setInvocation(intent);f.mode='server';f.add(789,{job:false});
 const options={api:f.api,policy,leases:f.scoped(0),wait:async()=>{}};
 assert.equal((await control.drainCloud(options)).code,75);assert.equal(f.mode,'hosted');assert.equal(f.scoped(0).inspect().ciInvocation.createdAt,intent.createdAt);
 f.jobs.set(789,[{id:901,name:'typecheck',run_id:789,run_attempt:1,head_sha:head,status:'completed',conclusion:'skipped',labels:[],runner_id:null}]);
 assert.equal((await control.drainCloud(options)).code,0);assert.equal(f.scoped(0).inspect().ciInvocation,undefined);
});

test('a crashed cancellation preserves HEAD inventory and original age while later extras settle',async t=>{
 assert.equal(typeof control.drainCloud,'function');const f=await fixture(t),intent=f.intent();f.scoped(0).setInvocation(intent);f.mode='server';f.add();f.add(790);
 const post=f.api.post;let refuse=true;
 f.api.post=async(path,body)=>{if(path.endsWith('/cancel') && refuse){refuse=false;throw new Error('lost cancellation');}return post(path,body);};
 await assert.rejects(control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}}),/lost cancellation/);
 assert.equal(f.scoped(0).inspect().ciInvocation.afterRunId,0);assert.equal(f.scoped(0).inspect().ciInvocation.createdAt,intent.createdAt);
 assert.equal(f.scoped(0).inspect().ciInvocation.ordinaryStage,'cancel-requested');
 assert.equal((await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}})).code,0);
 assert.equal(f.scoped(0).inspect().ciInvocation,undefined);assert.equal(f.runs[1].run_attempt,2);
});

// Recovery must resolve the persisted repository before choosing an App or policy.
test('background recovery drains a Cloud pre-run intent with its own App and leaves Waitron live',async t=>{
 const {reconcileManual}=await import('./manual.mjs'),{GithubApp}=await import('./github-app.mjs');
 const f=await fixture(t);f.mode='server';f.scoped(0).setInvocation(f.intent());f.add(789,{prState:'closed'});
 f.scoped(4).reserveLocal({lane:'D',turn:'waitron-live',snapshot:'b'.repeat(64),argv:['true']});
 const originals={};for(const method of ['get','post','patch','delete']){originals[method]=GithubApp.prototype[method];GithubApp.prototype[method]=async function(...args){assert.equal(this.appEnv,'/fixture/cloud.env');return f.api[method](...args);};}
 t.after(()=>{for(const [method,fn] of Object.entries(originals))GithubApp.prototype[method]=fn;});
 const result=await reconcileManual({...f.config,slot:0,api:{get:async()=>assert.fail('Waitron App used for Cloud intent')},transport:{destroy:async()=>assert.fail('No Cloud guest remains')}});
 assert.equal(result.code,0);assert.equal(f.mode,'hosted');assert.equal(f.scoped(0).inspect().ciInvocation,undefined);assert.equal(f.scoped(4).inspect().slots[0].state,'reserved');
 assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/cancel')).map(([p])=>p),['/repos/fixture/cloud/actions/runs/789/cancel']);
});

test('background recovery refuses an unknown recorded repository before any API write',async t=>{
 const {reconcileManual}=await import('./manual.mjs');const f=await fixture(t);f.scoped(0).setInvocation(f.intent({repositoryId:777}));
 await assert.rejects(reconcileManual({...f.config,slot:0,api:f.api,transport:{}}),/repository.*policy|policy.*repository/i);
 assert.deepEqual(f.writes,[]);assert.equal(f.scoped(0).inspect().ciInvocation.repositoryId,777);
});

async function cloudCLI(t,f){
 const {GithubApp}=await import('./github-app.mjs'),originals={};
 for(const method of ['get','post','patch','delete']){originals[method]=GithubApp.prototype[method];GithubApp.prototype[method]=async function(...args){assert.equal(this.appEnv,'/fixture/cloud.env');return f.api[method](...args);};}
 t.after(()=>{for(const [method,fn] of Object.entries(originals))GithubApp.prototype[method]=fn;});
 const path=join(f.config.repository,'config.json');writeFileSync(path,JSON.stringify(f.config));return path;
}
test('Cloud hosted escape changes only Cloud even while another slot has Waitron work',async t=>{
 const f=await fixture(t);f.mode='server';f.scoped(4).setInvocation({...f.intent(),repositoryId:999});const path=await cloudCLI(t,f);
 const result=await control.main([path,'cloud','mode','hosted','--reason','fixture']);
 assert.equal(result.code,0);assert.equal(f.mode,'hosted');assert.equal(f.scoped(4).inspect().ciInvocation.repositoryId,999);
 assert.deepEqual(f.writes.map(([p])=>p),['/repos/fixture/cloud/actions/variables/DISPOSABLE_TESTS_MODE']);
});
for(const values of [['mode','server','--reason','fixture','--head',head],['status']])test(`Cloud ${values[0]} outside admission refuses before API access`,async t=>{
 const f=await fixture(t),path=await cloudCLI(t,f);f.api.get=async()=>assert.fail('Forbidden Cloud command reached API');
 await assert.rejects(control.main([path,'cloud',...values]),/Cloud.*run|Cloud.*hosted/i);assert.deepEqual(f.writes,[]);
});
test('Cloud CLI run admits before a new planner and restores hosted after skipped typecheck',async t=>{
 const f=await fixture(t),patch=f.api.patch;f.api.patch=async(path,body)=>{await patch(path,body);if(body.value==='server')f.add(789,{jobStatus:'completed'}),f.jobs.get(789)[0].conclusion='skipped';};
 const path=await cloudCLI(t,f),result=await control.main([path,'cloud','run','I',head]);
 assert.equal(result.code,0);assert.equal(result.reason,'typecheck-skipped');assert.equal(f.mode,'hosted');assert.ok(f.leases.inspect().slots.every(s=>!s.ciInvocation));
});

for(const phase of ['head-write','server-write','caller-stop','health','transfer','execute'])test(`Cloud restores hosted and drains its intent after ${phase}`,async t=>{
 const f=await fixture(t),stop=new AbortController(),patch=f.api.patch;
 if(phase.endsWith('write')){let fail=true;f.api.patch=async(path,body)=>{if(fail && path.endsWith(phase==='head-write'?'DISPOSABLE_TESTS_HEAD':'DISPOSABLE_TESTS_MODE')){fail=false;throw new Error('fixture write failure');}return patch(path,body);};}
 if(phase==='health')f.transport.healthy=async()=>false;
 if(phase==='transfer' || phase==='execute')f.transport[phase]=async()=>{throw new Error('fixture guest failure');};
 const result=await control.withCloudController({...f,approvedHead:head,lane:'I',signal:stop.signal,wait:async()=>{f.add();if(phase==='caller-stop')stop.abort();}});
 assert.equal(result.code,125);assert.equal(f.mode,'hosted');assert.ok(f.leases.inspect().slots.every(s=>s.state==='free' && !s.ciInvocation));assert.equal(f.registered,false);
 if(!phase.endsWith('write'))assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/rerun')).map(([p])=>p),['/repos/fixture/cloud/actions/runs/789/rerun']);
});


test('Cloud exit restores hosted even while Waitron recovery owns the shared controller lock',async t=>{
 const f=await fixture(t),stop=new AbortController();let locked,release;const ready=new Promise(r=>locked=r),gate=new Promise(r=>release=r);let busy;
 try{
  const result=await control.withCloudController({...f,approvedHead:head,lane:'I',signal:stop.signal,wait:async()=>{
   busy=withKernelLock(f.config.state,async()=>{locked();await gate;return {code:0};});await ready;stop.abort();
  }});
  assert.equal(result.code,75);assert.equal(result.cleanup,'pending');assert.equal(f.mode,'hosted');assert.equal(f.scoped(0).inspect().ciInvocation.ordinaryStage,'awaiting-run');
 }finally{release();await busy;}
 const before=f.writes.length;
 const refused=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>assert.fail('Deferred cleanup must fence admission')});
 assert.equal(refused.code,75);assert.equal(f.mode,'hosted');assert.equal(f.writes.length,before);
});

test('Cloud hosted escape does not wait for another repository controller lock',async t=>{
 const f=await fixture(t),path=await cloudCLI(t,f);f.mode='server';let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const busy=withKernelLock(f.config.state,async()=>{entered();await gate;return {code:0};});
 try{await ready;const result=await control.main([path,'cloud','mode','hosted','--reason','fixture']);assert.equal(result.code,0);assert.equal(f.mode,'hosted');}
 finally{release();await busy;}
});

for(const peer of ['intent','lease'])test(`Waitron hosted escape ignores a Cloud ${peer} and changes only its own variable`,async t=>{
 const f=await fixture(t);f.mode='server';
 if(peer==='intent')f.scoped(4).setInvocation(f.intent());else{const {ciRequest}=await import('./ci-identity.mjs');f.scoped(4).reserveLocal(ciRequest('I',{repositoryId:123,workflowId:456,workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceSha:head,workflowSha:head,sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'}));}
 const path=join(f.config.repository,'config.json');writeFileSync(path,JSON.stringify(f.config));const {GithubApp}=await import('./github-app.mjs'),get=GithubApp.prototype.get,patch=GithubApp.prototype.patch;let primary='server';
 t.after(()=>{GithubApp.prototype.get=get;GithubApp.prototype.patch=patch;});
 GithubApp.prototype.get=async function(path){assert.equal(this.appEnv,'/fixture/waitron.env');assert.equal(path,'/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_MODE');return {value:primary};};
 GithubApp.prototype.patch=async function(path,body){assert.equal(this.appEnv,'/fixture/waitron.env');assert.equal(path,'/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_MODE');primary=body.value;};
 const result=await control.main([path,'mode','hosted','--reason','fixture']);assert.equal(result.code,0);assert.equal(primary,'hosted');assert.equal(f.mode,'server');
});

for(const status of ['queued','in_progress','completed'])test(`Cloud ends caller waiting for a ${status} hosted typecheck without starting a guest`,async t=>{
 const f=await fixture(t);let waits=0;f.transport.healthy=async()=>assert.fail('Hosted job must not start a server guest');
 const result=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>{assert.equal(waits++,0,'Hosted label must end waiting');f.add(789,{labels:['ubuntu-latest'],jobStatus:status,status:status==='completed'?'completed':'in_progress'});if(status==='completed')f.jobs.get(789)[0].conclusion='success';}});
 assert.equal(result.code,0);assert.equal(result.route,'hosted');assert.equal(result.reason,'hosted-typecheck');assert.equal(f.mode,'hosted');assert.equal(f.scoped(0).inspect().ciInvocation,undefined);assert.equal(f.registered,false);
});

test('background Cloud recovery closes selection before deferring a busy shared cleanup lock',async t=>{
 const f=await fixture(t);f.mode='server';f.scoped(0).setInvocation(f.intent());await cloudCLI(t,f);const {reconcileManual}=await import('./manual.mjs');let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const busy=withKernelLock(f.config.state,async()=>{entered();await gate;return {code:0};});
 try{await ready;const result=await reconcileManual({...f.config,slot:0,transport:{}});assert.equal(result.code,75);assert.equal(f.mode,'hosted');assert.ok(f.scoped(0).inspect().ciInvocation);}
 finally{release();await busy;}
});

for(const status of ['queued','in_progress'])test(`recorded Cloud recovery preserves an assigned ${status} job on a closed PR`,async t=>{
 const f=await fixture(t);f.add(789,{prState:'closed',jobStatus:status});f.jobs.get(789)[0].runner_id=1001;
 f.scoped(0).setInvocation(f.intent({runId:789,attempt:1,jobId:901,label:'dt-123-789-1-typecheck',ordinaryStage:'admitted'}));
 const result=await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}});
 assert.equal(result.code,75);assert.ok(f.scoped(0).inspect().ciInvocation);assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/cancel')||p.endsWith('/rerun')),[]);
});

test('Cloud inventory recovery keeps an assigned job and its pending inventory untouched',async t=>{
 const f=await fixture(t);f.add(789,{status:'in_progress',jobStatus:'in_progress'});f.jobs.get(789)[0].runner_id=1001;f.scoped(0).setInvocation(f.intent());
 const result=await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}});
 assert.equal(result.code,75);assert.equal(f.scoped(0).inspect().ciInvocation.ordinaryStage,'awaiting-run');assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/cancel')||p.endsWith('/rerun')),[]);
});

for(const selection of ['mode','head'])test(`Cloud rechecks ${selection} after health before any guest work`,async t=>{
 const f=await fixture(t);let touched=false;f.transport.healthy=async()=>{if(selection==='mode')f.mode='hosted';else f.selected='5'.repeat(40);return true;};f.transport.transfer=async()=>{touched=true;};
 const result=await control.withCloudController({...f,approvedHead:head,lane:'I',wait:async()=>{f.add();}});
 assert.equal(result.code,125);assert.equal(touched,false);assert.equal(f.mode,'hosted');assert.equal(f.registered,false);
});

test('Cloud drain never reads historical job inventories at or before its admission marker',async t=>{
 const f=await fixture(t),run=f.add(700,{status:'completed',jobStatus:'completed'});run.conclusion='success';f.jobs.get(700)[0].conclusion='success';f.scoped(0).setInvocation(f.intent({afterRunId:700}));const get=f.api.get;
 f.api.get=async(path,...args)=>{assert.ok(!path.includes('/runs/700/attempts/'),'Historical inventory must not be read');return get(path,...args);};
 assert.equal((await control.drainCloud({api:f.api,policy,leases:f.scoped(0),wait:async()=>{}})).code,0);assert.equal(f.scoped(0).inspect().ciInvocation,undefined);assert.deepEqual(f.writes.filter(([p])=>p.endsWith('/cancel')||p.endsWith('/rerun')),[]);
});

test('background recovery resolves every orphan policy before deleting any known runner',async t=>{
 const f=await fixture(t),{ciRequest}=await import('./ci-identity.mjs'),{reconcileManual}=await import('./manual.mjs');
 for(const [repositoryId,jobId] of [[123,901],[777,902]]){const lease=f.scoped(0).reserveLocal(ciRequest('I',{repositoryId,workflowId:456,workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceSha:head,workflowSha:head,sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId,jobKey:'typecheck'})).lease;f.scoped(0).release(lease,{resourceId:lease.resourceId,absent:true});}
 f.registered=true;await cloudCLI(t,f);
 await assert.rejects(reconcileManual({...f.config,slot:0,transport:{}}),/repository.*policy|policy.*repository/i);
 assert.equal(f.registered,true);assert.equal(f.scoped(0).inspect().orphanRunners.length,2);assert.deepEqual(f.writes,[]);
});


for(const owner of ['waitron','manual','unknown'])test(`Waitron hosted escape retains its refusal for ${owner} work`,async t=>{
 const f=await fixture(t),slot=f.scoped(4);
 if(owner==='manual')slot.reserveLocal({lane:'D',turn:'manual-busy',snapshot:'b'.repeat(64),argv:['true']});
 else{const {ciRequest}=await import('./ci-identity.mjs');slot.reserveLocal(ciRequest('I',{repositoryId:owner==='waitron'?999:777,workflowId:456,workflowPath:policy.workflowPath,workflowDigest:policy.workflowDigest,event:'pull_request',sourceSha:head,workflowSha:head,sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'}));}
 const path=join(f.config.repository,'config.json');writeFileSync(path,JSON.stringify(f.config));
 const {GithubApp}=await import('./github-app.mjs'),get=GithubApp.prototype.get;t.after(()=>{GithubApp.prototype.get=get;});GithubApp.prototype.get=async()=>assert.fail('Occupied selection must refuse before API access');
 await assert.rejects(control.main([path,'mode','hosted','--reason','fixture']),/CI work must finish/);assert.deepEqual(f.writes,[]);
});
