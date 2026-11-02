import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// A skipped producer or a receipt borrowed from another candidate cannot qualify this release.
test('lifecycle exact head upgrade and both backup recoveries are qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const scratch=await mkdtemp(join(tmpdir(),'lifecycle-upgrade-receipt-'));
 try{
  const head=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),output=join(scratch,'receipt.json');
  await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,'--lifecycle','--old','1a3e43e885edfbe9932c835e3f4fb8929718b2dc','--new',head],{cwd:root,env,timeout:330000,maxBuffer:4*1024*1024});
  const value=JSON.parse(await readFile(output,'utf8'));
  assert.equal(value.schemaVersion,8);assert.equal(value.driver.head,head);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'1a3e43e885edfbe9932c835e3f4fb8929718b2dc');assert.equal(value.releases.new.head,head);
  assert.equal(value.releases.old.migrations,44);assert.equal(value.releases.new.migrations,47);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','emptyAfterUpgrade','interruptedRollback','restartIdempotent','pendingOperationsRestored','effectsRestored','fixedDeadlinesRestored','retryStable','changedInputRefused','staleWorkerRefused','uncertainRetryRefused','reconciliationPreserved','foreignEffectRefused','newBackupRestored','oldBackupUpgradeEmpty'])assert.equal(value.lifecycle[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('LIFECYCLE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
