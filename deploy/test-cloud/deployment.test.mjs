import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

// The controller must persist its private child journal while configuration stays read-only.
test('unavailable backup profile has its own writable controller volume and read-only configuration',()=>{
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_AUTH_TOKEN:'not-a-credential'}}));
 const worker=value.services['backup-worker'],config=worker.volumes.find(v=>v.target==='/run/local-stack'),state=worker.volumes.find(v=>v.target==='/run/backup-verifier');
 assert.equal(config.read_only,true);assert.ok(state,'backup controller has no writable private state');assert.equal(state.type,'volume');assert.notEqual(state.source,config.source);assert.notEqual(state.read_only,true);assert.ok(worker.profiles.includes('unavailable'));
 for(const [name,service] of Object.entries(value.services))if(name!=='backup-worker')assert.ok(!service.volumes?.some(v=>v.source===state.source),name+' can access private verifier state');
});

test('Amazon override configures HTTPS without publishing database, mail or internal storage',async()=>{
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,TEST_CLOUD_ORIGIN:'https://cloud.example.test',TEST_CLOUD_CERTIFICATE_SOURCE:'/tmp/synthetic-certificates'}}));
 const{validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');assert.equal(validateDeployment(value,{image:value.services.account.image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/tmp/synthetic-certificates'}).ready,true);
 assert.equal(value.services.account.environment.CLOUD_VENUE_SERVICE_LEVELS,'test');
 assert.deepEqual(value.services.proxy.ports.map(p=>[p.host_ip,p.published,p.target]),[['0.0.0.0','443',3000]]);
 for(const name of ['account','postgres','mailpit','storage','gateway'])assert.equal(value.services[name].ports,undefined,name);
 for(const name of ['bootstrap','account','email-worker'])assert.equal(value.services[name].environment.TEST_CLOUD_ORIGIN,'https://cloud.example.test');
 assert.equal(value.services.bootstrap.environment.TEST_CLOUD_CERTIFICATE_SOURCE,'/run/public-certificate');
 assert.ok(value.services.bootstrap.volumes.some(v=>v.type==='bind'&&v.source==='/tmp/synthetic-certificates'&&v.target==='/run/public-certificate'&&v.read_only));
 for(const [name,service]of Object.entries(value.services)){
  if(name!=='bootstrap')assert.ok(!service.volumes?.some(v=>v.type==='bind'),name);
  assert.ok(!service.volumes?.some(v=>v.source?.includes('docker.sock')),name);
  assert.notEqual(service.environment?.CLOUD_TRANSLATION,'1');
 }
 const proxy=value.services.proxy,temporary=mkdtempSync(join(tmpdir(),'cloud-proxy-environment-'));
 try{
  writeFileSync(join(temporary,'haproxy'),`#!${process.execPath}\nconsole.log(JSON.stringify({host:process.env.TEST_CLOUD_HOST,origin:process.env.TEST_CLOUD_ORIGIN,certificate:process.env.TEST_CLOUD_CERTIFICATE}));\n`,{mode:0o700});
  // Compose serializes dollars escaped; container creation removes that escape.
  const actual=JSON.parse(execFileSync(proxy.command[0],proxy.command.slice(1).map(v=>v.replaceAll('$$','$')),{encoding:'utf8',env:{...proxy.environment,PATH:temporary+':'+process.env.PATH}}));
  assert.deepEqual(actual,{host:'cloud.example.test',origin:'https://cloud.example.test',certificate:'/run/proxy-certificate/proxy.pem'});
 }finally{rmSync(temporary,{recursive:true,force:true});}
 const bundle=value.services.bootstrap.volumes.find(v=>v.target==='/run/proxy-certificate');assert.equal(bundle.type,'volume');assert.notEqual(bundle.read_only,true);
 assert.ok(value.services.proxy.volumes.some(v=>v.source===bundle.source&&v.read_only));
 for(const[name,service]of Object.entries(value.services))if(!['bootstrap','proxy'].includes(name))assert.ok(!service.volumes?.some(v=>v.source===bundle.source),name+' must not read the public private key');
 assert.ok(value.services.account.healthcheck.test.includes('https://cloud.example.test'));
 assert.ok(value.services.proxy.healthcheck.test.some(v=>v.includes('cloud.example.test')));
});

// Exercise the emitted template through Docker, including the health guard's input.
test('driver inventory preserves absent, healthy and unhealthy states for its resource guard',{timeout:30000},async t=>{
 const {inventory,execute,resourceGuard}=await import('../../scripts/test-cloud-deploy.mjs'),ids=[];
 const docker=async args=>(await execute('docker',args)).trim();
 t.after(async()=>{if(ids.length)await docker(['rm','--force',...ids]);});
 const absent=await docker(['create','--network','none','--no-healthcheck','--entrypoint','sh','postgres:18-alpine','-c','sleep 60']);ids.push(absent);
 const watched=await docker(['create','--network','none','--memory','32m','--read-only','--tmpfs','/tmp:size=1m','--health-cmd','test ! -f /tmp/unhealthy','--health-interval','100ms','--health-retries','1','--entrypoint','sh','postgres:18-alpine','-c','sleep 60']);ids.push(watched);
 const read=()=>inventory(async(command,args,options)=>{
  if(command==='ss'||command==='lsof')return '';
  if(command==='docker'&&args[0]==='ps')return [
   {ID:absent,Names:'inventory-fixture',State:'created',Labels:'com.docker.compose.project=waitron-cloud-test'},
   {ID:watched,Names:'waitron-app-1',State:'running',Labels:'com.docker.compose.project=waitron'}
  ].map(row=>JSON.stringify(row)).join('\n');
  return execute(command,args,options);
 });
 const wait=async status=>{for(let n=0;n<80;n++){
  if(JSON.parse(await docker(['inspect','--format','{{json .State}}',watched])).Health?.Status===status)return;
  await new Promise(resolve=>setTimeout(resolve,100));
 }assert.fail('owned container never became '+status);};
 await docker(['start',watched]);await wait('healthy');const before=await read();
 assert.deepEqual(before.containers,[{id:absent,project:'waitron-cloud-test',name:'inventory-fixture',state:'created',oom:false,health:null},{id:watched,project:'waitron',name:'waitron-app-1',state:'running',oom:false,health:'healthy'}]);
 await docker(['exec',watched,'touch','/tmp/unhealthy']);await wait('unhealthy');const after=await read();
 assert.equal(after.containers.find(row=>row.id===watched).health,'unhealthy');
 assert.throws(()=>resourceGuard({...before,availableMiB:5000,freeGiB:30},{...after,availableMiB:5000,freeGiB:30}),/test_cloud.waitron_health/);
});
