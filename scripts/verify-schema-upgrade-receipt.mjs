import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function verifySchemaUpgradeReceipt(value){
 const demand=(ok,field)=>{if(!ok)throw new Error(`schema_upgrade_receipt: ${field}`);};
 const exact=(object,keys)=>{demand(object&&typeof object==='object'&&!Array.isArray(object),'object');demand(JSON.stringify(Object.keys(object).sort())===JSON.stringify([...keys].sort()),'fields');};
 exact(value,['schemaVersion','driver','releases','checks','timings','cleanup','limitations','measuredAt',...(value?.schemaVersion===5?['backupVerification']:value?.schemaVersion===6?['billingStore']:value?.schemaVersion===7?['venueServices']:value?.schemaVersion===8?['allowances']:[])]);
 exact(value.driver,['head','dirty']);exact(value.releases,['old','new']);
 exact(value.timings,['upgradeMs','recoveryMs']);exact(value.cleanup,['containers','volumes','checkouts']);
 demand(typeof value.measuredAt==='string'&&Number.isFinite(Date.parse(value.measuredAt))&&new Date(value.measuredAt).toISOString()===value.measuredAt,'measuredAt');
 demand([1,2,3,4,5,6,7,8].includes(value?.schemaVersion),'version');
 const sha=/^[0-9a-f]{40}$/,digest=/^[0-9a-f]{64}$/;
 demand(sha.test(value.driver?.head)&&value.driver.dirty===false,'driver');
 for(const role of ['old','new']){const release=value.releases?.[role];exact(release,['head','migrations','digest']);demand(sha.test(release?.head)&&digest.test(release?.digest)&&Number.isInteger(release?.migrations)&&release.migrations>0,role);}
 demand(value.releases.old.head!==value.releases.new.head&&value.releases.old.digest!==value.releases.new.digest&&value.releases.old.migrations<value.releases.new.migrations,'distinct schemas');
 const checks=['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','pairingUpgraded','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged'];
 if(value.schemaVersion===2){
  demand(value.releases.old.migrations===34&&value.releases.new.migrations===35,'factor schemas');
  checks.splice(checks.indexOf('pairingUpgraded'),1);checks.push('accountStatePreserved','factorEnrolled','factorRestored','factorMatchingKey','factorWrongKeyRefused','factorMissingKeyRefused','factorBindingRefused');
 }
 if(value.schemaVersion===3){
  demand(value.releases.old.migrations===35&&value.releases.new.migrations===36,'relay stop schemas');
  checks.splice(checks.indexOf('pairingUpgraded'),1);
  checks.push('accountStatePreserved','relayStatePreserved','defaultRunning','stopRestartPreserved','stopRestorePreserved','restoredRelayKeys','restoredRelayWrongKeysRefused','restoredRelayMissingKeysRefused','restoredStopEffective','oldBackupUpgradeDefault','resumeEffective');
 }
 if(value.schemaVersion===4){
  demand(value.releases.old.migrations===36&&value.releases.new.migrations===37,'monitoring schemas');
  checks.splice(checks.indexOf('pairingUpgraded'),1);
  checks.push('accountStatePreserved','relayStatePreserved','legacyNoRetroactiveMail','deadlinesPreserved','recipientSnapshotPreserved','lateReceiptRecovery','newBackupRestored','restoredMatchingKeys','restoredWrongKeysRefused','restoredMissingKeysRefused','oldBackupUpgradeNoRetroactiveMail');
 }
 if(value.schemaVersion===5){
  demand(value.releases.old.migrations===42&&value.releases.new.migrations===43,'backup verification schemas');
  checks.splice(checks.indexOf('pairingUpgraded'),1);checks.push('accountStatePreserved','relayStatePreserved','monitoringStatePreserved');
  const backupChecks=['legacyUnqualified','historyPreserved','keysPreserved','holdsPreserved','freshEvidence','v2Binding','oldBinaryRefused','restartIdempotent','oldSqlUnchanged','restoredEvidence','restoredHistory','restoredKeys','restoredHolds','restoredV2Binding','restoredLegacyUnqualified'];
  exact(value.backupVerification,backupChecks);for(const key of backupChecks)demand(value.backupVerification[key]===true,key);
 }
 if(value.schemaVersion===6){
  demand(value.releases.old.migrations===44&&value.releases.new.migrations===45,'billing schemas');
  demand(value.driver.head===value.releases.new.head,'billing candidate');
  checks.splice(checks.indexOf('pairingUpgraded'),1);checks.push('accountStatePreserved','relayStatePreserved','monitoringStatePreserved');
  const billingChecks=['oldSqlUnchanged','oldRowsPreserved','emptyBillingAfterUpgrade','restartIdempotent','billingRowsPreserved','pricesFrozen','eventRetryStable','eventCollisionRefused','foreignScopeRefused','newBackupRestored','restoredPayments','restoredTrials','restoredHostedDays','restoredEvents','restoredPrices','restoredRetryStable','oldBackupUpgradeEmpty'];
  exact(value.billingStore,billingChecks);for(const key of billingChecks)demand(value.billingStore[key]===true,key);
 }
 if(value.schemaVersion===7){
  demand(value.releases.old.migrations===45&&value.releases.new.migrations===46,'venue service schemas');
  demand(value.driver.head===value.releases.new.head,'venue service candidate');
  checks.splice(checks.indexOf('pairingUpgraded'),1);checks.push('accountStatePreserved','relayStatePreserved','monitoringStatePreserved');
  const venueChecks=['oldSqlUnchanged','oldRowsPreserved','defaultOff','interruptedRollback','restartIdempotent','foreignScopeRefused','newBackupRestored','restoredAuthority','restoredTrials','restoredEvents','restoredKeysAndHolds','restoredRetryStable','staleWriterRefused','oldBackupUpgradeUnenrolled'];
  exact(value.venueServices,venueChecks);for(const key of venueChecks)demand(value.venueServices[key]===true,key);
 }
 if(value.schemaVersion===8){
  demand(value.releases.old.head==='9a75808dd17a86f2dc1e9b87614be4e55e81deb2'&&value.releases.old.migrations===46&&value.releases.new.migrations===47,'allowance schemas');
  demand(value.driver.head===value.releases.new.head,'allowance candidate');
  checks.splice(checks.indexOf('pairingUpgraded'),1);checks.push('accountStatePreserved','relayStatePreserved','monitoringStatePreserved');
  const allowanceChecks=['oldSqlUnchanged','oldRowsPreserved','interruptedRollback','restartIdempotent','defaultOff','configRestored','reservationsRestored','spentNotReleased','trafficSourcesRestored','trafficLedgerRestored','trafficRetryStable','gapsRemainIncomplete','foreignScopeRefused','oldBackupUpgradeEmpty'];
  exact(value.allowances,allowanceChecks);for(const key of allowanceChecks)demand(value.allowances[key]===true,key);
 }
 exact(value.checks,checks);for(const key of checks)demand(value.checks[key]===true,key);
 for(const key of ['upgradeMs','recoveryMs'])demand(Number.isFinite(value.timings?.[key])&&value.timings[key]>=0,key);
 for(const key of ['containers','volumes','checkouts'])demand(value.cleanup?.[key]===0,key);
 demand(Array.isArray(value.limitations)&&value.limitations.length>0&&value.limitations.every(item=>typeof item==='string'&&item.length>0),'limitations');
 return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){verifySchemaUpgradeReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));console.log('PASS schema upgrade receipt');}
