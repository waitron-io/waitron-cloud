import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {verifyBackupTransferReceipt} from './verify-backup-transfer-receipt.mjs';
import {verifyManagedRecoveryReceipt} from './verify-managed-recovery-receipt.mjs';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const commit=/^[0-9a-f]{40}$/;
const requiredPhases=['backup-transfer','remote-access','managed-recovery'];
const requiredChecks=['real-postgresql','real-waitron','real-wireguard-haproxy','real-seaweedfs-litestream','no-production-resources'];
const requiredRemoteChecks=[
 'two real SQLite Waitron servers paired through authenticated manager APIs',
 'real WireGuard traffic and staff TLS passthrough; venue TLS keys absent from gateway',
 'real browser Worker proof of work, rejected public calls have zero upstream requests, blocked manager paths, overwritten proxy headers, cross-host bot cookie refusal',
 'monitor detects and recovers one-route and whole-gateway failures while preserving other-venue isolation, stable certificates and fresh control contact',
 'encrypted venue-scoped snapshots publish before and after real gateway replacement',
];
const monitoringPhases=['baseline','route_outage','route_recovery','stale_worker','invalid_trust','gateway_outage','gateway_recovery','certificate_warning'];
function exact(value,keys){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function date(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function positive(value){return typeof value==='number'&&Number.isFinite(value)&&value>0;}
function fail(){throw new Error('two-venue milestone receipt is invalid');}

export function verifyRemoteMilestoneEvidence(remote){
 if(!exact(remote,['version','cloudHead','cloudDirty','waitronHead','waitronDirty','checks','replacementMs','revocationMs','functionalProbes','monitoring','movement','backupContinuity'])||remote.version!==2||!commit.test(remote.cloudHead)||!commit.test(remote.waitronHead)||typeof remote.cloudDirty!=='boolean'||typeof remote.waitronDirty!=='boolean'||!positive(remote.replacementMs)||!positive(remote.revocationMs)||!Array.isArray(remote.checks)||requiredRemoteChecks.some(check=>!remote.checks.includes(check)))fail();
 if(!Array.isArray(remote.functionalProbes)||remote.functionalProbes.length!==2)fail();
 const bindings=new Map();
 for(const probe of remote.functionalProbes){
  if(!uuid.test(probe?.venueId)||!uuid.test(probe?.installationId)||bindings.has(probe.venueId)||[probe.public,probe.staff].some(service=>service?.status!=='healthy'))fail();
  bindings.set(probe.venueId,probe.installationId);
 }
 const monitoring=remote.monitoring;
 if(monitoring?.version!==1||JSON.stringify(monitoring.phases?.map(phase=>phase.name))!==JSON.stringify(monitoringPhases)||monitoring.isolation?.routeFailureLimitedToVenueA!==true||monitoring.isolation?.controlContactStayedFresh!==true||monitoring.mail?.duplicates!==0)fail();
 const movement=remote.movement;
 if(movement?.version!==1||!positive(movement.reconnectionMs)||movement.failedApply?.cancelled!==true||movement.failedApply?.sourceStayedHealthy!==true||movement.failedApply?.destinationRemoved!==true||movement.hostnamesPreserved!==true||movement.certificatesPreserved!==true||movement.otherVenueIsolated!==true||movement.oldRouteRevoked!==true||movement.completedReplayMatched!==true)fail();
 const continuity=remote.backupContinuity;
 if(!exact(continuity,['version','before','after','gatewayReplaced','routesRecovered','venueSeparationPreserved'])||continuity.version!==1||continuity.gatewayReplaced!==true||continuity.routesRecovered!==true||continuity.venueSeparationPreserved!==true||!Array.isArray(continuity.before)||!Array.isArray(continuity.after)||continuity.before.length!==2||continuity.after.length!==2)fail();
 const pointIds=new Set();
 for(const phase of [continuity.before,continuity.after]){
  const seen=new Set();
  for(const point of phase){
   if(!exact(point,['venueId','installationId','pointId','capturedAt'])||!uuid.test(point.venueId)||!uuid.test(point.installationId)||!uuid.test(point.pointId)||!date(point.capturedAt)||bindings.get(point.venueId)!==point.installationId||seen.has(point.venueId)||pointIds.has(point.pointId))fail();
   seen.add(point.venueId);pointIds.add(point.pointId);
  }
  if(seen.size!==bindings.size)fail();
 }
 for(const before of continuity.before){const after=continuity.after.find(point=>point.venueId===before.venueId);if(!after||Date.parse(after.capturedAt)<=Date.parse(before.capturedAt))fail();}
 return remote;
}

export function verifyTwoVenueMilestoneReceipt(value){
 if(!exact(value,['version','cloudHead','waitronHead','cloudDirty','waitronDirty','phases','transfer','remote','managedRecovery','measurements','activation','checks'])||value.version!==1||!commit.test(value.cloudHead)||!commit.test(value.waitronHead)||value.cloudDirty!==false||value.waitronDirty!==false||JSON.stringify(value.phases)!==JSON.stringify(requiredPhases)||JSON.stringify(value.checks)!==JSON.stringify(requiredChecks)||value.activation!=='not-performed')fail();
 const transfer=verifyBackupTransferReceipt(value.transfer),remote=verifyRemoteMilestoneEvidence(value.remote),managed=verifyManagedRecoveryReceipt(value.managedRecovery);
 for(const component of [transfer,remote,managed])if(component.cloudHead!==value.cloudHead||component.waitronHead!==value.waitronHead||component.cloudDirty!==false||component.waitronDirty!==false)fail();
 const measurements=value.measurements;
 if(!exact(measurements,['gatewayReplacementMs','cellReconnectionMs','continuousRestoreMs','snapshotRestoreMs','replacementMs'])||Object.values(measurements).some(item=>!positive(item))||measurements.gatewayReplacementMs!==remote.replacementMs||measurements.cellReconnectionMs!==remote.movement.reconnectionMs||measurements.continuousRestoreMs!==managed.continuous.restoreMs||measurements.snapshotRestoreMs!==managed.snapshotFallback.restoreMs||measurements.replacementMs!==managed.replacement.elapsedMs||managed.activation!==value.activation)fail();
 return value;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw new Error('usage: verify-two-venue-milestone-receipt.mjs RECEIPT.json');
 const receipt=verifyTwoVenueMilestoneReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));
 console.log(`verified complete two-venue milestone at ${receipt.cloudHead}`);
}
