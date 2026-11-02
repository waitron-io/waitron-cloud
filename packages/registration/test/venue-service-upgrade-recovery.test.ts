import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// The original v7 test executes in its delivered tree, including all authority and key assertions.
test('venue service exact head upgrade and recovery is qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,pin='9a75808dd17a86f2dc1e9b87614be4e55e81deb2';
 const scratch=await mkdtemp(join(tmpdir(),'venue-service-historical-'));
 try{
  await exec('git',['archive','--output='+join(scratch,'release.tar'),pin],{cwd:root});
  await exec('tar',['-xf',join(scratch,'release.tar'),'-C',scratch]);await rm(join(scratch,'release.tar'));
  await exec('git',['init','-q'],{cwd:scratch});
  await exec('git',['fetch','--quiet',root,pin],{cwd:scratch});await exec('git',['reset','--hard',pin],{cwd:scratch});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:scratch,timeout:120000,maxBuffer:4*1024*1024});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const result=await exec(process.execPath,['--test','--test-reporter=tap','test/venue-service-upgrade-recovery.test.ts'],{cwd:join(scratch,'packages/registration'),env,timeout:330000,maxBuffer:8*1024*1024});
  const line=result.stdout.split('\n').find(line=>line.startsWith('# VENUE_SERVICE_UPGRADE_RECEIPT '));assert.ok(line,'the original historical proof must execute');
  const value=JSON.parse(line.slice('# VENUE_SERVICE_UPGRADE_RECEIPT '.length));
  assert.equal(value.schemaVersion,7);assert.equal(value.driver.head,pin);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'b338275c3ba4e2b211d7617b03d38e95b916ee7c');assert.equal(value.releases.new.head,pin);
  assert.equal(value.releases.old.migrations,45);assert.equal(value.releases.new.migrations,46);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','defaultOff','interruptedRollback','restartIdempotent','foreignScopeRefused','newBackupRestored','restoredAuthority','restoredTrials','restoredEvents','restoredKeysAndHolds','restoredRetryStable','staleWriterRefused','oldBackupUpgradeUnenrolled'])assert.equal(value.venueServices[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('VENUE_SERVICE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
