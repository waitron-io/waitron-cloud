import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {existsSync} from 'node:fs';
const root=new URL('../../',import.meta.url).pathname;
test('LAN override replaces ports, isolates private state and keeps independent launch gates off',()=>{
 assert.ok(existsSync(new URL('compose.yaml',import.meta.url)),'LAN override is missing');
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_AUTH_TOKEN:'not-a-credential'}}));
 assert.equal(value.name,'waitron-cloud-test');assert.deepEqual(value.services.account.ports,undefined);
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
