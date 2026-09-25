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
assert.deepEqual(monitoring.isolation,{routeFailureLimitedToVenueA:true,controlContactStayedFresh:true});
assert.ok(Number.isInteger(monitoring.mail.openings)&&monitoring.mail.openings>0,'missing opening mail');
assert.ok(Number.isInteger(monitoring.mail.recoveries)&&monitoring.mail.recoveries>0,'missing recovery mail');
assert.equal(monitoring.mail.duplicates,0);
console.log(`Verified remote monitoring receipt with ${monitoring.phases.length} phases.`);
