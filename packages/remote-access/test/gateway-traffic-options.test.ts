import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {signManifest} from '../src/manifest.ts';

const module=await import(new URL('../src/gateway-traffic-options.ts',import.meta.url).href).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
const read=(env:NodeJS.ProcessEnv)=>{assert.equal(typeof module?.gatewayTrafficOptions,'function','explicit gateway traffic options must be validated');return module!.gatewayTrafficOptions(env);};
const env={GATEWAY_TRAFFIC_MODE:'test',GATEWAY_TRAFFIC_COUNTRY:'ES',GATEWAY_TRAFFIC_ENVIRONMENT:'test',GATEWAY_TRAFFIC_SOCKET_DIRECTORY:'/state/traffic',GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'["127.0.0.2"]'};
const cellId=randomUUID(),processId=randomUUID(),keys=generateKeyPairSync('ed25519'),now=1000;
const route={installationId:randomUUID(),venueId:randomUUID(),revision:1,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
const manifest={version:2 as const,audience:'waitron-cloud-gateway' as const,cellId,sequence:1,issuedAt:now,expiresAt:now+600000,reporter:{gatewayId:randomUUID(),generation:1},routes:[route]};
function rendering(envelope:unknown,routes=[route],at=now){
 assert.equal(typeof module?.trafficManifestOptions,'function','traffic rendering must require verified v2 authority');
 return module!.trafficManifestOptions(read(env),envelope,keys.publicKey,cellId,routes,processId,at);
}

test('gateway CLI refuses partial traffic opt-in before opening private keys or networking',()=>{
 const result=spawnSync(process.execPath,[new URL('../src/gateway-cli.ts',import.meta.url).pathname],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,GATEWAY_CELL_ID:cellId,GATEWAY_TRAFFIC_MODE:'test'}});
 assert.equal(result.status,1);assert.match(result.stderr,/invalid_traffic_options/);assert.doesNotMatch(result.stderr,/ENOENT|wireguard|iptables/);
});

test('gateway traffic options default off and require a complete explicit ES test opt-in',()=>{
 assert.equal(read({}),undefined);assert.equal(read({GATEWAY_FORWARD_REPORT_DIR:'/health'}),undefined);
 assert.deepEqual(read(env),{socketDirectory:'/state/traffic',operationalSources:['127.0.0.2']});
 for(const key of Object.keys(env)){const value={...env};delete value[key as keyof typeof value];assert.throws(()=>read(value),/invalid_traffic_options/);}
 for(const change of [{GATEWAY_TRAFFIC_MODE:'production'},{GATEWAY_TRAFFIC_COUNTRY:'FR'},{GATEWAY_TRAFFIC_ENVIRONMENT:'production'},{GATEWAY_TRAFFIC_SOCKET_DIRECTORY:'/state/../traffic'},{GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'[]'},{GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'["0.0.0.0/0"]'},{GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'not-json'}])assert.throws(()=>read({...env,...change}),/invalid_traffic_options/);
});

test('gateway traffic requires fresh signed v2 routes and a distinct child socket',()=>{
 const envelope=signManifest(manifest,keys.privateKey,now);
 assert.deepEqual(rendering(envelope),{socket:`/state/traffic/${processId}.sock`,operationalSources:['127.0.0.2']});
 const second=randomUUID();assert.notEqual(module!.trafficManifestOptions(read(env),envelope,keys.publicKey,cellId,[route],second,now).socket,rendering(envelope).socket);
 const {reporter:_,...v1}=manifest;
 const {revision:__,...legacyRoute}=route;
 const legacy=signManifest({...v1,version:1,routes:[legacyRoute]},keys.privateKey,now);
 assert.throws(()=>module!.trafficManifestOptions(read(env),legacy,keys.publicKey,cellId,[legacyRoute],processId,now),/traffic_authority_unavailable/);
 for(const bad of [legacy,{...envelope,signature:'A'.repeat(86)}])assert.throws(()=>rendering(bad),/traffic_authority_unavailable/);
 assert.throws(()=>rendering(envelope,[{...route,revision:2}]),/traffic_authority_unavailable/);
 assert.throws(()=>rendering(envelope,[route],now+600000),/traffic_authority_unavailable/);
 assert.throws(()=>module!.trafficManifestOptions(read(env),envelope,keys.publicKey,randomUUID(),[route],processId,now),/traffic_authority_unavailable/);
});

test('traffic reload identity includes signed authority even when routes stay the same',()=>{
 assert.equal(typeof module?.gatewayTrafficFingerprint,'function','reporter rotation must not reuse an old child identity');
 const first=signManifest(manifest,keys.privateKey,now),rotated=signManifest({...manifest,sequence:2,reporter:{...manifest.reporter,generation:2}},keys.privateKey,now);
 assert.notEqual(module!.gatewayTrafficFingerprint([route],[],first),module!.gatewayTrafficFingerprint([route],[],rotated));
 assert.equal(module!.gatewayTrafficFingerprint([route],[],first),module!.gatewayTrafficFingerprint([route],[],structuredClone(first)));
 assert.equal(module!.gatewayTrafficFingerprint([route],[]),JSON.stringify([[route],[]]));
});
