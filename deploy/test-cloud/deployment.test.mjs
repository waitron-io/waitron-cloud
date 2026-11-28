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

test('Amazon payment method settings reach only the account service',()=>{
 const settings={CLOUD_BILLING_METHODS_MODE:'test',CLOUD_BILLING_STRIPE_TEST_ACCOUNT:'acct_synthetic',
  CLOUD_BILLING_STRIPE_TEST_KEY:'rk_test_synthetic',CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MSYNTHETIC',
  CLOUD_BILLING_SUMUP_SANDBOX_KEY:'synthetic-sandbox-key'};
 const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('CLOUD_BILLING_'))),
  TEST_CLOUD_ORIGIN:'https://cloud.example.test',TEST_CLOUD_CERTIFICATE_SOURCE:'/tmp/synthetic-certificates'};
 const render=environment=>JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env',
  '-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml','config','--format','json'],
  {cwd:root,encoding:'utf8',env:environment})).services;
 const services=render({...env,...settings});
 for(const [key,value] of Object.entries(settings)){
  assert.equal(services.account.environment[key],value,key);
  for(const [name,service] of Object.entries(services))if(name!=='account')assert.equal(service.environment?.[key],undefined,name+' '+key);
 }
 assert.equal(render(env).account.environment.CLOUD_BILLING_METHODS_MODE,'off');
});

test('Amazon gateway receives the configured remote certificate issuer',()=>{
 const render=directory=>JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env',
  '-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml','config','--format','json'],
 {cwd:root,encoding:'utf8',env:{...process.env,TEST_CLOUD_ORIGIN:'https://cloud.example.test',
  TEST_CLOUD_CERTIFICATE_SOURCE:'/tmp/synthetic-certificates',TEST_CLOUD_ACME_DIRECTORY:directory}})).services;
 const trusted='https://acme-v02.api.letsencrypt.org/directory';
 const staging='https://acme-staging-v02.api.letsencrypt.org/directory';
 for(const [configured,expected] of [[trusted,trusted],['',staging]]){
  const services=render(configured);
  assert.equal(services.gateway.environment.TEST_CLOUD_AMAZON,'1');
  assert.equal(services.gateway.environment.TEST_CLOUD_ACME_DIRECTORY,expected);
  assert.equal(services['gateway-manifest'].environment.TEST_CLOUD_ACME_DIRECTORY,expected);
 }
});

test('Amazon override configures HTTPS without publishing database, mail or internal storage',async()=>{
 const accountId='f3a33048-3e2b-498a-b8b5-66e1d143cb5b';
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml','config','--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,TEST_CLOUD_ORIGIN:'https://cloud.example.test',TEST_CLOUD_CERTIFICATE_SOURCE:'/tmp/synthetic-certificates',CLOUD_BILLING_ACCOUNT_TEST_IDS:accountId}}));
 const{validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');assert.equal(validateDeployment(value,{image:value.services.account.image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/tmp/synthetic-certificates'}).ready,true);
 assert.equal(value.services.account.environment.CLOUD_VENUE_SERVICE_LEVELS,'test');
 assert.equal(value.services.account.environment.CLOUD_BILLING_ACCOUNT_TEST_IDS,accountId);
 for(const [name,service] of Object.entries(value.services))if(name!=='account')assert.equal(service.environment?.CLOUD_BILLING_ACCOUNT_TEST_IDS,undefined,name);
 assert.deepEqual(value.services.proxy.ports.map(p=>[p.host_ip,p.published,p.target]),[['0.0.0.0','443',443]]);
 for(const name of ['account','postgres','mailpit','storage'])assert.equal(value.services[name].ports,undefined,name);
 assert.deepEqual(value.services.gateway.ports.map(p=>[p.host_ip,p.published,p.target,p.protocol]),[['0.0.0.0','51820',51820,'udp']]);
 const challenge=value.services['http-challenges'];assert.ok(challenge,'independent challenge listener missing');assert.equal(challenge.restart,'unless-stopped');assert.deepEqual(challenge.ports.map(p=>[p.host_ip,p.published,p.target,p.protocol]),[['0.0.0.0','80',8080,'tcp']]);assert.equal(challenge.depends_on,undefined);assert.equal(Number(challenge.mem_limit),64*1024*1024);assert.ok(challenge.volumes.every(v=>v.read_only));assert.deepEqual(challenge.volumes.map(v=>v.target).sort(),['/run/account-webroot','/run/remote-challenges']);
 assert.equal(value.services['gateway-manifest'].environment.TEST_CLOUD_PUBLIC_REMOTE,'1');assert.equal(value.services.gateway.environment.TEST_CLOUD_PUBLIC_REMOTE,'1');
 assert.ok(value.services['gateway-manifest'].volumes.some(v=>v.source==='test-cloud-http-challenges'&&!v.read_only));
 for(const [service,variable,path] of [
  ['gateway-manifest','TEST_CLOUD_TLS_CHALLENGE_DIR','/run/remote-tls-challenges'],
  ['gateway-manifest','TEST_CLOUD_GATEWAY_STATUS_DIR','/run/remote-gateway-status'],
  ['gateway','GATEWAY_CHALLENGES','/run/remote-tls-challenges'],
  ['gateway','GATEWAY_STATUS_DIR','/run/remote-gateway-status']
 ])assert.equal(value.services[service].environment[variable],path);
 assert.ok(Object.values(value.services).reduce((sum,v)=>sum+Number(v.mem_limit),0)<=2112*1024*1024);
 for(const name of ['bootstrap','account','email-worker'])assert.equal(value.services[name].environment.TEST_CLOUD_ORIGIN,'https://cloud.example.test');
 assert.equal(value.services.bootstrap.environment.TEST_CLOUD_CERTIFICATE_SOURCE,'/run/public-certificate');
 assert.ok(value.services.bootstrap.volumes.some(v=>v.type==='bind'&&v.source==='/tmp/synthetic-certificates'&&v.target==='/run/public-certificate'&&v.read_only));
 for(const [name,service]of Object.entries(value.services)){
  if(!['bootstrap','http-challenges'].includes(name))assert.ok(!service.volumes?.some(v=>v.type==='bind'),name);
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
 const absent=await docker(['create','--pull','never','--network','none','--no-healthcheck','--entrypoint','sh','postgres:18-alpine','-c','sleep 60']);ids.push(absent);
 const watched=await docker(['create','--pull','never','--network','none','--memory','32m','--read-only','--tmpfs','/tmp:size=1m','--health-cmd','test ! -f /tmp/unhealthy','--health-interval','100ms','--health-retries','1','--entrypoint','sh','postgres:18-alpine','-c','sleep 60']);ids.push(watched);
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
 assert.equal(resourceGuard({...before,availableMiB:5000,freeGiB:30},{...before,availableMiB:5000,freeGiB:30}),0);
 await docker(['exec',watched,'touch','/tmp/unhealthy']);await wait('unhealthy');const after=await read();
 assert.equal(after.containers.find(row=>row.id===watched).health,'unhealthy');
 assert.throws(()=>resourceGuard({...before,availableMiB:5000,freeGiB:30},{...after,availableMiB:5000,freeGiB:30}),/test_cloud.waitron_health/);
});

test('the Amazon guest setting reaches only its private reader, certificate import and proxy',()=>{
 const files=['-f','compose.yaml','-f','deploy/test-cloud/compose.yaml'];
 const render=extra=>JSON.parse(execFileSync('docker',['compose','--env-file','deploy/test-cloud/test.env',...files,...extra,'config','--format','json'],{
  cwd:root,encoding:'utf8',env:{...process.env,TEST_CLOUD_GUEST_MENU:'1',TEST_CLOUD_LIVE_GUEST_MENU:'1',TEST_CLOUD_ORIGIN:'https://cloud.example.test',TEST_CLOUD_CERTIFICATE_SOURCE:'/tmp/synthetic-certificates'}
 })).services;
 const lan=render([]),amazon=render(['-f','deploy/test-cloud/compose.amazon.yaml']);
 for(const service of Object.values(lan)){
  assert.equal(service.environment?.TEST_CLOUD_GUEST_MENU,undefined);
  assert.equal(service.environment?.TEST_CLOUD_LIVE_GUEST_MENU,undefined);
 }
 for(const [name,service] of Object.entries(amazon))
  assert.equal(service.environment?.TEST_CLOUD_GUEST_MENU,['account','bootstrap','proxy'].includes(name)?'1':undefined,name);
 for(const [name,service] of Object.entries(amazon))
  assert.equal(service.environment?.TEST_CLOUD_LIVE_GUEST_MENU,name==='account'?'1':undefined,name);
 assert.equal(amazon.account.environment.TEST_CLOUD_AMAZON,'1');
 assert.equal(amazon.account.ports,undefined);
 const bootstrap=amazon.bootstrap.volumes.find(v=>v.target==='/run/proxy-certificate');
 for(const [name,service] of Object.entries(amazon))
  if(name!=='bootstrap'&&name!=='proxy')assert.ok(!service.volumes?.some(v=>v.source===bootstrap.source),name);
 assert.equal(amazon.proxy.volumes.find(v=>v.source===bootstrap.source).read_only,true);
});

test('the Amazon backup override activates only its intended worker and retains the host budget',async()=>{
 const {validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');
 const backupVerifierImage='sha256:'+'e'.repeat(64);
 const origin='https://cloud.example.test',certificateSource='/tmp/synthetic-certificates';
 const render=(withBackups,allProfiles)=>JSON.parse(execFileSync('docker',['compose',
  ...(allProfiles?['--profile','*']:[]),'--env-file','deploy/test-cloud/test.env',
  '-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml',
  ...(withBackups?['-f','deploy/test-cloud/compose.amazon-backups.yaml']:[]),'config','--format','json'],
  {cwd:root,encoding:'utf8',env:{...process.env,TEST_CLOUD_ORIGIN:origin,TEST_CLOUD_CERTIFICATE_SOURCE:certificateSource,CLOUD_VERIFIER_IMAGE:backupVerifierImage}}));
 const enabled=render(true,true),active=render(true,false),usual=render(false,false);
 assert.equal(validateDeployment(enabled,{image:enabled.services.account.image,target:'amazon',origin,certificateSource,backupVerifierImage}).ready,true);
 assert.ok(active.services['backup-worker']);
 assert.equal(usual.services['backup-worker'],undefined);
 for(const name of ['remote-reconciler','translation-worker','operations-collector'])
  assert.equal(active.services[name],undefined);
 for(const [name,service] of Object.entries(active.services)){
  assert.equal(service.volumes?.some(v=>v.source==='/var/run/docker.sock')??false,name==='backup-worker',name);
 }
});

for(const backups of [false,true])test(`the Amazon SES overlay isolates its settings with backups ${backups?'on':'off'}`,async()=>{
 const {validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');
 const origin='https://cloud.example.test',certificateSource='/tmp/synthetic-certificates',sesSettingsSource='/tmp/synthetic-ses-settings.json';
 const backupVerifierImage=backups?'sha256:'+'e'.repeat(64):undefined;
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env',
  '-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml',
  '-f','deploy/test-cloud/compose.amazon-ses.yaml',...(backups?['-f','deploy/test-cloud/compose.amazon-backups.yaml']:[]),'config','--format','json'],{cwd:root,encoding:'utf8',
  env:{...process.env,TEST_CLOUD_ORIGIN:origin,TEST_CLOUD_CERTIFICATE_SOURCE:certificateSource,TEST_CLOUD_SES_SETTINGS_SOURCE:sesSettingsSource,CLOUD_VERIFIER_IMAGE:backupVerifierImage??''}}));
 assert.equal(validateDeployment(value,{image:value.services.account.image,target:'amazon',origin,certificateSource,sesSettingsSource,backupVerifierImage}).ready,true);
 if(backups)assert.equal(value.services['backup-worker'].environment.CLOUD_VERIFIER_IMAGE,backupVerifierImage);
 const worker=value.services['email-worker'];
 assert.equal(worker.environment.TEST_CLOUD_AMAZON_SES,'1');
 const mount=worker.volumes.find(v=>v.target==='/run/test-cloud-ses.json');
 assert.equal(mount.source,sesSettingsSource);assert.equal(mount.read_only,true);
 for(const [name,service] of Object.entries(value.services)){
  if(name==='email-worker')continue;
  assert.equal(service.environment?.TEST_CLOUD_AMAZON_SES,undefined,name);
  assert.ok(!service.volumes?.some(v=>v.source===sesSettingsSource),name);
 }
});

test('the Amazon venue SES overlay renders both private mounts on the email worker',async()=>{
 const {validateDeployment}=await import('../../scripts/test-cloud-deploy.mjs');
 const origin='https://cloud.example.test',certificateSource='/tmp/synthetic-certificates';
 const sesSettingsSource='/tmp/synthetic-account-settings.json',venueSesSettingsSource='/tmp/synthetic-venue-settings.json';
 const value=JSON.parse(execFileSync('docker',['compose','--profile','*','--env-file','deploy/test-cloud/test.env',
  '-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml',
  '-f','deploy/test-cloud/compose.amazon-venue-ses.yaml','config','--format','json'],{cwd:root,encoding:'utf8',
  env:{...process.env,TEST_CLOUD_ORIGIN:origin,TEST_CLOUD_CERTIFICATE_SOURCE:certificateSource,
   TEST_CLOUD_SES_SETTINGS_SOURCE:sesSettingsSource,TEST_CLOUD_VENUE_SES_SETTINGS_SOURCE:venueSesSettingsSource}}));
 assert.equal(validateDeployment(value,{image:value.services.account.image,target:'amazon',origin,certificateSource,sesSettingsSource,venueSesSettingsSource}).ready,true);
});
