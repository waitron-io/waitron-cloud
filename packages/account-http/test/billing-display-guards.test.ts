import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {test} from 'node:test';
const exec=promisify(execFile),root=fileURLToPath(new URL('../../../',import.meta.url));

// An omission earns credit only through its named assertion with passing original and restored controls.
test('billing display guard qualification executes its harness and all five real omissions',{timeout:240000},async()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const harness=await exec(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','scripts/billing-display-guard-probes.test.mjs'],{cwd:root,env,timeout:60000,maxBuffer:2*1024*1024});
 assert.match(harness.stdout,/# tests 12\b/);assert.match(harness.stdout,/# pass 12\b/);
 for(const kind of ['fail','cancelled','skipped'])assert.match(harness.stdout,new RegExp('# '+kind+' 0\\b'));
 console.log('BILLING_DISPLAY_HARNESS_PASS 12');
 const expected={pure:['remaining accepted success','exact hosted day gaps'],database:['derived business scope after wait','final revocation after wait','trusted account destination']};
 for(const mode of ['pure','database'] as const){
  const output=await exec(process.execPath,['scripts/billing-display-guard-probes.mjs','--'+mode],{cwd:root,env,timeout:150000,maxBuffer:2*1024*1024});
  const result=JSON.parse(output.stdout);assert.equal(result.mode,mode);
  assert.deepEqual(result.results,expected[mode].map(guard=>({guard,baseline:1,detected:1,restored:1})));
  console.log('BILLING_DISPLAY_GUARDS '+JSON.stringify(result));
 }
});
