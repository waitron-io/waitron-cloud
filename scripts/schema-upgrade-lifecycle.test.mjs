import assert from 'node:assert/strict';
import {test} from 'node:test';
import {upgradeRevisions} from './schema-upgrade-fixture.mjs';
import {verifySchemaUpgradeReceipt as verify} from './verify-schema-upgrade-receipt.mjs';

const checks=['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged','accountStatePreserved','relayStatePreserved','monitoringStatePreserved'];
const journal=['oldSqlUnchanged','oldRowsPreserved','emptyAfterUpgrade','interruptedRollback','restartIdempotent','pendingOperationsRestored','effectsRestored','fixedDeadlinesRestored','retryStable','changedInputRefused','staleWorkerRefused','uncertainRetryRefused','reconciliationPreserved','foreignEffectRefused','newBackupRestored','oldBackupUpgradeEmpty'];
function receipt(){return {schemaVersion:8,measuredAt:'2026-11-02T12:00:00.000Z',driver:{head:'b'.repeat(40),dirty:false},releases:{old:{head:'a'.repeat(40),migrations:44,digest:'a'.repeat(64)},new:{head:'b'.repeat(40),migrations:47,digest:'b'.repeat(64)}},checks:Object.fromEntries(checks.map(name=>[name,true])),lifecycle:Object.fromEntries(journal.map(name=>[name,true])),timings:{upgradeMs:1,recoveryMs:2},cleanup:{containers:0,volumes:0,checkouts:0},limitations:['Synthetic disabled lifecycle journal, two separate logical backups; no outside effects.']};}
// Removing a required fact or accepting another candidate must invalidate publication.
test('lifecycle receipts bind the exact 44-to-47 candidate and every independent recovery fact',()=>{
 const valid=receipt();assert.equal(verify(valid),valid);
 for(const section of ['checks','lifecycle'])for(const key of Object.keys(valid[section]))for(const value of [undefined,false,'true',1,null]){
  const changed=structuredClone(valid);if(value===undefined)delete changed[section][key];else changed[section][key]=value;
  assert.throws(()=>verify(changed),/schema_upgrade_receipt/,`${section}.${key}: ${value}`);
 }
 for(const mutate of [v=>delete v.lifecycle,v=>v.lifecycle.extra=true,v=>v.checks.extra=true,v=>v.extra=true,v=>v.driver.dirty=true,v=>v.driver.head='c'.repeat(40),v=>v.releases.old.head=v.releases.new.head,v=>v.releases.old.digest=v.releases.new.digest,v=>v.releases.old.migrations=45,v=>v.releases.new.migrations=46,v=>v.releases.new.migrations=48,v=>v.releases.new.head='HEAD',v=>v.cleanup.containers=1,v=>v.cleanup.volumes=1,v=>v.cleanup.checkouts=1,v=>v.schemaVersion=7]){
  const changed=structuredClone(valid);mutate(changed);assert.throws(()=>verify(changed),/schema_upgrade_receipt/);
 }
});
test('lifecycle upgrades require their own complete distinct pinned pair',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,lifecycle:true};
 assert.deepEqual(upgradeRevisions(['--lifecycle',...pair]),want);
 assert.deepEqual(upgradeRevisions([...pair,'--lifecycle']),want);
 for(const args of [['--lifecycle'],['--lifecycle','--old','main','--new','b'.repeat(40)],['--lifecycle','--old','a'.repeat(40),'--new','a'.repeat(40)],['--lifecycle',...pair,'--lifecycle'],...['--billing','--backup-verification','--monitoring-quiet','--relay-stop','--venue-services'].flatMap(mode=>[[mode,'--lifecycle',...pair],['--lifecycle',mode,...pair]])])assert.throws(()=>upgradeRevisions(args),/revisions/);
});
test('lifecycle recovery fixture exposes executed state and reconciliation checks',async()=>{
 const fixture=await import('./schema-upgrade-lifecycle-fixture.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 for(const key of ['seedLifecycle','lifecycleState','restoredLifecycle','emptyLifecycle'])assert.equal(typeof fixture[key],'function',key+' must execute the real journal');
});
