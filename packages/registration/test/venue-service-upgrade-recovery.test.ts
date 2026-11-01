import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('venue service exact head upgrade and recovery is qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const fixturePath=new URL('../../../scripts/schema-upgrade-venue-service-fixture.mjs',import.meta.url).href;
 const fixture=await import(fixturePath).catch((error:NodeJS.ErrnoException)=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
 });
 for(const name of ['seedVenueServiceAuthority','venueServiceAuthorityState','restoredVenueServiceAuthority'])assert.equal(typeof fixture[name],'function',name+' must qualify restored authority');
 const scratch=await mkdtemp(join(tmpdir(),'venue-upgrade-receipt-'));
 try{
  const head=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  const output=join(scratch,'receipt.json');
  await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,'--venue-services','--old','b338275c3ba4e2b211d7617b03d38e95b916ee7c','--new',head],{cwd:root,env,timeout:330000,maxBuffer:4*1024*1024});
  const value=JSON.parse(await readFile(output,'utf8'));
  assert.equal(value.schemaVersion,7);assert.equal(value.driver.head,head);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'b338275c3ba4e2b211d7617b03d38e95b916ee7c');assert.equal(value.releases.new.head,head);
  assert.equal(value.releases.old.migrations,45);assert.equal(value.releases.new.migrations,46);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','defaultOff','interruptedRollback','restartIdempotent','foreignScopeRefused','newBackupRestored','restoredAuthority','restoredTrials','restoredEvents','restoredKeysAndHolds','restoredRetryStable','staleWriterRefused','oldBackupUpgradeUnenrolled'])assert.equal(value.venueServices[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('VENUE_SERVICE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
