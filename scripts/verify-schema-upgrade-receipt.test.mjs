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

test('authenticator upgrade receipts require 34-to-35 state preservation and each restored-key check without relabelling history',async()=>{
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const valid={schemaVersion:2,measuredAt:'2026-10-13T08:00:00.000Z',driver:{head:'c'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:34,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:35,digest:'b'.repeat(64)}},checks:{oldStarted:true,newRefusedOld:true,migrationInterrupted:true,rollbackComplete:true,newRefusedInterrupted:true,retryApplied:true,oldRefusedNew:true,newStarted:true,identityPreserved:true,tenantsIsolated:true,completionRetry:true,pendingMailPreserved:true,mailDelivered:true,backupRestored:true,oldRecovered:true,wrongKeyRefused:true,upgradedUnchanged:true,accountStatePreserved:true,factorEnrolled:true,factorRestored:true,factorMatchingKey:true,factorWrongKeyRefused:true,factorMissingKeyRefused:true,factorBindingRefused:true},timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic local upgrade and logical backups only.']};
 assert.equal(verify(valid),valid);
 for(const key of Object.keys(valid.checks)){
  for(const change of [v=>delete v.checks[key],v=>v.checks[key]=false]){const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/,key);}
 }
 for(const change of [v=>v.schemaVersion=1,v=>v.releases.old.migrations=33,v=>v.releases.new.migrations=36,v=>v.checks.factorSecret='private',v=>v.cleanup.volumes=1]){
  const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/);
 }
});

test('relay stop receipts require every separate upgrade and recovery proof for exactly 35-to-36',async()=>{
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const valid={schemaVersion:3,measuredAt:'2026-10-13T08:00:00.000Z',driver:{head:'c'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:35,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:36,digest:'b'.repeat(64)}},checks:{oldStarted:true,newRefusedOld:true,migrationInterrupted:true,rollbackComplete:true,newRefusedInterrupted:true,retryApplied:true,oldRefusedNew:true,newStarted:true,identityPreserved:true,tenantsIsolated:true,completionRetry:true,pendingMailPreserved:true,mailDelivered:true,backupRestored:true,oldRecovered:true,wrongKeyRefused:true,upgradedUnchanged:true,accountStatePreserved:true,relayStatePreserved:true,defaultRunning:true,stopRestartPreserved:true,stopRestorePreserved:true,restoredRelayKeys:true,restoredRelayWrongKeysRefused:true,restoredRelayMissingKeysRefused:true,restoredStopEffective:true,oldBackupUpgradeDefault:true,resumeEffective:true},timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic local upgrade and two separate logical backups only.']};
 assert.equal(verify(valid),valid);
 for(const key of Object.keys(valid.checks))for(const change of [v=>delete v.checks[key],v=>v.checks[key]=false]){
  const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/,key);
 }
 for(const change of [v=>v.schemaVersion=2,v=>v.releases.old.migrations=34,v=>v.releases.new.migrations=37,v=>v.releases.new.head=v.releases.old.head,v=>v.releases.old.head='main',v=>v.checks.pairingUpgraded=true,v=>v.checks.secret='private',v=>v.cleanup.checkouts=1,v=>v.driver.secret='private',v=>delete v.checks]){
  const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/);
 }
});
test('monitoring receipt requires the separate 36-to-37 upgrade and both restored backups',async()=>{
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const names=['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged','accountStatePreserved','relayStatePreserved','legacyNoRetroactiveMail','deadlinesPreserved','recipientSnapshotPreserved','lateReceiptRecovery','newBackupRestored','restoredMatchingKeys','restoredWrongKeysRefused','restoredMissingKeysRefused','oldBackupUpgradeNoRetroactiveMail'];
 const valid={schemaVersion:4,measuredAt:'2026-10-13T18:00:00.000Z',driver:{head:'c'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:36,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:37,digest:'b'.repeat(64)}},checks:Object.fromEntries(names.map(name=>[name,true])),timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic local state and two separate backups.']};
 assert.equal(verify(valid),valid);
 for(const key of names)for(const change of [v=>delete v.checks[key],v=>v.checks[key]=false]){const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/,key);}
 for(const change of [v=>v.schemaVersion=3,v=>v.releases.old.migrations=35,v=>v.releases.new.migrations=38,v=>v.releases.new.head=v.releases.old.head,v=>v.releases.old.head='main',v=>v.checks.pairingUpgraded=true,v=>v.checks.secret='private',v=>v.cleanup.checkouts=1,v=>v.cleanup.containers=1,v=>v.cleanup.volumes=1,v=>v.driver.key='private']){const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/);}
});
test('backup verification receipt requires legacy refusal, preserved history and keys, current evidence and restored v2 binding',async()=>{
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const names=['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged','accountStatePreserved','relayStatePreserved','monitoringStatePreserved'];
 const backupNames=['legacyUnqualified','historyPreserved','keysPreserved','holdsPreserved','freshEvidence','v2Binding','oldBinaryRefused','restartIdempotent','oldSqlUnchanged','restoredEvidence','restoredHistory','restoredKeys','restoredHolds','restoredV2Binding','restoredLegacyUnqualified'];
 const valid={schemaVersion:5,measuredAt:'2026-10-22T04:00:00.000Z',driver:{head:'c'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:42,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:43,digest:'b'.repeat(64)}},checks:Object.fromEntries(names.map(name=>[name,true])),backupVerification:Object.fromEntries(backupNames.map(name=>[name,true])),timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic database state; no archive verification or fiscal authority.']};
 assert.equal(verify(valid),valid);
 for(const section of ['checks','backupVerification'])for(const key of Object.keys(valid[section]))for(const mode of ['missing','false','truthy']){
  const v=structuredClone(valid);if(mode==='missing')delete v[section][key];else v[section][key]=mode==='false'?false:'true';assert.throws(()=>verify(v),/schema_upgrade_receipt/,`${section}.${key} ${mode}`);
 }
 for(const change of [v=>delete v.backupVerification,v=>v.backupVerification.legacyPromoted=true,v=>v.backupVerification.privateKey='secret',v=>v.releases.new.migrations=42,v=>v.releases.old.migrations=41,v=>v.releases.new.migrations=44,v=>v.releases.new.digest=v.releases.old.digest,v=>v.schemaVersion=4]){const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/);}
});

test('billing receipt requires every independent upgrade and restore fact',async()=>{
 const {verifySchemaUpgradeReceipt:verify}=await import(path.href);
 const names=['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged','accountStatePreserved','relayStatePreserved','monitoringStatePreserved'];
 const billingNames=['oldSqlUnchanged','oldRowsPreserved','emptyBillingAfterUpgrade','restartIdempotent','billingRowsPreserved','pricesFrozen','eventRetryStable','eventCollisionRefused','foreignScopeRefused','newBackupRestored','restoredPayments','restoredTrials','restoredHostedDays','restoredEvents','restoredPrices','restoredRetryStable','oldBackupUpgradeEmpty'];
 const valid={schemaVersion:6,measuredAt:'2026-10-29T08:00:00.000Z',driver:{head:'b'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:44,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:45,digest:'b'.repeat(64)}},checks:Object.fromEntries(names.map(name=>[name,true])),billingStore:Object.fromEntries(billingNames.map(name=>[name,true])),timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic country billing; no provider, invoice or live recovery.']};
 assert.equal(verify(valid),valid);
 for(const section of ['checks','billingStore'])for(const key of Object.keys(valid[section]))for(const mode of ['missing','false','truthy']){
  const v=structuredClone(valid);if(mode==='missing')delete v[section][key];else v[section][key]=mode==='false'?false:'true';assert.throws(()=>verify(v),/schema_upgrade_receipt/,`${section}.${key} ${mode}`);
 }
 for(const change of [v=>delete v.billingStore,v=>v.billingStore.secret='private',v=>v.releases.new.migrations=44,v=>v.releases.old.migrations=43,v=>v.releases.new.migrations=46,v=>v.releases.new.digest=v.releases.old.digest,v=>v.releases.new.head=v.releases.old.head,v=>v.driver.head='c'.repeat(40),v=>v.driver.dirty=true,v=>v.cleanup.containers=1,v=>v.cleanup.volumes=1,v=>v.cleanup.checkouts=1,v=>v.schemaVersion=5,v=>v.extra=true,v=>v.checks.pairingUpgraded=true]){const v=structuredClone(valid);change(v);assert.throws(()=>verify(v),/schema_upgrade_receipt/);}
});
