import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// The original v8 test runs in its delivered tree; later schemas have separate proofs.
test('lifecycle exact head upgrade and both backup recoveries are qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,pin='923379dbba124635082dcf414370429aff4d6e4a';
 const scratch=await mkdtemp(join(tmpdir(),'lifecycle-historical-'));
 try{
  await exec('git',['init','-q'],{cwd:scratch});
  await exec('git',['fetch','--quiet',root,pin],{cwd:scratch});await exec('git',['reset','--hard',pin],{cwd:scratch});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:scratch,timeout:120000,maxBuffer:4*1024*1024});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const result=await exec(process.execPath,['--test','--test-reporter=tap','test/data-lifecycle-upgrade-recovery.test.ts'],{cwd:join(scratch,'packages/registration'),env,timeout:330000,maxBuffer:8*1024*1024});
  const line=result.stdout.split('\n').find(line=>line.startsWith('# LIFECYCLE_UPGRADE_RECEIPT '));assert.ok(line,'the original historical proof must execute');
  const value=JSON.parse(line.slice('# LIFECYCLE_UPGRADE_RECEIPT '.length));
  assert.equal(value.schemaVersion,8);assert.equal(value.driver.head,pin);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'1a3e43e885edfbe9932c835e3f4fb8929718b2dc');assert.equal(value.releases.new.head,pin);
  assert.equal(value.releases.old.migrations,44);assert.equal(value.releases.new.migrations,47);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','emptyAfterUpgrade','interruptedRollback','restartIdempotent','pendingOperationsRestored','effectsRestored','fixedDeadlinesRestored','retryStable','changedInputRefused','staleWorkerRefused','uncertainRetryRefused','reconciliationPreserved','foreignEffectRefused','newBackupRestored','oldBackupUpgradeEmpty'])assert.equal(value.lifecycle[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('LIFECYCLE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
