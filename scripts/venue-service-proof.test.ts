import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {checkServiceReceipt} from './fixtures/service-proof.ts';

test('parallel runtime proof retains every selected case and rejects hidden omissions',()=>{
 const root=new URL('../',import.meta.url).pathname,env:NodeJS.ProcessEnv={...process.env,CLOUD_SERVICE_PROOF_CONCURRENCY:'2'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const result=spawnSync(process.execPath,['scripts/test-cloud-free-services.mjs','--venue-levels','--suite','runtime'],{cwd:root,env,encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{tests:38,passed:38,failed:0,cancelled:0,skipped:0,todo:0});
});
test('venue service receipt binds all nine suites to this candidate',{timeout:360000},async()=>{
 await checkServiceReceipt(true,new URL('../',import.meta.url).pathname);
});
