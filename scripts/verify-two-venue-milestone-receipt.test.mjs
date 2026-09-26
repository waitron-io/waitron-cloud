import assert from 'node:assert/strict';
import {test} from 'node:test';
import {managedReceipt} from './managed-recovery-receipt.fixture.mjs';
import {verifyTwoVenueMilestoneReceipt} from './verify-two-venue-milestone-receipt.mjs';

const cloudHead='a'.repeat(40),waitronHead='b'.repeat(40);
const venueA='12345678-1234-4234-8234-123456789abc',venueB='22345678-1234-4234-8234-123456789abc';
const installationA='32345678-1234-4234-8234-123456789abc',installationB='92345678-1234-4234-8234-123456789abc';
const point=(venueId,installationId,pointId,capturedAt)=>({venueId,installationId,pointId,capturedAt});
function transferReceipt(){return {
 version:1,cloudHead,cloudDirty:false,waitronHead,waitronDirty:false,
 fixture:{bytes:4194304,chunkBytes:65536,chunkDelayMs:2,deadlineMs:120},
 transfers:{upload:{elapsedMs:151,bytesPerSecond:27776662,attempts:2,committedBytes:4194304},download:{elapsedMs:149,bytesPerSecond:28149691,attempts:2,receivedBytes:4194304},deadline:{uploadRefused:true,uploadElapsedMs:124,downloadRefused:true,downloadElapsedMs:122,partialStages:0},missingObjectRefused:true},
 lifecycle:{acknowledgedUploadResumed:true,uploads:1,publications:1,credentialRenewalReusedArchive:true,archives:1,expiredOperationRefused:true,operationExpiryHours:24},
 shutdown:{cloudDownloadCancelled:true,cloudAbortToSettleMs:19,cloudFailures:0,cloudAttempts:0,waitronArchiveAbortToSettleMs:23,waitronUploads:0,waitronPublications:0},
 checks:['controlled-https-storage','postgresql-catalogue','waitron-snapshot-worker','no-production-resources'],
};}
function healthyService(){return {status:'healthy',checkedAt:'2026-09-27T00:00:00.000Z',latencyMs:12,certificate:{notAfter:'2026-10-27T00:00:00.000Z',fingerprint256:'AA:BB'}};}
function remoteReceipt(){return {
 version:2,cloudHead,cloudDirty:false,waitronHead,waitronDirty:false,
 checks:['two real SQLite Waitron servers paired through authenticated manager APIs','real WireGuard traffic and staff TLS passthrough; venue TLS keys absent from gateway','real browser Worker proof of work, rejected public calls have zero upstream requests, blocked manager paths, overwritten proxy headers, cross-host bot cookie refusal','monitor detects and recovers one-route and whole-gateway failures while preserving other-venue isolation, stable certificates and fresh control contact','encrypted venue-scoped snapshots publish before and after real gateway replacement'],
 replacementMs:1317,revocationMs:204,
 functionalProbes:[
  {version:1,installationId:installationA,venueId:venueA,publicHostname:'a.public.example.test',staffHostname:'a.staff.example.test',revision:1,checkedAt:'2026-09-27T00:00:00.000Z',public:healthyService(),staff:healthyService()},
  {version:1,installationId:installationB,venueId:venueB,publicHostname:'b.public.example.test',staffHostname:'b.staff.example.test',revision:1,checkedAt:'2026-09-27T00:00:00.000Z',public:healthyService(),staff:healthyService()},
 ],
 monitoring:{version:1,phases:[{name:'baseline',elapsedMs:1,openIncidents:0},{name:'route_outage',elapsedMs:2,openIncidents:2},{name:'route_recovery',elapsedMs:3,openIncidents:0},{name:'stale_worker',elapsedMs:4,openIncidents:4},{name:'invalid_trust',elapsedMs:5,openIncidents:0},{name:'gateway_outage',elapsedMs:6,openIncidents:4},{name:'gateway_recovery',elapsedMs:7,openIncidents:0},{name:'certificate_warning',elapsedMs:8,openIncidents:4}],isolation:{routeFailureLimitedToVenueA:true,controlContactStayedFresh:true},mail:{openings:6,recoveries:6,deduplicationChecks:1,duplicates:0}},
 movement:{version:1,failedApply:{cancelled:true,sourceStayedHealthy:true,destinationRemoved:true},hostnamesPreserved:true,certificatesPreserved:true,otherVenueIsolated:true,oldRouteRevoked:true,completedReplayMatched:true,reconnectionMs:1486,sequences:{initialSource:1,failedTarget:1,cancelledTarget:2,stagedTarget:3,committedSource:2,committedTarget:4}},
 backupContinuity:{version:1,before:[point(venueA,installationA,'a2345678-1234-4234-8234-123456789abc','2026-09-27T00:01:00.000Z'),point(venueB,installationB,'b2345678-1234-4234-8234-123456789abc','2026-09-27T00:01:01.000Z')],after:[point(venueA,installationA,'c2345678-1234-4234-8234-123456789abc','2026-09-27T00:02:00.000Z'),point(venueB,installationB,'d2345678-1234-4234-8234-123456789abc','2026-09-27T00:02:01.000Z')],gatewayReplaced:true,routesRecovered:true,venueSeparationPreserved:true},
};}
export function milestoneReceipt(){const managed=managedReceipt();return {
 version:1,cloudHead,waitronHead,cloudDirty:false,waitronDirty:false,
 phases:['backup-transfer','remote-access','managed-recovery'],
 transfer:transferReceipt(),remote:remoteReceipt(),managedRecovery:managed,
 measurements:{gatewayReplacementMs:1317,cellReconnectionMs:1486,continuousRestoreMs:732,snapshotRestoreMs:418,replacementMs:593},
 activation:'not-performed',checks:['real-postgresql','real-waitron','real-wireguard-haproxy','real-seaweedfs-litestream','no-production-resources'],
};}

test('accepts complete clean evidence from the same Cloud and Waitron heads',()=>assert.deepEqual(verifyTwoVenueMilestoneReceipt(milestoneReceipt()),milestoneReceipt()));
for(const [name,mutate] of [
 ['dirty Cloud head',r=>{r.cloudDirty=true;}],
 ['dirty Waitron head',r=>{r.waitronDirty=true;}],
 ['mismatched component Cloud head',r=>{r.remote.cloudHead='c'.repeat(40);}],
 ['mismatched component Waitron head',r=>{r.managedRecovery.waitronHead='d'.repeat(40);}],
 ['missing phase',r=>{r.phases.pop();}],
 ['missing real gateway check',r=>{r.remote.checks.splice(1,1);}],
 ['missing public protection check',r=>{r.remote.checks.splice(2,1);}],
 ['one functional probe',r=>{r.remote.functionalProbes.pop();}],
 ['crossed before installation',r=>{r.remote.backupContinuity.before[0].installationId=installationB;}],
 ['duplicate after point',r=>{r.remote.backupContinuity.after[0].pointId=r.remote.backupContinuity.before[0].pointId;}],
 ['missing post-replacement capture',r=>{r.remote.backupContinuity.after.pop();}],
 ['gateway did not recover',r=>{r.remote.backupContinuity.routesRecovered=false;}],
 ['venue separation lost',r=>{r.remote.backupContinuity.venueSeparationPreserved=false;}],
 ['missing fallback restore',r=>{r.managedRecovery.snapshotFallback.restoreSucceeded=false;}],
 ['old authority live',r=>{r.managedRecovery.replacement.oldAuthorityRefused=false;}],
 ['reused replacement secret',r=>{r.managedRecovery.replacement.newRecoveryKeyDigest=r.managedRecovery.replacement.oldRecoveryKeyDigest;}],
 ['zero gateway timing',r=>{r.measurements.gatewayReplacementMs=0;}],
 ['summary differs from evidence',r=>{r.measurements.continuousRestoreMs++;}],
 ['activation claim',r=>{r.activation='performed';}],
] )test(`rejects ${name}`,()=>{const changed=milestoneReceipt();mutate(changed);assert.throws(()=>verifyTwoVenueMilestoneReceipt(changed));});
