import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyManagedRecoveryReceipt} from './verify-managed-recovery-receipt.mjs';
import {installationA,managedReceipt,venueA,venueB} from './managed-recovery-receipt.fixture.mjs';

test('accepts the complete measured version 3 receipt with explicit secret and identity boundaries',()=>assert.deepEqual(verifyManagedRecoveryReceipt(managedReceipt()),managedReceipt()));
test('accepts dirty development evidence',()=>{const receipt=managedReceipt();receipt.cloudDirty=true;receipt.waitronDirty=true;assert.deepEqual(verifyManagedRecoveryReceipt(receipt),receipt);});
for(const [name,mutate] of [
 ['version 2 evidence without explicit boundaries',r=>{r.version=2;delete r.boundaries;}],
 ['missing phase',r=>r.phases.pop()],
 ['mismatched database heads',r=>{r.continuous.restoredHead='c'.repeat(64);}],
 ['invented recovery time',r=>{r.continuous.recoverableAt='2026-09-25T21:00:02.000Z';}],
 ['recovery time absent from the signed pointer',r=>{r.continuous.pointerWrittenAt='2026-09-25T21:00:02.000Z';}],
 ['retrograde observation',r=>{r.venues[0].checkedAt='2026-09-25T20:59:59.000Z';}],
 ['cross-venue access success',r=>{r.isolation.crossVenueReadDenied=false;}],
 ['snapshot fallback from the continuous venue',r=>{r.snapshotFallback.venueId=venueA;}],
 ['absent retry evidence',r=>{r.continuous.retry.interrupted=false;}],
 ['zero continuous restore timing',r=>{r.continuous.restoreMs=0;}],
 ['zero snapshot restore timing',r=>{r.snapshotFallback.restoreMs=0;}],
 ['snapshot key not older than the active key',r=>{r.boundaries.managedKeys.activeKeyVersion=r.boundaries.managedKeys.snapshotKeyVersion;}],
 ['snapshot not restored after rotation',r=>{r.boundaries.managedKeys.restoredAfterRotation=false;}],
 ['recovery key confused with the application vault',r=>{r.boundaries.managedKeys.recoveryKeyDistinctFromApplicationVault=false;}],
 ['application vault missing after archive restore',r=>{r.boundaries.restoredArchive.applicationVaultRestored=false;}],
 ['backup destination inherited',r=>{r.boundaries.restoredArchive.backupDestinationInherited=true;}],
 ['Cloud machine authority inherited',r=>{r.boundaries.restoredArchive.cloudAuthorityInherited=true;}],
 ['staff TLS inherited',r=>{r.boundaries.restoredArchive.staffTlsInherited=true;}],
 ['continuous restore changed the local node',r=>{r.boundaries.nodeIdentity.continuousRestoredNodeId='72345678-1234-4234-8234-123456789abc';}],
 ['snapshot restore changed the local node',r=>{r.boundaries.nodeIdentity.snapshotRestoredNodeId='72345678-1234-4234-8234-123456789abc';}],
 ['replacement reused the Cloud installation',r=>{r.boundaries.nodeIdentity.replacementInstallationFresh=false;}],
 ['replacement reused machine authority',r=>{r.boundaries.nodeIdentity.replacementMachineAuthorityFresh=false;}],
 ['replacement for another venue',r=>{r.replacement.venueId=venueB;}],
 ['same replacement installation',r=>{r.replacement.newInstallationId=r.replacement.oldInstallationId;}],
 ['zero replacement timing',r=>{r.replacement.elapsedMs=0;}],
 ['reused recovery key',r=>{r.replacement.newRecoveryKeyDigest=r.replacement.oldRecoveryKeyDigest;}],
 ['old authority still live',r=>{r.replacement.oldAuthorityRefused=false;}],
 ['new authority did not work',r=>{r.replacement.newAuthorityWorked=false;}],
 ['changed customer-facing route',r=>{r.replacement.routePreserved.staffHostname=false;}],
 ['unexpected route field',r=>{r.replacement.routePreserved.extra=true;}],
 ['invalid fresh snapshot point',r=>{r.replacement.freshSnapshotPointId='not-a-uuid';}],
 ['fresh snapshot did not restore',r=>{r.replacement.freshSnapshotRestored=false;}],
 ['absent verifier isolation evidence',r=>{r.checks.splice(2,1);}],
 ['activation claim',r=>{r.activation='performed';}],
] )test(`rejects ${name}`,()=>{const changed=managedReceipt();mutate(changed);assert.throws(()=>verifyManagedRecoveryReceipt(changed));});
