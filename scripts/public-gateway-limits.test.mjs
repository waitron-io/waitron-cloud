import assert from 'node:assert/strict';
import {test} from 'node:test';
import {measureControlledGate} from './public-gateway-limits.mjs';
import {verifyPublicGatewayLimitsReceipt} from './verify-public-gateway-limits-receipt.mjs';
import {fixture} from './public-gateway-limits-receipt-fixture.mjs';
test('real two-venue HTTPS traffic measures shared budgets, credentials and expiry',async()=>{
 const receipt=fixture();receipt.controlled=await measureControlledGate();verifyPublicGatewayLimitsReceipt(receipt);
 assert.equal(receipt.controlled.upstreamRequests,92);
});
