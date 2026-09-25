import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=process.argv[2]?await readFile(process.argv[2],'utf8'):await new Promise((resolve,reject)=>{
 let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>value+=chunk);process.stdin.on('end',()=>resolve(value));process.stdin.on('error',reject);
});
const receipt=JSON.parse(source),monitoring=receipt.monitoring;
assert.ok(monitoring&&typeof monitoring==='object','missing monitoring receipt');
assert.equal(monitoring.version,1);
const required=['baseline','route_outage','route_recovery','stale_worker','invalid_trust','gateway_outage','gateway_recovery','certificate_warning'];
assert.deepEqual(monitoring.phases.map(phase=>phase.name),required);
for(const phase of monitoring.phases){
 assert.ok(Number.isInteger(phase.elapsedMs)&&phase.elapsedMs>=0,`${phase.name}: invalid elapsedMs`);
 assert.ok(Number.isInteger(phase.openIncidents)&&phase.openIncidents>=0,`${phase.name}: invalid openIncidents`);
}
const phases=Object.fromEntries(monitoring.phases.map(phase=>[phase.name,phase]));
assert.ok(phases.route_outage.openIncidents>phases.baseline.openIncidents,'route outage opened no incident');
assert.equal(phases.route_recovery.openIncidents,phases.baseline.openIncidents,'route recovery did not restore baseline');
assert.ok(phases.stale_worker.openIncidents>phases.baseline.openIncidents,'stale worker opened no incident');
assert.equal(phases.invalid_trust.openIncidents,phases.baseline.openIncidents,'fresh evidence did not clear stale incidents');
assert.ok(phases.gateway_outage.openIncidents>phases.baseline.openIncidents,'gateway outage opened no incident');
assert.equal(phases.gateway_recovery.openIncidents,phases.baseline.openIncidents,'gateway recovery did not restore baseline');
assert.ok(phases.certificate_warning.openIncidents>phases.baseline.openIncidents,'proof threshold opened no certificate warning');
assert.deepEqual(monitoring.isolation,{routeFailureLimitedToVenueA:true,controlContactStayedFresh:true});
assert.ok(Number.isInteger(monitoring.mail.openings)&&monitoring.mail.openings>0,'missing opening mail');
assert.ok(Number.isInteger(monitoring.mail.recoveries)&&monitoring.mail.recoveries>0,'missing recovery mail');
assert.ok(Number.isInteger(monitoring.mail.deduplicationChecks)&&monitoring.mail.deduplicationChecks>0,'missing repeated-transition deduplication check');
assert.equal(monitoring.mail.duplicates,0);
console.log(`Verified remote monitoring receipt with ${monitoring.phases.length} phases.`);
