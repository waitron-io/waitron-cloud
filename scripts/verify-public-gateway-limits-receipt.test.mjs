import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyPublicGatewayLimitsReceipt} from './verify-public-gateway-limits-receipt.mjs';
import {fixture} from './public-gateway-limits-receipt-fixture.mjs';
test('accepts a complete bounded two-venue measurement',()=>assert.equal(verifyPublicGatewayLimitsReceipt(fixture()).version,1));
for(const [name,change]of [
 ['missing expiry',r=>r.controlled.phases.splice(14,1)],['cross-venue leak',r=>r.controlled.credentialsStripped=false],['same venue',r=>r.venues[1].venueId='a'],['missing gateway',r=>delete r.gateway],['dirty cloud',r=>r.cloudDirty=true],['dirty Waitron',r=>r.waitronDirty=true],['incorrect count',r=>r.controlled.phases[0].requests++],['negative latency',r=>r.gateway.phases[0].latencyMs.min=-1],['unordered latency',r=>r.gateway.phases[0].latencyMs.p95=8],['unbounded sample',r=>r.gateway.phases[0].requests=10000],['missing budget',r=>r.gateway.accountedBeforeRefusal=119],['leftover container',r=>r.cleanup.containers=1],['unknown receipt version',r=>r.version=2],['unreleased gate',r=>r.controlled.finalActive=1],['missing saturation',r=>r.controlled.peakActive=63],['fresh-connection refusal absent',r=>r.gateway.connectionBurst.statuses={403:80}],['unknown field',r=>r.secret='credential'],['fake expiry success',r=>r.controlled.phases[14].statuses={200:2}],['missing recovery',r=>delete r.gateway.afterRestart],['duplicate phase',r=>r.controlled.phases.push(r.controlled.phases[0])]
])test('refuses '+name,()=>{const r=fixture();change(r);assert.throws(()=>verifyPublicGatewayLimitsReceipt(r));});
