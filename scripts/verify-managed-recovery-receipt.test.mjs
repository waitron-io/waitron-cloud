import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyManagedRecoveryReceipt} from './verify-managed-recovery-receipt.mjs';
import {installationA,managedReceipt,venueA,venueB} from './managed-recovery-receipt.fixture.mjs';

test('accepts the complete measured version 2 receipt',()=>assert.deepEqual(verifyManagedRecoveryReceipt(managedReceipt()),managedReceipt()));
test('accepts dirty development evidence',()=>{const receipt=managedReceipt();receipt.cloudDirty=true;receipt.waitronDirty=true;assert.deepEqual(verifyManagedRecoveryReceipt(receipt),receipt);});
for(const [name,mutate] of [
 ['version 1 evidence',r=>{r.version=1;}],
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
