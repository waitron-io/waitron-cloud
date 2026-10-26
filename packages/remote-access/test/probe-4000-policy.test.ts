import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Missing, shifted or narrower refusal must expose one of these reserved targets.
for(const address of [
 '4000::','4000::1','4000::8.8.8.8','4000:0000:0000:0000:0000:0000:0000:0001',
 '4000::1%eth0','4fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff','5000::',
 '5f00::1','5fff::808:808','5fff::8.8.8.8',
 '5fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
])test(`address policy refuses reserved 4000::/3: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

// Neighbouring prefixes keep their existing decisions, independently of reachability.
for(const [address,allowed] of [
 ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',true],['6000::',true],
 ['3fff::1',false],['2001:db8::1',false],['fe00::1',false],
 ['::ffff:0:127.0.0.1',false],['fc00::1',false],
] as const)test(`4000 refusal preserves other IPv6 address decisions: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),allowed,address);
});

for(const [address,family] of [
 ['8.8.8.8',4],['2606:4700:4700::1111',6],['::8.8.8.8',6],
 ['::ffff:0:8.8.8.8',6],['2002:808:808::1',6],
] as const)test(`4000 refusal preserves existing public address decisions: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),true,address);
});
