import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),image=process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE;
test('authorised fixture recaptures verified data and prepares its exact ordinary restore',{skip:!image,timeout:120000},async t=>{
 const source=fileURLToPath(new URL('test-fixtures/snapshot-authorised-archive.test.ts',import.meta.url));
 const fixture=await readFile(source,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 assert(fixture.length>0,'authorised recapture fixture is missing');
 const docker=async args=>(await execute('docker',args,{timeout:100000,maxBuffer:2*1024*1024})).stdout.trim();
 assert.match(image,/^sha256:[a-f0-9]{64}$/);
 const [info]=JSON.parse(await docker(['image','inspect',image]));
 assert.equal(info.Id,image);assert.equal(info.Config.Labels['cloud.waitron-revision'],'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7');
 const id=await docker(['create','--network','none','--memory','4096m','--memory-swap','4096m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite-temp:rw,nosuid,nodev,size=16m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite:rw,nosuid,nodev,size=32m,mode=1777',
  '--mount',`type=bind,src=${source},dst=/waitron/apps/server/src/cloud-authorised-archive.test.ts,readonly`,'--workdir','/waitron/apps/server','--entrypoint','pnpm',image,'exec','vitest','run','src/cloud-authorised-archive.test.ts','--maxWorkers=1']);
 t.after(async()=>{await docker(['rm','-f','-v',id]);await assert.rejects(docker(['inspect',id]),error=>error.code===1&&error.stderr.toLowerCase().includes('no such object: '+id));});
 const output=await docker(['start','-a',id]);
 const matches=[...output.matchAll(/^.*CLOUD_AUTHORISED_ARCHIVE=(\{[^\n]+)$/gm)];assert.equal(matches.length,1,'one actual fixture result required');
 const result=JSON.parse(matches[0][1]);
 assert.equal(result.verification.status,'passed');assert.equal(result.verification.reason,'none');assert.equal(result.verification.activation,'not_attempted');
 assert.equal(result.verification.targetDigest,JSON.parse(await readFile(new URL('../backup-verifier/target.json',import.meta.url),'utf8')).digest);
 assert.deepEqual(result.verification.modules.map(m=>m.name).sort(),['adjustments','bookings','catalogue','core','credentials','fiscal-none','fiscal-verifactu','identity','media','payments','scheduler','staffing','venue-service','workforce','workforce-es']);
 assert(result.verification.modules.every(m=>m.status==='passed'&&m.checks.length>0));
 assert.deepEqual(result.ordinaryRestore,{exit:0,preparationBoundToRecapture:true,retiredCounters:[123,123,123],activeCounters:[1,1,1],allocations:2});
 assert.deepEqual(result.refusals,{wrongNodeKey:{exit:1,code:'promotion.break_glass_invalid',destinationPreserved:true},missingPreparation:{code:'sif.allocation_invalid',reason:'outside_confirmation_missing',destinationPreserved:true}});
});
