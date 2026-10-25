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

// A similar suffix is insufficient: only the exact translated prefix carries this endpoint.
for(const address of [
 '::fffe:0:7f00:1','::ffff:1:7f00:1','0:0:0:1:ffff:0:7f00:1',
 '::1:7f00:1','2606:4700:4700::7f00:1',
])test(`translated endpoint detection preserves the existing policy outside its prefix: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),true,address);
});
