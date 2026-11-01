import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openTestCaptureRuntime} from './service-runtime.mjs';
import {openTestRemoteRuntime} from './remote-runtime.mjs';
import {runTestBackupWorker} from './backup-worker.mjs';
import {runTestStorage} from './storage-worker.mjs';

for(const [role,run] of [
 ['capture',directory=>openTestCaptureRuntime({directory,mode:'test-venue-levels'})],
 ['remote',directory=>openTestRemoteRuntime({directory,mode:'test-venue-levels'})],
 ['storage',directory=>runTestStorage({directory,mode:'test-venue-levels'})],
])test(`venue ${role} startup requires valid private configuration before work`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-startup-'));
 try{
  await writeFile(join(directory,'runtime.json'),'{}',{mode:0o600});
  await assert.rejects(run(directory),/local_stack\.configuration_invalid/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('venue backup startup requires a separate verifier state directory before database work',async()=>{
 await assert.rejects(runTestBackupWorker({CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'test',DATABASE_URL:'postgres://127.0.0.1:1/fixture'},[]),/test_cloud\.backup_configuration/);
});
