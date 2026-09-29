import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
const path=new URL('./verify-schema-upgrade-receipt.mjs',import.meta.url);
test('receipt rejects absent evidence, equal schemas, unpinned releases and leaked resources',async()=>{
 assert.ok(existsSync(path),'schema upgrade receipt verifier must exist');
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const valid={schemaVersion:1,measuredAt:'2026-09-29T14:00:00.000Z',driver:{head:'c'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:26,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:27,digest:'b'.repeat(64)}},checks:{oldStarted:true,newRefusedOld:true,migrationInterrupted:true,rollbackComplete:true,newRefusedInterrupted:true,retryApplied:true,pairingUpgraded:true,oldRefusedNew:true,newStarted:true,identityPreserved:true,tenantsIsolated:true,completionRetry:true,pendingMailPreserved:true,mailDelivered:true,backupRestored:true,oldRecovered:true,wrongKeyRefused:true,upgradedUnchanged:true},timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Only the pinned pair; stopped consumers, no online upgrade or downgrade.']};
 assert.equal(verify(valid),valid);
 for(const mutate of [v=>delete v.checks.oldRefusedNew,v=>v.releases.new={...v.releases.old},v=>v.driver.dirty=true,v=>v.releases.old.head='main',v=>v.cleanup.containers=1,v=>v.timings.upgradeMs=-1,v=>v.limitations=[],v=>v.password='private',v=>v.driver.key='private',v=>v.releases.old.secret='private',v=>v.checks.secret=true,v=>delete v.measuredAt]){
  const value=structuredClone(valid);mutate(value);assert.throws(()=>verify(value),/schema_upgrade_receipt/);
 }
 for(const key of Object.keys(valid.checks)){const value=structuredClone(valid);value.checks[key]=false;assert.throws(()=>verify(value),/schema_upgrade_receipt/,key);}
});
