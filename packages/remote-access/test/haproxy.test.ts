import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {renderHaproxy,renderWireGuard} from '../src/config.ts';
const route={installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
test('staff routing is exact and public TLS terminates on a separate trusted proxy hop',()=>{
 const config=renderHaproxy([route],{port:8443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/run/public-certs'});
 assert.match(config,/req.ssl_sni -m str staff.sol.example.test/);assert.match(config,/default_backend denied/);
 assert.match(config,/tcp-request connection reject if.*conn_cur/);assert.match(config,/server venue 10.77.0.2:443 maxconn 32/);
 assert.match(config,/send-proxy-v2/);assert.match(config,/accept-proxy ssl crt \/run\/public-certs/);
 assert.match(config,/set-header X-Waitron-Client-IP %\[src\]/);assert.match(config,/set-header X-Waitron-SNI %\[ssl_fc_sni\]/);
 assert.doesNotMatch(config,/staff.*\.pem/);
 assert.throws(()=>renderHaproxy([{...route,staffHostname:'bad\nbackend unsafe'}],{port:8443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/run/public-certs'}),/invalid/);
});
test('WireGuard exports only exact peer addresses and no private venue keys',()=>{
 const config=renderWireGuard([route]);assert.match(config,/AllowedIPs = 10.77.0.2\/32/);assert.match(config,/PublicKey = /);assert.doesNotMatch(config,/PrivateKey|0.0.0.0/);
});

test('ACME checks select the loopback backend before staff and public routes in both modes', () => {
 const options={port:443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/run/public-certs'};
 for(const traffic of [undefined,{socket:'/run/gateway.sock',operationalSources:['127.0.0.1']}]) {
  const config=renderHaproxy([route],{...options,traffic});
  assert.match(config.match(/^  use_backend .*$/m)?.[0] ?? '', /^  use_backend acme_alpn if \{ req\.ssl_alpn -m str acme-tls\/1 \}$/);
  assert.match(config,/^backend acme_alpn\n  timeout server 3s\n  server alpn 127\.0\.0\.1:8445 maxconn 16$/m);
 }
 assert.throws(()=>renderHaproxy([],{...options,alpnPort:options.gatePort}),/invalid_gateway_options/);
 assert.throws(()=>renderHaproxy([],{...options,publicTlsPort:8445}),/invalid_gateway_options/);
});
