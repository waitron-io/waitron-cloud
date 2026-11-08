import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {LocalLeases} from './leases.mjs';
import {admitOrdinary,findAutomatic,fallbackOrdinary} from './ci-canary.mjs';

const sha='a'.repeat(40),workflow='reviewed server-first workflow';
const policy={repository:'fixture/waitron',repositoryId:123,workflowId:456,
 workflowPath:'.github/workflows/ci.yml',workflowDigest:createHash('sha256').update(workflow).digest('hex')};
function evidence(event,attempt,name='changes'){
 return {repository:{id:123,full_name:'fixture/waitron'},workflow,
  run:{id:789,run_attempt:attempt,repository:{id:123},head_repository:{id:123},head_sha:sha,
   workflow_id:456,path:policy.workflowPath,event,status:'queued',pull_requests:event==='pull_request'?[{number:12}]:[]},
  pull:{number:12,state:'open',head:{sha,repo:{id:123}},base:{repo:{id:123}}},
  source:{sha,commit:{tree:{sha:'b'.repeat(40)}}},
  job:{id:901,run_id:789,run_attempt:attempt,head_sha:sha,name,status:'queued',runner_id:null,
   labels:['self-hosted',`dt-123-789-${attempt}-${name}-1`]}};
}

for(const event of ['pull_request','push','schedule','workflow_dispatch']){
 for(const attempt of [1,2,7])test(`server admission accepts ${event} attempt ${attempt} routing before package selection`,()=>{
  const ci=admitOrdinary(policy,sha,evidence(event,attempt));
  assert.equal(ci.jobKey,'changes-1');assert.equal(ci.event,event);assert.equal(ci.attempt,attempt);
  assert.equal(ci.sourceSha,sha);assert.equal(ci.sourceTree,'b'.repeat(40));
 });
}
for(const name of ['ci','test-server-stream','test-server-merge','test-heavy-merge','test-fiscal-verifactu-merge',
 'test-till-merge','test-dashboard-merge','test-venue-service-merge','test-provisioning-merge','mutation-shared-aggregate','publish']){
 test(`server admission accepts the ${name} job`,()=>{
  assert.equal(admitOrdinary(policy,sha,evidence('push',2,name)).jobKey,name+'-1');
 });
}
test('server-first admission retains repository, attempt, source and changed-workflow refusals',()=>{
 for(const change of [e=>e.run.head_repository.id++,e=>e.run.repository.id++,e=>e.job.run_attempt++,
  e=>e.source.sha='c'.repeat(40),e=>e.workflow+='changed',e=>e.run.event='pull_request_target']){
  const value=evidence('push',2);change(value);assert.throws(()=>admitOrdinary(policy,sha,value));
 }
});
test('the reusable image smoke job keeps its actual GitHub name and a label without slashes',()=>{
 const f=evidence('push',2,'image / smoke');f.job.labels=['self-hosted','dt-123-789-2-image-smoke-1'];
 assert.equal(admitOrdinary(policy,sha,f).jobKey,'image-smoke-1');
});
test('automatic pickup accepts changed same-repository workflow bytes and binds their actual digest',async()=>{
 const f=evidence('push',1),candidate={...policy,candidateWorkflowDigest:policy.workflowDigest,workflowHistory:[{sha:'f'.repeat(40),digest:'f'.repeat(64)}]};
 let bytes=workflow;
 const api={get:async path=>{
  if(path.endsWith('/fork-pr-contributor-approval'))return {approval_policy:'all_external_contributors'};
  if(path.includes('/runs?'))return {total_count:path.includes('status=queued')?1:0,workflow_runs:path.includes('status=queued')?[f.run]:[]};
  if(path.endsWith('/runs/789'))return f.run;
  if(path.includes('/jobs?'))return {total_count:1,jobs:[f.job]};
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(bytes).toString('base64')};
  if(path.endsWith('/commits/'+sha))return f.source;
  if(path==='/repos/fixture/waitron')return f.repository;
  assert.fail('Automatic pickup must not ask for history pins: '+path);
 }};
 assert.deepEqual((await findAutomatic({api,policy:candidate,limit:1})).map(ci=>ci.jobId),[901]);
 bytes+='changed';
 const jobs=await findAutomatic({api,policy:candidate,limit:1});
 assert.deepEqual(jobs.map(ci=>ci.jobId),[901]);
 assert.equal(jobs[0].workflowDigest,createHash('sha256').update(bytes).digest('hex'));
});
for(const event of ['pull_request','push','schedule','workflow_dispatch'])test(`automatic pickup finds ${event} retry routing jobs`,async()=>{
 const f=evidence(event,2),execution='e'.repeat(40),paths=[];
 f.run.referenced_workflows=[{path:'fixture/waitron/.github/workflows/image-smoke.yml@'+execution,ref:'refs/pull/12/merge',sha:execution}];
 const api={get:async path=>{
  paths.push(path);
  if(path.endsWith('/fork-pr-contributor-approval'))return {approval_policy:'all_external_contributors'};
  if(path.includes('/runs?')){
   assert.equal(new URL('https://fixture.invalid'+path).searchParams.get('event'),null);
   return {total_count:path.includes('status=queued')?1:0,workflow_runs:path.includes('status=queued')?[f.run]:[]};
  }
  if(path.endsWith('/runs/789'))return f.run;
  if(path.includes('/jobs?')){assert.ok(path.includes('/attempts/2/'));return {total_count:1,jobs:[f.job]};}
  if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(workflow).toString('base64')};
  if(path.endsWith('/commits/'+sha))return f.source;
  if(path.endsWith('/pulls/12'))return f.pull;
  if(path==='/repos/fixture/waitron')return f.repository;
  assert.fail('Unexpected API path '+path);
 }};
 const jobs=await findAutomatic({api,policy,limit:1});
 assert.deepEqual(jobs.map(ci=>[ci.jobId,ci.jobKey,ci.attempt,ci.event]),[[901,'changes-1',2,event]]);
 assert.equal(paths.some(path=>path.includes('/pulls/')),event==='pull_request');
});
for(const event of ['pull_request','push','schedule','workflow_dispatch'])test(`automatic ${event} overflow marks only the exact next hosted attempt before cancellation`,async t=>{
 const root=mkdtempSync(tmpdir()+'/server-overflow-');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(root+'/ledger',{hostGeneration:'test',slots:1,bootstrap:true});
 const f=evidence(event,2),ci=admitOrdinary(policy,sha,f),actions=[];let cancelled=false,marker='{}';
 leases.setInvocation({nonce:'a'.repeat(32),sourceSha:sha,workflowSha:sha,route:'server',createdAt:Date.now(),runId:789,attempt:2,jobId:901,ordinaryStage:'admitted'});
 const api={get:async path=>{
  if(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:marker};
  if(path.endsWith('/pulls/12'))return f.pull;
  if(path.endsWith('/jobs/901'))return {...f.job,status:cancelled?'completed':'queued',conclusion:cancelled?'cancelled':null};
  if(path.endsWith('/runs/789'))return {...f.run,status:cancelled?'completed':'in_progress'};
  assert.fail('Unexpected API path '+path);
 },patch:async(path,body)=>{
  assert.ok(path.endsWith('/DISPOSABLE_TESTS_HOSTED_ATTEMPTS'));marker=body.value;actions.push('mark');
 },post:async path=>{
  assert.equal(marker,'{"789":3}');
  if(path.endsWith('/cancel')){cancelled=true;actions.push('cancel');}
  else{assert.ok(path.endsWith('/rerun'));actions.push('rerun');}
 }};
 const result=await fallbackOrdinary({api,policy,ci,leases,automatic:true});
 assert.equal(result.retry,true);assert.equal(result.previousAttempt,2);
 assert.deepEqual(actions,['mark','cancel','rerun']);
});
