import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPublicProbeAddress} from '../src/probe.ts';

for(const address of [
 '1.1.1.1','8.8.8.8','93.184.216.34',
 '9.255.255.255','11.0.0.0','100.63.255.255','100.128.0.0',
 '126.255.255.255','128.0.0.0','169.253.255.255','169.255.0.0',
 '172.15.255.255','172.32.0.0','191.255.255.255','192.0.1.0',
 '192.0.1.255','192.0.3.0','192.88.98.255','192.88.100.0',
 '192.167.255.255','192.169.0.0','198.17.255.255','198.20.0.0',
 '198.51.99.255','198.51.101.0','203.0.112.255','203.0.114.0','223.255.255.255',
])test(`address policy accepts direct public IPv4: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,4),true,address);
});

for(const address of [
 '0.0.0.0','0.255.255.255','10.0.0.0','10.255.255.255',
 '100.64.0.0','100.127.255.255','127.0.0.0','127.255.255.255',
 '169.254.0.0','169.254.255.255','172.16.0.0','172.31.255.255',
 '192.0.0.0','192.0.0.255','192.0.2.0','192.0.2.255',
 '192.88.99.0','192.88.99.255','192.168.0.0','192.168.255.255',
 '198.18.0.0','198.19.255.255','198.51.100.0','198.51.100.255',
 '203.0.113.0','203.0.113.255','224.0.0.0','239.255.255.255','240.0.0.0','255.255.255.255',
])test(`address policy refuses direct non-public IPv4: ${address}`,()=>{
 assert.equal(isPublicProbeAddress(address,4),false,address);
});

for(const [address,family] of [
 ['8.8.8.8',6],['2606:4700:4700::1111',4],['8.8.8.8',0],['8.8.8.8',5],
 ['',4],['8.8.8.256',4],['08.8.8.8',4],['8.8.8.8%eth0',4],['8.8.8.8:443',4],
] as const)test(`address policy refuses malformed or mismatched input: ${address}/${family}`,()=>{
 assert.equal(isPublicProbeAddress(address,family),false);
});

for(const address of ['::ffff:8.8.8.8','::ffff:808:808','::ffff:127.0.0.1'])
 test(`address policy keeps mapped IPv6 refusal: ${address}`,()=>{
  assert.equal(isPublicProbeAddress(address,6),false,address);
 });
