import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderHaproxy} from '../src/config.ts';
test('the optional trusted proxy is one IPv4 peer, never a subnet or configuration text',()=>{
 const options={port:443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/input/public-certs'};
 for(const proxySource of ['127.0.0.1\n  tcp-request connection accept','127.0.0.0/8','not-an-address','::1'])assert.throws(()=>renderHaproxy([],{...options,proxySource}),/invalid_gateway_options/);
});
