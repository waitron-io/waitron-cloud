import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// Removing reserved-prefix refusal must expose these valid, unassigned IPv6 targets.
for(const address of [
 '::1:0:0','::1:8.8.8.8','::2:7f00:1','::2:127.0.0.1',
 '0:0:0:0:1:0:808:808','::FFFE:0:0808:0808','::ffff:1:808:808',
 '::1:7f00:1%eth0','1::','1::1','1::8.8.8.8','0001:0:0:0:0:0:0:1',
 '64:ff9a::1','64:ff9b:0:1::1','64:ff9b:2::1',
 'ff::','ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
])test(`address policy refuses unhandled reserved ::/8 forms: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

// Reserved classification must not replace the existing embedded-IPv4 decisions.
for(const [address,allowed] of [
 ['::8.8.8.8',true],['::808:808',true],['::127.0.0.1',false],
 ['::ffff:0:8.8.8.8',true],['::ffff:0:808:808',true],['::ffff:0:127.0.0.1',false],
 ['::ffff:8.8.8.8',false],['64:ff9b::808:808',false],['64:ff9b:1::808:808',false],
 ['2002:808:808::1',true],['2002:7f00:1::1',false],['2606:4700:4700::1111',true],
 ['100:1::1',false],['100::1',false],
] as const)test(`reserved address policy decisions: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),allowed,address);
});
