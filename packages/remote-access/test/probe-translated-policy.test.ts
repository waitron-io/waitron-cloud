import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Omitting translated-prefix extraction must expose these embedded non-public targets.
for(const address of [
 '::ffff:0:7f00:1','::ffff:0:127.0.0.1','0:0:0:0:ffff:0:7f00:1',
 '::FFFF:0:0A00:0001','::ffff:0:10.0.0.1','::ffff:0:c0a8:101',
 '::ffff:0:ac10:1','::ffff:0:6440:1','::ffff:0:a9fe:1',
 '::ffff:0:0:0','::ffff:0:0:1','::ffff:0:c000:201',
 '::ffff:0:c612:1','::ffff:0:e000:1','::ffff:0:ffff:ffff',
 '::ffff:0:7f00:1%eth0',
])test(`address policy refuses non-public IPv4 in a translated IPv6 address: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const address of [
 '::ffff:0:808:808','::ffff:0:8.8.8.8','0:0:0:0:FFFF:0000:0808:0808',
 '::ffff:0:808:808%eth0','::ffff:0:c000:301',
])test(`address policy retains public IPv4 in a translated IPv6 address: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),true,address);
});

// A similar suffix carries no endpoint; reserved prefixes still refuse independently.
for(const [address,allowed] of [
 ['1::ffff:0:7f00:1',false],['0:1::ffff:0:7f00:1',false],['0:0:1:0:ffff:0:7f00:1',false],
 ['::fffe:0:7f00:1',false],['::ffff:1:7f00:1',false],['0:0:0:1:ffff:0:7f00:1',false],
 ['::1:7f00:1',false],['2606:4700:4700::7f00:1',true],
] as const)test(`translated endpoint detection retains separate prefix classification: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),allowed,address);
});
