import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

// IANA reserves the returned 6bone range, including its former Teredo allocation.
for(const address of [
 '3ffe::','3ffe::1','3ffe:8000::','3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
 '3ffe:831f::1','3FFE:831F::1','3ffe:0000:0000:0000:0000:0000:0000:0001',
 '3ffe::8.8.8.8','3ffe:ffff:ffff:ffff:ffff:ffff:255.255.255.255','3ffe::1%eth0',
])test(`address policy refuses returned 6bone address: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,6),false,address);
});

for(const [address,family,allowed] of [
 ['3ffd:ffff:ffff:ffff:ffff:ffff:ffff:ffff',6,true],
 ['3fff::',6,false],['3fff:1000::',6,true],
 ['2606:4700:4700::1111',6,true],['2001:4860:4860::8888',6,true],
 ['2001:db8::1',6,false],['4000::',6,false],
 ['8.8.8.8',4,true],['127.0.0.1',4,false],
 ['::8.8.8.8',6,true],['::127.0.0.1',6,false],
 ['::ffff:0:8.8.8.8',6,true],['::ffff:0:127.0.0.1',6,false],
 ['2002:808:808::1',6,true],['2002:7f00:1::1',6,false],
 ['3ffe::1',4,false],['invalid',6,false],
 ] as const)test(`6bone refusal preserves other address decisions: ${address}/${family}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),allowed,address);
});
