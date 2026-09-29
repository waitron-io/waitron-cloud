import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function verifySchemaUpgradeReceipt(value){
 const demand=(ok,field)=>{if(!ok)throw new Error(`schema_upgrade_receipt: ${field}`);};
 demand(value?.schemaVersion===1,'version');
 const sha=/^[0-9a-f]{40}$/,digest=/^[0-9a-f]{64}$/;
 demand(sha.test(value.driver?.head)&&value.driver.dirty===false,'driver');
 for(const role of ['old','new']){const release=value.releases?.[role];demand(sha.test(release?.head)&&digest.test(release?.digest)&&Number.isInteger(release?.migrations)&&release.migrations>0,role);}
 demand(value.releases.old.head!==value.releases.new.head&&value.releases.old.digest!==value.releases.new.digest&&value.releases.old.migrations<value.releases.new.migrations,'distinct schemas');
 for(const key of ['oldStarted','newRefusedOld','migrationInterrupted','rollbackComplete','newRefusedInterrupted','retryApplied','pairingUpgraded','oldRefusedNew','newStarted','identityPreserved','tenantsIsolated','completionRetry','pendingMailPreserved','mailDelivered','backupRestored','oldRecovered','wrongKeyRefused','upgradedUnchanged'])demand(value.checks?.[key]===true,key);
 for(const key of ['upgradeMs','recoveryMs'])demand(Number.isFinite(value.timings?.[key])&&value.timings[key]>=0,key);
 for(const key of ['containers','volumes','checkouts'])demand(value.cleanup?.[key]===0,key);
 demand(Array.isArray(value.limitations)&&value.limitations.length>0&&value.limitations.every(item=>typeof item==='string'&&item.length>0),'limitations');
 return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){verifySchemaUpgradeReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));console.log('PASS schema upgrade receipt');}
