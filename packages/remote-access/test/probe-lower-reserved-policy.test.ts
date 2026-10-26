import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Boundaries and midpoints expose missing, shifted or narrower reserved ranges.
for(const [range,addresses] of [
 ['100::/8',['100::','100::1','100::8.8.8.8','0100:0000:0000:0000:0000:0000:0000:0001','100::1%eth0','180::','1ff::8.8.8.8','1ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['200::/7',['200::','200::1','200::8.8.8.8','0200:0000:0000:0000:0000:0000:0000:0001','200::1%eth0','300::','3ff::8.8.8.8','3ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['400::/6',['400::','400::1','400::8.8.8.8','0400:0000:0000:0000:0000:0000:0000:0001','400::1%eth0','600::','7ff::8.8.8.8','7ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['800::/5',['800::','800::1','800::8.8.8.8','0800:0000:0000:0000:0000:0000:0000:0001','800::1%eth0','c00::','fff::8.8.8.8','fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['1000::/4',['1000::','1000::1','1000::8.8.8.8','1000:0000:0000:0000:0000:0000:0000:0001','1000::1%eth0','1800::','1fff::8.8.8.8','1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
] as const)for(const address of addresses)test(`address policy refuses lower reserved ${range}: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

// The discard-only allocation and dummy prefix cannot be external destinations.
for(const address of [
 '100::ffff:ffff:ffff:ffff','100:0:0:1::','100:0:0:1::1',
 '100:0:0:1:ffff:ffff:ffff:ffff','100:0:0:2::','100:1::1',
])test(`address policy refuses non-public allocations and neighbours in 100::/8: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const [address,family,allowed] of [
 ['ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',6,false],['2000::',6,true],
 ['2001:db8::1',6,false],['2606:4700:4700::1111',6,true],
 ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',6,true],['4000::',6,false],
 ['6000::1',6,false],['fe00::1',6,false],['fc00::1',6,false],['ff00::1',6,false],
 ['8.8.8.8',4,true],['127.0.0.1',4,false],
 ['::8.8.8.8',6,true],['::808:808',6,true],['::127.0.0.1',6,false],
 ['::ffff:0:8.8.8.8',6,true],['::ffff:0:808:808',6,true],['::ffff:0:127.0.0.1',6,false],
 ['::ffff:8.8.8.8',6,false],['64:ff9b::8.8.8.8',6,false],
 ['2002:808:808::1',6,true],['2002:7f00:1::1',6,false],
] as const)test(`lower reserved refusal preserves other address decisions: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),allowed,address);
});
