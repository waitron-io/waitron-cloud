import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {requireAllowanceSchema} from './fixtures/allowance-schema.ts';
const exec=promisify(execFile);

test('allowance guards detect independent omissions',{timeout:240000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const controls=await exec(process.execPath,['--test','--test-reporter=tap','scripts/allowance-traffic-guard-probes.test.mjs'],{cwd:root,env,timeout:60000,maxBuffer:4*1024*1024});
 assert.match(controls.stdout,/# tests 21\b/);assert.match(controls.stdout,/# pass 21\b/);
 for(const field of ['fail','cancelled','skipped','todo'])assert.match(controls.stdout,new RegExp('^# '+field+' 0$','m'));
 await requireAllowanceSchema();
 const result=await exec(process.execPath,['scripts/allowance-traffic-guard-probes.mjs','--database'],{cwd:root,env,timeout:170000,maxBuffer:4*1024*1024});
 const value=JSON.parse(result.stdout);assert.equal(value.mode,'database');
 assert.deepEqual(value.results.map((item:{guard:string})=>item.guard),[
  'account bucket serialization','composite account ownership','original reservation replay','never attempted release',
  'independent money cap','current job lease','traffic signature','final reporter binding',
  'traffic sequence replay','operational backend exclusion','counter decrease overflow','complete trial coverage',
  'confirmed attempt distinction','exact consent actor',
 ]);
 for(const item of value.results)assert.deepEqual(item,{guard:item.guard,baseline:1,detected:1,restored:1});
 console.log('ALLOWANCE_GUARD_RECEIPT '+JSON.stringify(value));
});
