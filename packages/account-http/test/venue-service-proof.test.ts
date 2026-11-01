import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {test} from 'node:test';
import {promisify} from 'node:util';

const exec=promisify(execFile);
test('venue service fixture proof retains legacy evidence and binds the nine new suites to this candidate',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;
 const git=async(...args:string[])=>(await exec('git',args,{cwd:root})).stdout.trim();
 const head=await git('rev-parse','HEAD'),tree=await git('rev-parse','HEAD^{tree}');
 for(const venueLevels of [false,true]){
  const result=await exec(process.execPath,['scripts/test-cloud-free-services.mjs',...(venueLevels?['--venue-levels']:[])],{cwd:root,env,timeout:170000,maxBuffer:1024*1024});
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
