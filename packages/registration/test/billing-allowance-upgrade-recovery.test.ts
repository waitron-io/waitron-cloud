import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {requireAllowanceSchema} from './fixtures/allowance-schema.ts';
const exec=promisify(execFile);

test('allowance release51 upgrade and recovery is qualified',{timeout:360000},async()=>{
 await requireAllowanceSchema();
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const fixture=await import(new URL('../../../scripts/schema-upgrade-allowance-fixture.mjs',import.meta.url).href);
 for(const name of ['seedAllowances','allowanceState','restoredAllowances'])assert.equal(typeof fixture[name],'function',name+' must qualify restored allowances');
 const scratch=await mkdtemp(join(tmpdir(),'allowance-upgrade-receipt-'));
 try{
  const release='ef230096fbc9073e4c20109dc214038491864966';
  const driver=join(scratch,'release51'),output=join(scratch,'receipt.json');
  await exec('git',['clone','--shared','--no-checkout',root,driver],{env});
  // The proof clones its driver again, so both pinned releases must stay reachable.
  await exec('git',['update-ref','refs/heads/receipt-old','1aae8f14c05113cc2a2c71337940ff7721ad5f5b'],{cwd:driver,env});
  await exec('git',['update-ref','refs/heads/receipt-new',release],{cwd:driver,env});
  await exec('git',['checkout','--detach',release],{cwd:driver,env});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:driver,env,timeout:180000,maxBuffer:4*1024*1024});
  await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,'--mail-reconciliation','--old','1aae8f14c05113cc2a2c71337940ff7721ad5f5b','--new',release],{cwd:driver,env,timeout:330000,maxBuffer:4*1024*1024});
  const value=JSON.parse(await readFile(output,'utf8'));
  const {verifySchemaUpgradeReceipt}=await import(new URL('../../../scripts/verify-schema-upgrade-receipt.mjs',import.meta.url).href);
  verifySchemaUpgradeReceipt(value);
  assert.equal(value.schemaVersion,12);assert.equal(value.driver.head,release);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'1aae8f14c05113cc2a2c71337940ff7721ad5f5b');assert.equal(value.releases.new.head,release);
  assert.equal(value.releases.old.migrations,47);assert.equal(value.releases.new.migrations,51);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','interruptedRollback','restartIdempotent','defaultOff','configRestored','reservationsRestored','spentNotReleased','trafficSourcesRestored','trafficLedgerRestored','trafficRetryStable','gapsRemainIncomplete','foreignScopeRefused','oldBackupUpgradeEmpty'])assert.equal(value.allowances[field],true,field);
  for(const field of ['emptyAfterUpgrade','oldBackupUpgradeEmpty','newBackupSchemaRestored'])assert.equal(value.sesFeedback[field],true,field);
  for(const field of ['unmappedLegacyPreserved','oldBackupUpgradeUnmapped','newBackupSchemaRestored'])assert.equal(value.mailHandoff[field],true,field);
  for(const field of ['emptyAfterUpgrade','oldBackupUpgradeEmpty','newBackupSchemaRestored'])assert.equal(value.mailReconciliation[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('ALLOWANCE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
