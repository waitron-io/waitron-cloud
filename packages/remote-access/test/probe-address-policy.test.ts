import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Removing embedded IPv4 validation must expose these otherwise valid IPv6 targets.
for(const address of [
 '::7f00:1','::a00:1','::127.0.0.1','0:0:0:0:0:0:0a00:0001',
 '2002:7f00:1::1','2002:a00:1::1','2002:0A00:0001:0:0:0:0:1',
 '2002::1','2002:a::1','2002:ffff::1','2002::808:808',
 '2002:c0a8:101:808::1','2002:a00:1::1%eth0',
])test(`address policy refuses embedded non-public IPv4: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const address of ['fec0::1','feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'])
 test(`address policy refuses deprecated site-local IPv6: ${address}`,()=>{
  assert.equal(isPublicProbeAddress(address,6),false,address);
 });

for(const address of [
 '::808:808','::8.8.8.8','0:0:0:0:0:0:0808:0808',
 '2002:808:808::1','2002:0808:0808:0:0:0:0:1',
 '2606:4700:4700::1111','2002:c000:301::1','::c000:301',
 '2003:c0a8:101::1','2002:808:808::1%eth0',
])test(`address policy retains public IPv6: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),true,address);
});

for(const address of ['2001::1','2001:0:ffff:ffff:ffff:ffff:f5ff:fffe','64:ff9b:1::a00:1','64:ff9b:1::808:808'])
 test(`address policy retains the existing transition-prefix refusal: ${address}`,()=>{
  assert.equal(isPublicProbeAddress(address,6),false,address);
 });
