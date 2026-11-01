import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {renderHaproxy} from '../src/config.ts';

const route={installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
const options={port:8443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/run/public-certs'};
const traffic={socket:'/state/traffic/process.sock',operationalSources:['127.0.0.2','10.77.0.1']};
const id=route.installationId.replaceAll('-','');

// Missing outer-hop separation would count probes or attribute shared public bytes to a venue.
test('traffic rendering isolates both user channels from trusted operational origins',()=>{
 const value=renderHaproxy([route],{...options,traffic});
 assert.match(value,/stats socket \/state\/traffic\/process.sock mode 600 level operator/);
 assert.match(value,/acl traffic_operational src 127\.0\.0\.2 10\.77\.0\.1/);
 for(const channel of ['staff','public']){
  const user=`traffic_user_${channel}_${id}`,operational=`traffic_ops_${channel}_${id}`;
  assert.ok(value.includes(`backend ${user}\n`));assert.ok(value.includes(`backend ${operational}\n`));
  const userRule=`use_backend ${user} if { req.ssl_sni -m str ${channel==='staff'?route.staffHostname:route.publicHostname} }`;
  const operationalRule=`use_backend ${operational} if traffic_operational { req.ssl_sni -m str ${channel==='staff'?route.staffHostname:route.publicHostname} }`;
  assert.ok(value.includes(userRule));assert.ok(value.includes(operationalRule));assert.ok(value.indexOf(operationalRule)<value.indexOf(userRule));
 }
 assert.match(value,/server edge 127\.0\.0\.1:8444 send-proxy-v2 maxconn 128/);
 assert.match(value,/accept-proxy ssl crt \/run\/public-certs strict-sni/);
 assert.match(value,/set-header X-Waitron-Client-IP %\[src\]/);assert.match(value,/set-header X-Waitron-SNI %\[ssl_fc_sni\]/);
 assert.match(value,/del-header Forwarded/);assert.match(value,/del-header X-Forwarded-For/);
 assert.match(value,/tcp-request connection reject if \{ sc0_conn_cur gt 32 \}/);
 assert.match(value,/tcp-request connection reject if \{ sc0_conn_rate gt 60 \}/);
 assert.match(value,/default_backend denied/);assert.match(value,/default_backend public_gate/);
 assert.doesNotMatch(value,/req\.hdr.*traffic|url.*traffic|stats uri/);
});

test('traffic rendering rejects injectable sockets empty origin inventory and address ranges',()=>{
 for(const socket of ['relative.sock','/state/a.sock\nbackend injected','/state/../a.sock','/state//a.sock','/state/','/state/'+ 'a'.repeat(110)]){
  assert.throws(()=>renderHaproxy([route],{...options,traffic:{...traffic,socket}}),/invalid_traffic_options/);
 }
 for(const operationalSources of [[],['0.0.0.0/0'],['127.0.0.1\nbackend injected'],['host.example.test'],['127.0.0.1','127.0.0.1'],Array.from({length:65},(_,n)=>`10.0.0.${n+1}`)]){
  assert.throws(()=>renderHaproxy([route],{...options,traffic:{...traffic,operationalSources}}),/invalid_traffic_options/);
 }
});

test('absent traffic leaves the original rendering byte-identical',()=>{
 const legacy=renderHaproxy([route],options);
 assert.equal(renderHaproxy([route],{...options,traffic:undefined}),legacy);
 assert.doesNotMatch(legacy,/traffic_|stats socket/);
 assert.match(legacy,new RegExp(`use_backend venue_${id} if`));
 assert.match(legacy,/use_backend public_tls if/);
});

test('traffic backend splitting retains shared staff and public connection ceilings',()=>{
 const value=renderHaproxy([route],{...options,traffic});
 assert.match(value,/backend traffic_connection_limits\n  stick-table type string len 64 size 128 store conn_cur/);
 assert.ok(value.includes(`tcp-request content track-sc1 str(staff_${id}) table traffic_connection_limits if { req.ssl_sni -m str ${route.staffHostname} }`));
 assert.ok(value.includes(`tcp-request content reject if { sc1_conn_cur gt 32 } { req.ssl_sni -m str ${route.staffHostname} }`));
 assert.ok(value.includes(`tcp-request content track-sc1 str(public) table traffic_connection_limits if { req.ssl_sni -m str ${route.publicHostname} }`));
 assert.ok(value.includes(`tcp-request content reject if { sc1_conn_cur gt 128 } { req.ssl_sni -m str ${route.publicHostname} }`));
 assert.ok(value.indexOf('track-sc1')<value.indexOf('tcp-request content accept if { req.ssl_hello_type 1 }'));
});
