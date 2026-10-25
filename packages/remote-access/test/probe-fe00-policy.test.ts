import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Removing the subnet must expose every target; narrowing it must expose a subset.
for(const address of [
 'fe00::','fe00::1','fe00::8.8.8.8','FE00:0000:0000:0000:0000:0000:0000:0001',
 'fe00::1%eth0','fe3f:ffff:ffff:ffff:ffff:ffff:ffff:ffff','fe40::',
 'fe7f::1','FE7F::808:808','fe7f::8.8.8.8',
 'fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
])test(`address policy refuses reserved fe00::/9: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const address of [
 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff','fe80::','fe80::1%eth0',
 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff','fec0::','feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
])test(`fe00 refusal retains neighbouring non-public refusal: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const [address,family] of [
 ['8.8.8.8',4],['2606:4700:4700::1111',6],['::8.8.8.8',6],
 ['::ffff:0:8.8.8.8',6],['2002:808:808::1',6],
] as const)test(`fe00 refusal preserves public address policy: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),true,address);
});
