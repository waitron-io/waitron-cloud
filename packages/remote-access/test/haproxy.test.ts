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
