import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('venue service guards detect all omissions',{timeout:360000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const controls=await exec(process.execPath,['--test','--test-reporter=tap','scripts/venue-service-guard-probes.test.mjs'],{cwd:root,env,timeout:60000,maxBuffer:2*1024*1024});
 for(const [field,count] of [['tests',21],['pass',21],['fail',0],['cancelled',0],['skipped',0],['todo',0]])assert.match(controls.stdout,new RegExp('^# '+field+' '+count+'$','m'));
 for(const [mode,names] of [
  ['pure',['translation level floor','exclusive trial end']],
  ['database',['composite venue binding','raw execute transition hook','stored grant expiry fence','venue before installation lock','downgrade setup clearing','cached response masking','post-wait proof recheck','private writer mode','post-provider generation','active route filter','incoming route filter','direct writer generation','retained expiry permission','new translation admission','post-wait provider permission']],
 ] as const){
  const result=await exec(process.execPath,['scripts/venue-service-guard-probes.mjs','--'+mode],{cwd:root,env,timeout:270000,maxBuffer:2*1024*1024});
  const receipt=JSON.parse(result.stdout);
  assert.deepEqual(receipt,{mode,results:names.map(guard=>({guard,baseline:1,detected:1,restored:1}))});
  console.log('VENUE_SERVICE_GUARDS '+JSON.stringify(receipt));
 }
});
