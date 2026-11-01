import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {promisify} from 'node:util';

const exec=promisify(execFile);
test('parallel runtime proof retains every selected case and rejects hidden omissions',()=>{
 const root=new URL('../../../',import.meta.url).pathname,env:NodeJS.ProcessEnv={...process.env,CLOUD_SERVICE_PROOF_CONCURRENCY:'2'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const result=spawnSync(process.execPath,['scripts/test-cloud-free-services.mjs','--venue-levels','--suite','runtime'],{cwd:root,env,encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{tests:38,passed:38,failed:0,cancelled:0,skipped:0,todo:0});
});
test('venue service fixture proof retains legacy evidence and binds the nine new suites to this candidate',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,env:NodeJS.ProcessEnv={...process.env,CLOUD_SERVICE_PROOF_CONCURRENCY:'2'};delete env.NODE_TEST_CONTEXT;
 const git=async(...args:string[])=>(await exec('git',args,{cwd:root})).stdout.trim();
 const head=await git('rev-parse','HEAD'),tree=await git('rev-parse','HEAD^{tree}');
 for(const venueLevels of [false,true]){
  const started=performance.now(),pending=exec(process.execPath,['scripts/test-cloud-free-services.mjs',...(venueLevels?['--venue-levels']:[])],{cwd:root,env,timeout:170000,maxBuffer:1024*1024});
  let progress='';pending.child.stderr?.on('data',chunk=>{
   progress+=chunk.toString();const lines=progress.split('\n');progress=lines.pop()??'';
   for(const line of lines)if(/^Free-service proof: (account-mail|relay-plans|translation-plans|relay-guards|translation-guards|http-guards|deployment-gates|rules|installations|backups|recovery|remote|translation|relay|runtime|storage)$/.test(line))
    console.log(`SERVICE_PROOF_PROGRESS ${venueLevels?'venue':'legacy'} ${Math.round(performance.now()-started)}ms ${line}`);
  });
  const result=await pending;
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.version,venueLevels?2:1);assert.equal(receipt.kind,venueLevels?'test-cloud-venue-services':'test-cloud-free-services');
  assert.equal(receipt.cloudHead,head);assert.equal(receipt.cloudTree,tree);assert.equal(receipt.scope,'local-fixtures');
  if(venueLevels){
   assert.equal(receipt.mode,'test-venue-levels');assert.equal(receipt.productionEnforcement,'off');
   assert.deepEqual(receipt.suites.map((suite:{id:string})=>suite.id).sort(),['rules','installations','backups','recovery','remote','translation','relay','runtime','storage'].sort());
  }else{
   assert.equal(receipt.deployedTranslation,'off');assert.equal(receipt.waitronRelay,'not-qualified');assert.equal(receipt.waitronTranslation,'not-qualified');
   assert.deepEqual(receipt.suites.map((suite:{id:string})=>suite.id).sort(),['account-mail','relay-plans','translation-plans','relay-guards','translation-guards','http-guards','deployment-gates'].sort());
  }
  for(const suite of receipt.suites){
   assert.ok(Number.isSafeInteger(suite.tests)&&suite.tests>0);assert.equal(suite.passed,suite.tests);
   for(const field of ['failed','cancelled','skipped','todo'])assert.equal(suite[field],0);
  }
  console.log((venueLevels?'VENUE_SERVICE_RECEIPT ':'FREE_SERVICE_RECEIPT ')+JSON.stringify(receipt));
 }
 assert.equal(await git('rev-parse','HEAD'),head);assert.equal(await git('status','--porcelain'),'');
});
