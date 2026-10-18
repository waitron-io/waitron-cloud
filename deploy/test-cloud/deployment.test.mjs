import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {existsSync} from 'node:fs';
const root=new URL('../../',import.meta.url).pathname;
test('LAN override replaces ports, isolates private state and keeps independent launch gates off',async()=>{
 assert.ok(existsSync(new URL('compose.yaml',import.meta.url)),'LAN override is missing');
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_AUTH_TOKEN:'not-a-credential'}}));
 const {validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');assert.equal(validateDeployment(value,{image:value.services.account.image}).ready,true);const excessive=structuredClone(value);excessive.services.account.mem_limit=String(4096*1024*1024);assert.throws(()=>validateDeployment(excessive,{image:value.services.account.image}),/test_cloud.rendered/);
 assert.equal(value.services.account.networks.default.ipv4_address,'10.79.0.3');assert.equal(value.name,'waitron-cloud-test');assert.deepEqual(value.services.account.ports,undefined);
 assert.deepEqual(value.services.proxy.ports.map(p=>[p.host_ip,p.published,p.target]),[['192.168.10.10','3000',3000]]);
 for(const service of ['postgres','mailpit','storage','gateway'])for(const port of value.services[service].ports)assert.equal(port.host_ip,'127.0.0.1',service);
 assert.equal(value.services.mailpit.ports.length,2);assert.equal(value.services.postgres.ports.length,1);
 for(const [name,service] of Object.entries(value.services)){
  assert.equal(service.build,undefined,name);assert.ok(!service.volumes?.some(v=>v.type==='bind'),name);
  assert.equal(service.logging.options['max-size'],'5m');assert.equal(service.logging.options['max-file'],'2');assert.ok(service.mem_limit>0,name);
  if(service.environment?.CLOUD_TEST_SERVICE_PLANS!==undefined)assert.equal(service.environment.CLOUD_TEST_SERVICE_PLANS,'0');
  assert.notEqual(service.environment?.CLOUD_TRANSLATION,'1');
 }
 assert.ok(value.services['translation-worker'].profiles.includes('unavailable'));
 assert.ok(value.services['remote-reconciler'].profiles.includes('unavailable'));
 assert.ok(Object.values(value.volumes).every(v=>v.name.startsWith('waitron-cloud-test_')));
 assert.ok(Object.values(value.services).reduce((sum,s)=>sum+Number(s.mem_limit),0)<=2048*1024*1024);
});

test('test storage role owns its issuer and exposes a canonical internal name without Docker authority',()=>{
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_AUTH_TOKEN:'not-a-credential'}}));
 assert.deepEqual(value.services.storage.command,['node','deploy/test-cloud/runtime.mjs','storage']);
 assert.ok(value.services.storage.networks.default.aliases.includes('waitron.local'));
 assert.ok(value.services.storage.volumes.some(v=>v.target==='/run/local-stack'&&!v.read_only));
 assert.ok(value.services.account.volumes.some(v=>v.target==='/run/local-stack'&&!v.read_only));
 assert.equal(value.services.account.depends_on.storage.condition,'service_healthy');
 for(const role of ['account','storage'])assert.ok(!value.services[role].volumes.some(v=>v.source?.includes('docker.sock')));
});
