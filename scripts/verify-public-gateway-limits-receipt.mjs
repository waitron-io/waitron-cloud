import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
function keys(value,names){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),names.sort());}
function phase(p){
 keys(p,['name','requests','statuses','latencyMs']);assert.equal(typeof p.name,'string');assert.ok(Number.isInteger(p.requests)&&p.requests>0&&p.requests<=256);
 assert.ok(Object.keys(p.statuses).length>0);let sum=0;for(const [status,n]of Object.entries(p.statuses)){assert.match(status,/^(200|403|404|421|429|503|transport)$/);assert.ok(Number.isInteger(n)&&n>0);sum+=n;}assert.equal(sum,p.requests);
 keys(p.latencyMs,['min','p50','p95','max']);const times=['min','p50','p95','max'].map(k=>p.latencyMs[k]);assert.ok(times.every(n=>Number.isFinite(n)&&n>=0));assert.deepEqual(times,[...times].sort((a,b)=>a-b));
}
const controlled=[['unsolved',403,8],['solved-two-venues',200,16],['cross-host-cookie',403,1],['cross-ip-cookie',403,1],['staff-paths',404,4],['shared-ip-budget-a',200,120],['shared-ip-budget-b',429,1],['different-ip-unaffected',200,1],['shared-concurrency-b',429,1],['held-a',200,64],['after-release-b',200,1],['upstream-failure-a',503,4],['upstream-failure-b',200,4],['expired-challenge',403,1],['expired-access',403,2],['renewed-access',200,1]];
const gateway=[['unsolved',403,8],['solved-0',200,8],['solved-1',200,8],['cross-host-cookie',403,1],['staff-paths',404,2],['spoofed-sni',421,1],['failed-upstream-a',503,1],['failed-upstream-b',200,4],['recovered-a',200,1],['shared-budget-b',429,1]];
function phases(values,required,fill=false){
 assert.ok(Array.isArray(values));assert.equal(new Set(values.map(p=>p.name)).size,values.length);values.forEach(phase);
 for(const [name,status,n]of required){const p=values.find(p=>p.name===name);assert.ok(p,name);assert.equal(p.requests,n);assert.deepEqual(p.statuses,{[status]:n});}
 const extras=values.filter(p=>!required.some(([name])=>name===p.name));if(fill){assert.ok(extras.length>0);assert.equal(extras.reduce((sum,p)=>sum+p.requests,0),83);for(const p of extras){assert.match(p.name,/^budget-fill-\d+$/);assert.deepEqual(p.statuses,{200:p.requests});}}else assert.equal(extras.length,0);
}
export function verifyPublicGatewayLimitsReceipt(r){
 keys(r,['version','cloudHead','waitronHead','cloudDirty','waitronDirty','venues','controlled','gateway','cleanup']);assert.equal(r.version,1);
 for(const key of ['cloudHead','waitronHead'])assert.match(r[key],/^[0-9a-f]{40}$/);assert.equal(r.cloudDirty,false);assert.equal(r.waitronDirty,false);
 assert.equal(r.venues.length,2);for(const v of r.venues){keys(v,['venueId','installationId','publicHostname']);for(const value of Object.values(v))assert.ok(typeof value==='string'&&value.length>0);}
 for(const key of ['venueId','installationId','publicHostname'])assert.notEqual(r.venues[0][key],r.venues[1][key]);
 const c=r.controlled;keys(c,['phases','clock','peakActive','finalActive','upstreamRequests','credentialsStripped','rejectedRequestsNotForwarded','venueBodiesMatched','cleanup']);
 assert.equal(c.clock,'injected; real sockets and default policy');assert.equal(c.peakActive,64);assert.equal(c.finalActive,0);assert.equal(c.upstreamRequests,92);for(const k of ['credentialsStripped','rejectedRequestsNotForwarded','venueBodiesMatched'])assert.equal(c[k],true);assert.deepEqual(c.cleanup,{listeners:0,temporaryDirectories:0});phases(c.phases,controlled);
 const g=r.gateway;keys(g,['phases','accountedBeforeRefusal','sharedSource','failedVenueDidNotBlockOther','connectionBurst','afterRestart']);assert.equal(g.accountedBeforeRefusal,120);assert.equal(g.sharedSource,true);assert.equal(g.failedVenueDidNotBlockOther,true);phases(g.phases,gateway,true);
 phase(g.connectionBurst);assert.equal(g.connectionBurst.name,'fresh-connections');assert.equal(g.connectionBurst.requests,80);assert.ok(g.connectionBurst.statuses.transport>0);assert.ok(g.connectionBurst.statuses['403']>0);assert.deepEqual(Object.keys(g.connectionBurst.statuses).sort(),['403','transport']);
 phase(g.afterRestart);assert.equal(g.afterRestart.name,'after-restart');assert.deepEqual(g.afterRestart.statuses,{200:2});
 assert.deepEqual(r.cleanup,{containers:0,networks:0,temporaryDirectories:0,childProcesses:0});return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=verifyPublicGatewayLimitsReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));console.log(`verified public gateway limits at ${r.cloudHead}`);}
