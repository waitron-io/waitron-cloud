import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Each range needs both boundaries and a midpoint to catch missing or narrower refusal.
for(const [range,addresses] of [
 ['6000::/3',['6000::','6000::1','6000::8.8.8.8','6000:0000:0000:0000:0000:0000:0000:0001','6000::1%eth0','7000::','7fff::8.8.8.8','7fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['8000::/3',['8000::','8000::1','8000::8.8.8.8','8000:0000:0000:0000:0000:0000:0000:0001','8000::1%eth0','9000::','9fff::8.8.8.8','9fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['a000::/3',['a000::','a000::1','a000::8.8.8.8','A000:0000:0000:0000:0000:0000:0000:0001','a000::1%eth0','b000::','bfff::8.8.8.8','bfff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['c000::/3',['c000::','c000::1','c000::8.8.8.8','C000:0000:0000:0000:0000:0000:0000:0001','c000::1%eth0','d000::','dfff::8.8.8.8','dfff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['e000::/4',['e000::','e000::1','e000::8.8.8.8','E000:0000:0000:0000:0000:0000:0000:0001','e000::1%eth0','e800::','efff::8.8.8.8','efff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['f000::/5',['f000::','f000::1','f000::8.8.8.8','F000:0000:0000:0000:0000:0000:0000:0001','f000::1%eth0','f400::','f7ff::8.8.8.8','f7ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
 ['f800::/6',['f800::','f800::1','f800::8.8.8.8','F800:0000:0000:0000:0000:0000:0000:0001','f800::1%eth0','fa00::','fbff::8.8.8.8','fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
] as const)for(const address of addresses)test(`address policy refuses reserved ${range}: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const [address,family,allowed] of [
 ['5fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',6,false],['fc00::',6,false],
 ['fe00::1',6,false],['ff00::1',6,false],['2001:db8::1',6,false],
 ['::ffff:0:127.0.0.1',6,false],['127.0.0.1',4,false],
 ['8.8.8.8',4,true],['2606:4700:4700::1111',6,true],
 ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',6,true],
 ['::8.8.8.8',6,true],['::ffff:0:8.8.8.8',6,true],['2002:808:808::1',6,true],
 ['1000::1',6,false],
] as const)test(`upper and lower reserved address policy decisions: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),allowed,address);
});
