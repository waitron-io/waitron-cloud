import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {requireAllowanceSchema} from './fixtures/allowance-schema.ts';
const exec=promisify(execFile);

test('allowance exact head upgrade and recovery is qualified',{timeout:360000},async()=>{
 await requireAllowanceSchema();
 const root=new URL('../../../',import.meta.url).pathname,env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const fixture=await import(new URL('../../../scripts/schema-upgrade-allowance-fixture.mjs',import.meta.url).href);
 for(const name of ['seedAllowances','allowanceState','restoredAllowances'])assert.equal(typeof fixture[name],'function',name+' must qualify restored allowances');
 const scratch=await mkdtemp(join(tmpdir(),'allowance-upgrade-receipt-'));
 try{
  const head=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),output=join(scratch,'receipt.json');
  await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,'--allowances','--old','9a75808dd17a86f2dc1e9b87614be4e55e81deb2','--new',head],{cwd:root,env,timeout:330000,maxBuffer:4*1024*1024});
  const value=JSON.parse(await readFile(output,'utf8'));
  const {verifySchemaUpgradeReceipt}=await import(new URL('../../../scripts/verify-schema-upgrade-receipt.mjs',import.meta.url).href);
  verifySchemaUpgradeReceipt(value);
  assert.equal(value.schemaVersion,8);assert.equal(value.driver.head,head);assert.equal(value.driver.dirty,false);
  assert.equal(value.releases.old.head,'9a75808dd17a86f2dc1e9b87614be4e55e81deb2');assert.equal(value.releases.new.head,head);
  assert.equal(value.releases.old.migrations,46);assert.equal(value.releases.new.migrations,47);
  for(const field of ['oldSqlUnchanged','oldRowsPreserved','interruptedRollback','restartIdempotent','defaultOff','configRestored','reservationsRestored','spentNotReleased','trafficSourcesRestored','trafficLedgerRestored','trafficRetryStable','gapsRemainIncomplete','foreignScopeRefused','oldBackupUpgradeEmpty'])assert.equal(value.allowances[field],true,field);
  assert.deepEqual(value.cleanup,{containers:0,volumes:0,checkouts:0});
  console.log('ALLOWANCE_UPGRADE_RECEIPT '+JSON.stringify(value));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
