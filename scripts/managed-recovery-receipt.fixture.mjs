export const venueA='12345678-1234-4234-8234-123456789abc';
export const venueB='22345678-1234-4234-8234-123456789abc';
export const installationA='32345678-1234-4234-8234-123456789abc';
const replacementA='42345678-1234-4234-8234-123456789abc';
const generationA='gen-2-52345678-1234-4234-8234-123456789abc-20260925T210000Z';
const generationB='gen-2-62345678-1234-4234-8234-123456789abc-20260925T210100Z';
const head='a'.repeat(64),otherHead='b'.repeat(64);

export function managedReceipt(){return {
 version:2,cloudHead:'a'.repeat(40),waitronHead:'b'.repeat(40),cloudDirty:false,waitronDirty:false,
 phases:['provider-isolation','streams-observed','continuous-recovery','interrupted-retry','snapshot-fallback','fresh-replacement'],
 venues:[
  {venueId:venueA,sourceHead:head,observedGeneration:generationA,recoverableAt:'2026-09-25T21:00:00.000Z',checkedAt:'2026-09-25T21:00:01.000Z'},
  {venueId:venueB,sourceHead:otherHead,observedGeneration:generationB,recoverableAt:'2026-09-25T21:01:00.000Z',checkedAt:'2026-09-25T21:01:01.000Z'},
 ],
 isolation:{crossVenueReadDenied:true,crossVenueWriteDenied:true,crossVenueListDenied:true,readerWriteDenied:true,otherVenueGenerationUnchanged:true},
 continuous:{venueId:venueA,sourceHead:head,restoredHead:head,approvedGeneration:generationA,restoredGeneration:generationA,recoverableAt:'2026-09-25T21:00:00.000Z',pointerWrittenAt:'2026-09-25T21:00:00.000Z',restoreMs:732,retry:{interrupted:true,cleanTarget:true,succeeded:true}},
 snapshotFallback:{venueId:venueB,pointId:'72345678-1234-4234-8234-123456789abc',continuousDeleted:true,restoreSucceeded:true,restoreMs:418},
 replacement:{venueId:venueA,oldInstallationId:installationA,newInstallationId:replacementA,elapsedMs:593,oldRecoveryKeyDigest:'c'.repeat(64),newRecoveryKeyDigest:'d'.repeat(64),oldAuthorityRefused:true,newAuthorityWorked:true,routePreserved:{staffHostname:true,publicHostname:true,address:true,port:true,neighbour:true},freshSnapshotPointId:'82345678-1234-4234-8234-123456789abc',freshSnapshotRestored:true},
 activation:'not-performed',checks:['real-seaweedfs','real-waitron','verifier-process-isolation','fresh-replacement-authority','no-production-resources'],
};}
