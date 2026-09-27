import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const hash=/^[0-9a-f]{64}$/;
const commit=/^[0-9a-f]{40}$/;
const generation=/^gen-(0|[1-9][0-9]*)-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})-([0-9]{8}T[0-9]{6}Z)$/;
const requiredPhases=['provider-isolation','streams-observed','continuous-recovery','interrupted-retry','snapshot-fallback','fresh-replacement'];
const requiredChecks=['real-seaweedfs','real-waitron','verifier-process-isolation','fresh-replacement-authority','no-production-resources'];
function exact(value,keys){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function date(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function positive(value){return typeof value==='number'&&Number.isFinite(value)&&value>0;}
function fail(){throw new Error('managed recovery receipt is invalid');}

export function verifyManagedRecoveryReceipt(value){
 if(!exact(value,['version','cloudHead','waitronHead','cloudDirty','waitronDirty','phases','venues','isolation','continuous','snapshotFallback','boundaries','replacement','activation','checks'])||value.version!==3||!commit.test(value.cloudHead)||!commit.test(value.waitronHead)||typeof value.cloudDirty!=='boolean'||typeof value.waitronDirty!=='boolean'||JSON.stringify(value.phases)!==JSON.stringify(requiredPhases)||JSON.stringify(value.checks)!==JSON.stringify(requiredChecks)||value.activation!=='not-performed')fail();
 if(!Array.isArray(value.venues)||value.venues.length!==2)return fail();
 const venues=new Map();
 for(const venue of value.venues){
  if(!exact(venue,['venueId','sourceHead','observedGeneration','recoverableAt','checkedAt'])||!uuid.test(venue.venueId)||!hash.test(venue.sourceHead)||!generation.test(venue.observedGeneration)||!date(venue.recoverableAt)||!date(venue.checkedAt)||Date.parse(venue.checkedAt)<Date.parse(venue.recoverableAt)||venues.has(venue.venueId))fail();
  venues.set(venue.venueId,venue);
 }
 const isolation=value.isolation;
 if(!exact(isolation,['crossVenueReadDenied','crossVenueWriteDenied','crossVenueListDenied','readerWriteDenied','otherVenueGenerationUnchanged'])||Object.values(isolation).some(item=>item!==true))fail();
 const continuous=value.continuous;
 if(!exact(continuous,['venueId','sourceHead','restoredHead','approvedGeneration','restoredGeneration','recoverableAt','pointerWrittenAt','restoreMs','retry'])||!uuid.test(continuous.venueId)||!hash.test(continuous.sourceHead)||continuous.restoredHead!==continuous.sourceHead||!generation.test(continuous.approvedGeneration)||continuous.restoredGeneration!==continuous.approvedGeneration||!date(continuous.recoverableAt)||continuous.pointerWrittenAt!==continuous.recoverableAt||!positive(continuous.restoreMs)||!exact(continuous.retry,['interrupted','cleanTarget','succeeded'])||Object.values(continuous.retry).some(item=>item!==true))fail();
 const observed=venues.get(continuous.venueId);
 if(!observed||observed.sourceHead!==continuous.sourceHead||observed.observedGeneration!==continuous.approvedGeneration||observed.recoverableAt!==continuous.recoverableAt)fail();
 const fallback=value.snapshotFallback;
 if(!exact(fallback,['venueId','pointId','continuousDeleted','restoreSucceeded','restoreMs'])||!uuid.test(fallback.venueId)||!uuid.test(fallback.pointId)||fallback.continuousDeleted!==true||fallback.restoreSucceeded!==true||!positive(fallback.restoreMs)||fallback.venueId===continuous.venueId||!venues.has(fallback.venueId))fail();
 const boundaries=value.boundaries,managedKeys=boundaries?.managedKeys,restoredArchive=boundaries?.restoredArchive,nodeIdentity=boundaries?.nodeIdentity;
 if(!exact(boundaries,['managedKeys','restoredArchive','nodeIdentity'])||!exact(managedKeys,['snapshotKeyVersion','activeKeyVersion','restoredAfterRotation','recoveryKeyDistinctFromApplicationVault'])||!Number.isSafeInteger(managedKeys.snapshotKeyVersion)||managedKeys.snapshotKeyVersion<1||!Number.isSafeInteger(managedKeys.activeKeyVersion)||managedKeys.activeKeyVersion<=managedKeys.snapshotKeyVersion||managedKeys.restoredAfterRotation!==true||managedKeys.recoveryKeyDistinctFromApplicationVault!==true)fail();
 if(!exact(restoredArchive,['applicationVaultRestored','backupDestinationInherited','cloudAuthorityInherited','staffTlsInherited'])||restoredArchive.applicationVaultRestored!==true||restoredArchive.backupDestinationInherited!==false||restoredArchive.cloudAuthorityInherited!==false||restoredArchive.staffTlsInherited!==false)fail();
 if(!exact(nodeIdentity,['continuousSourceNodeId','continuousRestoredNodeId','snapshotSourceNodeId','snapshotRestoredNodeId','replacementInstallationFresh','replacementMachineAuthorityFresh'])||![nodeIdentity.continuousSourceNodeId,nodeIdentity.continuousRestoredNodeId,nodeIdentity.snapshotSourceNodeId,nodeIdentity.snapshotRestoredNodeId].every(item=>uuid.test(item))||nodeIdentity.continuousRestoredNodeId!==nodeIdentity.continuousSourceNodeId||nodeIdentity.snapshotRestoredNodeId!==nodeIdentity.snapshotSourceNodeId||nodeIdentity.replacementInstallationFresh!==true||nodeIdentity.replacementMachineAuthorityFresh!==true)fail();
 const replacement=value.replacement;
 if(!exact(replacement,['venueId','oldInstallationId','newInstallationId','elapsedMs','oldRecoveryKeyDigest','newRecoveryKeyDigest','oldAuthorityRefused','newAuthorityWorked','routePreserved','freshSnapshotPointId','freshSnapshotRestored'])||replacement.venueId!==continuous.venueId||!uuid.test(replacement.oldInstallationId)||!uuid.test(replacement.newInstallationId)||replacement.oldInstallationId===replacement.newInstallationId||!positive(replacement.elapsedMs)||!hash.test(replacement.oldRecoveryKeyDigest)||!hash.test(replacement.newRecoveryKeyDigest)||replacement.oldRecoveryKeyDigest===replacement.newRecoveryKeyDigest||replacement.oldAuthorityRefused!==true||replacement.newAuthorityWorked!==true||!exact(replacement.routePreserved,['staffHostname','publicHostname','address','port','neighbour'])||Object.values(replacement.routePreserved).some(item=>item!==true)||!uuid.test(replacement.freshSnapshotPointId)||replacement.freshSnapshotRestored!==true)fail();
 return value;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw new Error('usage: verify-managed-recovery-receipt.mjs RECEIPT.json');
 const receipt=verifyManagedRecoveryReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));
 console.log(`verified managed recovery receipt for ${receipt.continuous.venueId}`);
}
