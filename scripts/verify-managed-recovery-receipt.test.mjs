import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyManagedRecoveryReceipt} from './verify-managed-recovery-receipt.mjs';

const venueA='12345678-1234-4234-8234-123456789abc',venueB='22345678-1234-4234-8234-123456789abc';
const generationA='gen-2-32345678-1234-4234-8234-123456789abc-20260925T210000Z',generationB='gen-2-42345678-1234-4234-8234-123456789abc-20260925T210100Z';
const head='a'.repeat(64),otherHead='b'.repeat(64);
function receipt(){return {
 version:1,cloudHead:'a'.repeat(40),waitronHead:'b'.repeat(40),cloudDirty:true,waitronDirty:false,
 phases:['provider-isolation','streams-observed','continuous-recovery','interrupted-retry','snapshot-fallback'],
 venues:[
  {venueId:venueA,sourceHead:head,observedGeneration:generationA,recoverableAt:'2026-09-25T21:00:00.000Z',checkedAt:'2026-09-25T21:00:01.000Z'},
  {venueId:venueB,sourceHead:otherHead,observedGeneration:generationB,recoverableAt:'2026-09-25T21:01:00.000Z',checkedAt:'2026-09-25T21:01:01.000Z'},
 ],
 isolation:{crossVenueReadDenied:true,crossVenueWriteDenied:true,crossVenueListDenied:true,readerWriteDenied:true,otherVenueGenerationUnchanged:true},
 continuous:{venueId:venueA,sourceHead:head,restoredHead:head,approvedGeneration:generationA,restoredGeneration:generationA,recoverableAt:'2026-09-25T21:00:00.000Z',pointerWrittenAt:'2026-09-25T21:00:00.000Z',retry:{interrupted:true,cleanTarget:true,succeeded:true}},
 snapshotFallback:{venueId:venueB,pointId:'52345678-1234-4234-8234-123456789abc',continuousDeleted:true,restoreSucceeded:true},
 activation:'not-performed',checks:['real-seaweedfs','real-waitron','no-production-resources'],
};}

test('accepts the complete measured receipt',()=>assert.deepEqual(verifyManagedRecoveryReceipt(receipt()),receipt()));
for(const [name,mutate] of [
 ['missing phase',r=>r.phases.pop()],
 ['mismatched database heads',r=>{r.continuous.restoredHead='c'.repeat(64);}],
 ['invented recovery time',r=>{r.continuous.recoverableAt='2026-09-25T21:00:02.000Z';}],
 ['retrograde observation',r=>{r.venues[0].checkedAt='2026-09-25T20:59:59.000Z';}],
 ['cross-venue access success',r=>{r.isolation.crossVenueReadDenied=false;}],
 ['absent retry evidence',r=>{r.continuous.retry.interrupted=false;}],
 ['activation claim',r=>{r.activation='performed';}],
] )test(`rejects ${name}`,()=>{const changed=receipt();mutate(changed);assert.throws(()=>verifyManagedRecoveryReceipt(changed));});
