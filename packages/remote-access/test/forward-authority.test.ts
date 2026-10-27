import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {GatewayAuthority} from '../src/authority.ts';
import {signManifest,type GatewayManifest} from '../src/manifest.ts';
import {routeBinding} from '../src/forward-report.ts';
import {renderHaproxy,renderWireGuard} from '../src/config.ts';
const keys=generateKeyPairSync('ed25519'),cellId=randomUUID(),gatewayId=randomUUID(),now=1_000_000;
const route={installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
const v1:GatewayManifest={version:1,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:now,expiresAt:now+600000,routes:[route]};
const v2={...v1,version:2,reporter:{gatewayId,generation:1},routes:[{...route,revision:7}]};
const signed=(value:unknown)=>signManifest(value as GatewayManifest,keys.privateKey,now);
test('v1_has_no_reporting_authority',async()=>{
 const authority=new GatewayAuthority(keys.publicKey,cellId,{persist:async()=>{},apply:async()=>{},close:async()=>{}},()=>now);
 await authority.accept(signed(v1));
 assert.equal(typeof authority.forwardBinding,'function','applied authority must expose a reporting binding');
 assert.equal(authority.forwardBinding(route.installationId),undefined);
 assert.deepEqual(authority.routes,[route]);
});
test('failed_apply_or_expired_manifest_has_no_binding and returned binding is immutable',async()=>{
 let time=now,fail=false;
 const authority=new GatewayAuthority(keys.publicKey,cellId,{persist:async()=>{},apply:async()=>{if(fail)throw Error('apply failed');},close:async()=>{}},()=>time);
 await authority.accept(signed(v2));
 const binding=authority.forwardBinding(route.installationId)!;
 assert.deepEqual(binding,{cellId,gatewayId,generation:1,installationId:route.installationId,venueId:route.venueId,revision:7,
  routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:1,manifestExpiresAt:now+600000});
 assert.ok(Object.isFrozen(binding));assert.equal(authority.forwardBinding(randomUUID()),undefined);
 const rendered=renderHaproxy(authority.routes,{port:443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/input/public-certs'});
 assert.equal(rendered,renderHaproxy([route],{port:443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/input/public-certs'}));
 assert.equal(renderWireGuard(authority.routes),renderWireGuard([route]));
 // Exposing routes must not let a consumer rewrite applied report authority.
 authority.routes[0]!.port=444;assert.equal(authority.forwardBinding(route.installationId)!.routeBinding,binding.routeBinding);
 fail=true;await assert.rejects(authority.accept(signed({...v2,sequence:2})),/apply failed/);
 assert.equal(authority.forwardBinding(route.installationId),undefined);
 fail=false;await authority.accept(signed({...v2,sequence:2}));time+=600000;
 assert.equal(authority.forwardBinding(route.installationId),undefined);
 await authority.tick();assert.deepEqual(authority.routes,[]);
 const restarted=new GatewayAuthority(keys.publicKey,cellId,{persist:async()=>{},apply:async()=>{},close:async()=>{}},()=>time);
 await restarted.restore(signed(v2));assert.equal(restarted.sequence,1);assert.equal(restarted.forwardBinding(route.installationId),undefined);
});
