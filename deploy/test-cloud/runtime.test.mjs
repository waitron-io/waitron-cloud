import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {runtimeEnvironment} from '../local-stack/runtime.mjs';
test('dedicated runtime selects capture mail and forwards validated dormant plan mode without ambient secrets',async t=>{
 const api=await import('./runtime.mjs').catch(()=>({}));assert.equal(typeof api.testRuntimeEnvironment,'function','dedicated test runtime is missing');
 const dir=await mkdtemp(join(tmpdir(),'cloud-test-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 for(const role of ['account','email','monitor','usage','probe','backup','gateway','manifest','reconcile','translation']){
  const value=api.testRuntimeEnvironment(role,config,{CLOUD_TEST_SERVICE_PLANS:'1',NODE_AUTH_TOKEN:'never-forward',CLOUD_TRANSLATION:'1',CLOUD_SMTP_HOST:'evil.test'});
  assert.equal(value.CLOUD_TEST_SERVICE_PLANS,'1',role);assert.equal(value.NODE_AUTH_TOKEN,undefined);assert.equal(value.CLOUD_SMTP_HOST,undefined);assert.notEqual(value.CLOUD_TRANSLATION,'1');
  assert.throws(()=>api.testRuntimeEnvironment(role,config,{CLOUD_TEST_SERVICE_PLANS:'yes'}),/test_cloud.plan_mode/);
 }
 const account=api.testRuntimeEnvironment('account',config,{});assert.equal(account.CLOUD_TEST_SERVICE_PLANS,'0');assert.equal(account.CLOUD_TRANSLATION,'0');assert.equal(account.CLOUD_HTTP_TRUSTED_PROXY_IPS,'10.79.0.2');assert.equal(account.CLOUD_PORTAL_ORIGIN,'https://waitron.local:3000');
 assert.equal(account.CLOUD_LOCAL_REQUEST_METRICS,undefined);
 assert.equal(api.testRuntimeCommand('email'),'deploy/test-cloud/email-worker.mjs');assert.equal(api.testRuntimeEnvironment('email',config,{}).CLOUD_MAIL_TRANSPORT,'test-capture');
 assert.equal(runtimeEnvironment('account',config).CLOUD_PORTAL_ORIGIN,'http://localhost:3000');
});
test('base runtime accepts only the explicit canonical origin while retaining loopback default',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cloud-origin-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 assert.equal(runtimeEnvironment('account',config,{},'https://waitron.local:3000').CLOUD_PORTAL_ORIGIN,'https://waitron.local:3000');
 assert.equal(runtimeEnvironment('email',config,{},'https://waitron.local:3000').CLOUD_PORTAL_ORIGIN,'https://waitron.local:3000');
 assert.throws(()=>runtimeEnvironment('account',config,{},'http://waitron.local:3000'),/local_stack.origin_invalid/);
});

test('test Cloud drops local AI proof settings for every runtime role',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-test-ai-boundary-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir);
 const ambient={CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'synthetic-private',CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:4010/v1',CLOUD_TRANSLATION:'1'};
 for(const role of ['migrate','account','email','monitor','usage','probe','backup','gateway','manifest','reconcile','translation']){
  const environment=testRuntimeEnvironment(role,config,ambient);
  for(const key of ['CLOUD_TRANSLATION_LOCAL_PROOF','CLOUD_OPENAI_API_KEY','CLOUD_OPENAI_BASE_URL'])assert.equal(environment[key],undefined,role+':'+key);
  if(role==='account')assert.equal(environment.CLOUD_TRANSLATION,'0');
 }
});

// Returning the base account/storage commands silently leaves the real adapters unused.
test('dedicated storage and account roles select private service adapters',async t=>{
 const api=await import('./runtime.mjs');
 assert.equal(api.testRuntimeCommand('account'),'deploy/test-cloud/account-worker.mjs');
 assert.equal(api.testRuntimeCommand('storage'),'deploy/test-cloud/storage-worker.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-services-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const storage=api.testRuntimeEnvironment('storage',config,{CLOUD_TEST_SERVICE_PLANS:'1'});
 assert.equal(storage.CLOUD_TEST_SERVICE_PLANS,'1');assert.match(storage.DATABASE_URL,/postgres:5432/);
 const account=api.testRuntimeEnvironment('account',config,{CLOUD_TEST_SERVICE_PLANS:'1'});
 assert.equal(account.NODE_EXTRA_CA_CERTS,'/run/local-stack/lan/ca.pem');
});

// The enabled project must not launch the base worker that continuously publishes zero routes.
test('test remote runtime selects real reconciliation only in enabled mode and supplies gateway trust',async t=>{
 const api=await import('./runtime.mjs'),dir=await mkdtemp(join(tmpdir(),'cloud-remote-command-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 assert.equal(api.testRuntimeCommand('manifest'),'deploy/test-cloud/remote-worker.mjs');
 const active=api.testRuntimeEnvironment('manifest',config,{CLOUD_TEST_SERVICE_PLANS:'1'});assert.match(active.DATABASE_URL,/postgres:5432/);
 assert.equal(api.testRuntimeEnvironment('manifest',config,{}).DATABASE_URL,undefined);
 assert.equal(api.testRuntimeEnvironment('account',config,{CLOUD_TEST_SERVICE_PLANS:'1'}).CLOUD_STAFF_CERTIFICATES,'1');
 assert.equal(api.testRuntimeEnvironment('account',config,{}).CLOUD_STAFF_CERTIFICATES,undefined);
 assert.equal(api.testRuntimeEnvironment('gateway',config,{}).GATEWAY_UPSTREAM_CA,'/run/local-stack/lan/ca.pem');
});

test('only the venue-level account worker receives the automatic gateway and trial accounts',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const {billingAccountOptionsFromEnv}=await import('../../packages/account-http/src/config.ts');
 const dir=await mkdtemp(join(tmpdir(),'cloud-automatic-gateway-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const accountId='f3a33048-3e2b-498a-b8b5-66e1d143cb5b';
 const input={CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_BILLING_ACCOUNT_TEST_IDS:accountId,TEST_CLOUD_TUNNEL_CELL_ID:'ignored'};
 const account=testRuntimeEnvironment('account',config,input);
 assert.equal(account.TEST_CLOUD_TUNNEL_CELL_ID,config.gateway.cellId);
 assert.deepEqual(billingAccountOptionsFromEnv(account,'test-venue-levels'),{accountIds:[accountId]});
 for(const role of ['manifest','email','gateway']){
  const environment=testRuntimeEnvironment(role,config,input);
  assert.equal(environment.TEST_CLOUD_TUNNEL_CELL_ID,undefined,role);
  assert.equal(environment.CLOUD_BILLING_ACCOUNT_TEST_IDS,undefined,role);
 }
 for(const mode of [{}, {CLOUD_TEST_SERVICE_PLANS:'1'}]){
  const environment=testRuntimeEnvironment('account',config,{...mode,CLOUD_BILLING_ACCOUNT_TEST_IDS:accountId});
  assert.equal(environment.TEST_CLOUD_TUNNEL_CELL_ID,undefined);
  assert.equal(environment.CLOUD_BILLING_ACCOUNT_TEST_IDS,undefined);
 }
});

test('test payment settings reach only the account child',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-payment-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const credentials={CLOUD_BILLING_STRIPE_TEST_ACCOUNT:'acct_synthetic',CLOUD_BILLING_STRIPE_TEST_KEY:'rk_test_synthetic',
  CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MSYNTHETIC',CLOUD_BILLING_SUMUP_SANDBOX_KEY:'synthetic-sandbox-key'};
 const input={CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_ACTION_DEMO:'1',CLOUD_BILLING_METHODS_MODE:'test',...credentials};
 const account=testRuntimeEnvironment('account',config,input);
 assert.equal(account.CLOUD_BILLING_METHODS_MODE,'test');
 for(const [key,value] of Object.entries(credentials))assert.equal(account[key],value,key);
 for(const role of ['action-demo','migrate','storage','email','monitor','usage','probe','backup','gateway','manifest','reconcile','translation']){
  const child=testRuntimeEnvironment(role,config,input);
  for(const key of ['CLOUD_BILLING_METHODS_MODE',...Object.keys(credentials)])assert.equal(child[key],undefined,role+' '+key);
 }
 for(const environment of [
  {...input,CLOUD_BILLING_METHODS_MODE:'off'}, {...input,CLOUD_BILLING_METHODS_MODE:undefined},
  {...input,CLOUD_VENUE_SERVICE_LEVELS:undefined}, {...input,CLOUD_VENUE_SERVICE_LEVELS:undefined,CLOUD_TEST_SERVICE_PLANS:'1'},
 ]){
  const child=testRuntimeEnvironment('account',config,environment);
  assert.equal(child.CLOUD_BILLING_METHODS_MODE,environment.CLOUD_VENUE_SERVICE_LEVELS==='test'?environment.CLOUD_BILLING_METHODS_MODE:undefined);
  for(const key of Object.keys(credentials))assert.equal(child[key],undefined,key);
 }
});

// A paid capture uses the advertised LAN endpoint; the verifier worker must read the same location.
test('test backup worker uses canonical storage and normal LAN trust in enabled mode',async t=>{
 const api=await import('./runtime.mjs'),dir=await mkdtemp(join(tmpdir(),'cloud-backup-command-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const value=api.testRuntimeEnvironment('backup',config,{CLOUD_TEST_SERVICE_PLANS:'1'});
 assert.equal(value.CLOUD_BACKUP_ENDPOINT,'https://waitron.local:8333');assert.equal(value.CLOUD_BACKUP_CA_FILE,'/run/local-stack/lan/ca.pem');
 assert.equal(api.testRuntimeEnvironment('backup',config,{}).CLOUD_BACKUP_ENDPOINT,'https://storage:8333');
});

// Dropping the pinned image while building the child environment makes verification unavailable.
test('test backup selects the scoped controller and forwards only explicit pinned verifier inputs',async t=>{
 const api=await import('./runtime.mjs'),dir=await mkdtemp(join(tmpdir(),'cloud-verifier-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const value=api.testRuntimeEnvironment('backup',config,{CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VERIFIER_IMAGE:'sha256:'+'a'.repeat(64),CLOUD_VERIFIER_OWNER:'foreign',CLOUD_VERIFIER_MEMORY_MIB:'4096'});
 assert.equal(api.testRuntimeCommand('backup'),'deploy/test-cloud/backup-worker.mjs');
 assert.equal(value.CLOUD_VERIFIER_IMAGE,'sha256:'+'a'.repeat(64));assert.equal(value.CLOUD_VERIFIER_OWNER,undefined);assert.equal(value.CLOUD_VERIFIER_MEMORY_MIB,undefined);
});

// Only the enabled backup worker may write its separate controller state.
test('backup runtime supplies a private controller directory independently of read-only config',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs'),dir=await mkdtemp(join(tmpdir(),'cloud-controller-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const enabled=testRuntimeEnvironment('backup',config,{CLOUD_TEST_SERVICE_PLANS:'1'});
 assert.equal(enabled.CLOUD_VERIFIER_STATE_DIR,'/run/backup-verifier');
 for(const role of ['account','storage','email','migrate'])assert.equal(testRuntimeEnvironment(role,config,{CLOUD_TEST_SERVICE_PLANS:'1'}).CLOUD_VERIFIER_STATE_DIR,undefined);
 assert.equal(testRuntimeEnvironment('backup',config,{}).CLOUD_VERIFIER_STATE_DIR,undefined);
});

test('observer sign-in policy reaches only the explicit test account process', async t => {
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const {factorConfigFromEnv}=await import('../../packages/account-http/src/config.ts');
 const {emailLoginPolicy}=await import('../../packages/account-http/test/fixtures.ts');
 const dir=await mkdtemp(join(tmpdir(),'cloud-observer-signin-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir),supplied={CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_FACTOR_POLICY:JSON.stringify(emailLoginPolicy)};
 assert.deepEqual(factorConfigFromEnv(testRuntimeEnvironment('account',config,supplied)).policy,emailLoginPolicy);
 assert.equal(testRuntimeEnvironment('account',config,{}).CLOUD_FACTOR_POLICY,undefined);
 for(const role of ['migrate','email','monitor','usage','probe','backup','gateway','manifest','reconcile','translation'])
  assert.equal(testRuntimeEnvironment(role,config,supplied).CLOUD_FACTOR_POLICY,undefined,role);
});

for(const [role,command,args,replace,hasDatabase,mode,refused,demoArgument]of [
 ['action-demo','packages/registration/src/cloud-action-cli.ts',['--fail'],false,true,'0',false],
 ['action-demo','packages/registration/src/cloud-action-cli.ts',['--drain'],false,true,'0',false,'--drain'],
 ['manifest','deploy/test-cloud/remote-worker.mjs',[],true,false,'0',false],
 ['manifest','deploy/test-cloud/remote-worker.mjs',[],true,true,'1',false],
 ['monitor','packages/registration/src/monitor-cli.ts',[],true,true,'0',false],
 ['usage','packages/registration/src/usage-reconcile-cli.ts',['--watch'],true,true,'0',false],
 ['probe','packages/remote-access/src/probe-cli.ts',[],true,true,'0',false],
 ['reconcile','packages/remote-access/src/reconciler-cli.ts',['/run/reconciler/config.json'],false,true,'0',false],
 ['usage','packages/registration/src/usage-reconcile-cli.ts',['--watch'],true,true,'0',true],
])test(`test Cloud ${role} ${demoArgument??""} mode ${mode} ${refused?'refuses an incompatible schema':'preserves its launch, exit and signal contract'}`,async t=>{
 const {spawn}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'cloud-worker-exec-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 for(const terminating of refused?[false]:[false,true]){
  const worker=`${terminating?"process.on('SIGTERM',()=>process.exit(23));":""}console.log(JSON.stringify({pid:process.pid,home:process.env.HOME,config:process.env.LOCAL_STACK_CONFIG_DIR,canary:process.env.NODE_AUTH_TOKEN}));${terminating?"setInterval(()=>{},1000)":"process.exit(37)"}`;
  const fixture=`import assert from 'node:assert/strict';import{mock}from'node:test';import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';
   const base=await import(${JSON.stringify(new URL('../local-stack/runtime.mjs',import.meta.url).href)});let checked=false,directory;
   mock.module(${JSON.stringify(new URL('../local-stack/runtime.mjs',import.meta.url).href)},{namedExports:{...base,checkConsumerDatabase:async(url,root)=>{assert.equal(url,${JSON.stringify(`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`)});assert.equal(root,'/app');checked=true;if(${refused})throw Error('synthetic-schema-refusal');}}});
   const before=process.pid,execve=process.execve,spawn=cp.spawn;process.chdir=value=>{directory=value;};
   process.execve=(file,args,environment)=>{assert.equal(${replace},true);assert.equal(checked,${hasDatabase});assert.equal(directory,'/app');assert.equal(file,process.execPath);assert.deepEqual(args,[process.execPath,...${JSON.stringify([command,...args])}]);execve(file,[file,'-e',${JSON.stringify(worker)}],environment);};
   cp.spawn=(file,args,options)=>{assert.equal(${replace},false);assert.equal(checked,${hasDatabase});assert.equal(file,process.execPath);assert.deepEqual(args,${JSON.stringify([command,...args])});assert.equal(options.cwd,'/app');return spawn(file,['-e',${JSON.stringify(worker)}],{...options,cwd:${JSON.stringify(dir)}});};syncBuiltinESMExports();
   const {launchTestRuntime}=await import(${JSON.stringify(new URL('./runtime.mjs',import.meta.url).href)});console.log('launcher='+before);
   try{process.exitCode=await launchTestRuntime(${JSON.stringify(role)},${JSON.stringify(dir)},${JSON.stringify(demoArgument)});}catch(error){if(${refused}&&error.message==='synthetic-schema-refusal')process.exitCode=29;else throw error;}`;
  const child=spawn(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',fixture],{env:{PATH:process.env.PATH,NODE_AUTH_TOKEN:'synthetic-canary',CLOUD_TEST_SERVICE_PLANS:mode,...(role==='action-demo'?{CLOUD_ACTION_DEMO:'1'}:{})},stdio:['ignore','pipe','pipe'],detached:true});
  let cleaned=false;const cleanup=()=>{if(cleaned||!child.pid)return;cleaned=true;try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
  child.once('exit',cleanup);t.after(cleanup);
  let stdout='',stderr='',sent=false;child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.stdout.on('data',chunk=>{stdout+=chunk;if(terminating&&!sent&&stdout.includes('"pid":')){sent=true;child.kill('SIGTERM');}});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.deepEqual(result,{code:refused?29:terminating?23:37,signal:null},stderr);
  const [launcher,line]=stdout.trim().split('\n');if(refused){assert.equal(line,undefined);continue;}
  const workerState=JSON.parse(line),launcherPid=Number(launcher.split('=')[1]);
  if(replace)assert.equal(workerState.pid,launcherPid);else assert.notEqual(workerState.pid,launcherPid);
  assert.equal(workerState.home,'/tmp');assert.equal(workerState.config,role==='manifest'&&mode==='0'?'/run/local-stack':dir);assert.equal(workerState.canary,undefined);
 }
});

test('configured HTTPS account and captured-mail origins preserve private service trust',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-public-origin-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 for(const role of ['account','email']){
  const value=testRuntimeEnvironment(role,config,{TEST_CLOUD_ORIGIN:'https://cloud.example.test',CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0'});
  assert.equal(value.CLOUD_PORTAL_ORIGIN,'https://cloud.example.test');
  assert.equal(value.TEST_CLOUD_ORIGIN,'https://cloud.example.test','nested launchers retain the explicit origin');
  assert.equal(value.CLOUD_TEST_SERVICE_PLANS,'0');assert.equal(value.CLOUD_VENUE_SERVICE_LEVELS,'test');
 }
 assert.equal(testRuntimeEnvironment('account',config,{TEST_CLOUD_ORIGIN:'https://cloud.example.test'}).NODE_EXTRA_CA_CERTS,'/run/local-stack/lan/ca.pem');
 assert.equal(runtimeEnvironment('email',config,{},'https://cloud.example.test').CLOUD_PORTAL_ORIGIN,'https://cloud.example.test');
 for(const origin of ['', 'http://cloud.example.test','https://cloud.example.test/','https://user:pass@cloud.example.test','https://cloud.example.test/path','https://cloud.example.test?next=evil','https://cloud.example.test#secret','https://cloud.example.test\n']){
  assert.throws(()=>testRuntimeEnvironment('account',config,{TEST_CLOUD_ORIGIN:origin}),/origin_invalid/,JSON.stringify(origin));
 }
});

test('demoModeOffByDefault: only an explicit LAN demo passes the operator to the account process',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-action-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const operator='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 assert.equal(testRuntimeEnvironment('account',config,{CLOUD_OPERATOR_ACCOUNT_ID:operator}).CLOUD_OPERATOR_ACCOUNT_ID,undefined);
 assert.throws(()=>testRuntimeEnvironment('action-demo',config,{}),/demo/);
 const enabled={CLOUD_ACTION_DEMO:'1',CLOUD_OPERATOR_ACCOUNT_ID:operator};
 assert.match(testRuntimeEnvironment('action-demo',config,enabled).DATABASE_URL,/postgres:5432/);
 assert.equal(testRuntimeEnvironment('action-demo',config,enabled).CLOUD_ACTION_DEMO,'1');
 assert.equal(testRuntimeEnvironment('account',config,enabled).CLOUD_OPERATOR_ACCOUNT_ID,operator);
 for(const role of ['email','monitor','storage'])assert.equal(testRuntimeEnvironment(role,config,enabled).CLOUD_OPERATOR_ACCOUNT_ID,undefined);
 assert.throws(()=>testRuntimeEnvironment('account',config,{...enabled,NODE_ENV:'production'}),/demo/);
});

test('public remote settings persist a separate private ACME account and pass only to the Amazon worker',async t=>{
 const {loadPublicRemoteSettings}=await import('./remote-runtime.mjs');assert.equal(typeof loadPublicRemoteSettings,'function','public remote settings missing');
 const {readFile,stat}=await import('node:fs/promises'),dir=await mkdtemp(join(tmpdir(),'cloud-public-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 assert.equal(await loadPublicRemoteSettings(dir,{}),undefined);
 const env={TEST_CLOUD_PUBLIC_REMOTE:'1',TEST_CLOUD_ORIGIN:'https://test-cloud.example.test',TEST_CLOUD_ACME_DIRECTORY:'https://ca.example.test/dir',TEST_CLOUD_CHALLENGE_DIR:join(dir,'challenges')};
 const settings=await loadPublicRemoteSettings(dir,env),again=await loadPublicRemoteSettings(dir,env);
 assert.equal(settings.zone,'test-cloud.example.test');assert.equal(settings.endpoint,'test-cloud.example.test:51820');assert.equal(settings.directoryUrl,env.TEST_CLOUD_ACME_DIRECTORY);assert.equal(settings.challengeDirectory,env.TEST_CLOUD_CHALLENGE_DIR);assert.deepEqual(again.accountKey,settings.accountKey);
 assert.equal((await stat(join(dir,'acme/account-key.pem'))).mode&0o777,0o600);assert.notEqual(settings.accountKey,await readFile(join(dir,'gateway-signing-key.pem'),'utf8'));
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 for(const role of ['account','manifest','gateway','email']){const value=testRuntimeEnvironment(role,config,env);assert.equal(value.TEST_CLOUD_PUBLIC_REMOTE,role==='manifest'?'1':undefined);assert.equal(value.TEST_CLOUD_ACME_DIRECTORY,role==='manifest'?env.TEST_CLOUD_ACME_DIRECTORY:undefined);assert.equal(value.GATEWAY_PROXY_SOURCE,role==='gateway'?'10.79.0.2':undefined);}
 for(const changed of [{TEST_CLOUD_PUBLIC_REMOTE:'yes'},{TEST_CLOUD_ORIGIN:'http://cloud.example.test'},{TEST_CLOUD_ACME_DIRECTORY:'http://ca.example.test/dir'},{TEST_CLOUD_CHALLENGE_DIR:'relative'}])await assert.rejects(loadPublicRemoteSettings(dir,{...env,...changed}));
});

test('Amazon challenge paths reach only worker and gateway',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-challenge-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir);
 const worker={TEST_CLOUD_TLS_CHALLENGE_DIR:'/run/remote-tls-challenges',TEST_CLOUD_GATEWAY_STATUS_DIR:'/run/remote-gateway-status'};
 const gateway={GATEWAY_CHALLENGES:worker.TEST_CLOUD_TLS_CHALLENGE_DIR,GATEWAY_STATUS_DIR:worker.TEST_CLOUD_GATEWAY_STATUS_DIR};
 const supplied={...worker,...gateway};
 for(const flag of ['0','1'])for(const role of ['manifest','gateway','account','email','reconcile']){
  const value=testRuntimeEnvironment(role,config,{TEST_CLOUD_PUBLIC_REMOTE:flag,...supplied});
  const expected=flag==='1'?(role==='manifest'?worker:role==='gateway'?gateway:{}):{};
  assert.deepEqual(Object.fromEntries(Object.keys(supplied).filter(name=>name in value).map(name=>[name,value[name]])),expected,role);
 }
});

test('public remote settings refuse half-configured or shared challenge directories',async t=>{
 const {loadPublicRemoteSettings}=await import('./remote-runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-challenge-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={TEST_CLOUD_PUBLIC_REMOTE:'1',TEST_CLOUD_ORIGIN:'https://test-cloud.example.test',
  TEST_CLOUD_ACME_DIRECTORY:'https://ca.example.test/dir',TEST_CLOUD_CHALLENGE_DIR:join(dir,'http')};
 const tls=join(dir,'tls'),status=join(dir,'status');
 for(const paths of [
  {TEST_CLOUD_TLS_CHALLENGE_DIR:tls},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:'relative',TEST_CLOUD_GATEWAY_STATUS_DIR:status},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:tls,TEST_CLOUD_GATEWAY_STATUS_DIR:tls+'/.'},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:env.TEST_CLOUD_CHALLENGE_DIR,TEST_CLOUD_GATEWAY_STATUS_DIR:status},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:tls,TEST_CLOUD_GATEWAY_STATUS_DIR:join(tls,'status')},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:join(status,'tls'),TEST_CLOUD_GATEWAY_STATUS_DIR:status},
  {TEST_CLOUD_TLS_CHALLENGE_DIR:join(env.TEST_CLOUD_CHALLENGE_DIR,'tls'),TEST_CLOUD_GATEWAY_STATUS_DIR:status}
 ])await assert.rejects(loadPublicRemoteSettings(dir,{...env,...paths}),/test_cloud.remote_settings/);
});

test('the Amazon worker refuses custom names without a TLS challenge',async()=>{
 const {crypto}=createRequire(new URL('../../packages/remote-access/package.json',import.meta.url))('acme-client');
 const {issueTestRemoteCertificate}=await import('./remote-runtime.mjs');
 const hostname='menu.cafe.example.test',[,csr]=await crypto.createCsr({commonName:hostname,altNames:[hostname]});
 const signal=new AbortController().signal;
 // The refusal must happen before the issuer needs an ACME directory or account key.
 for(const validation of [undefined,{type:'dns-01'}]){
  await assert.rejects(issueTestRemoteCertificate(undefined,{hostname,csr:csr.toString(),signal,validation},
   {zone:'test-cloud.example.test'}),{message:'test_cloud.remote_target'});
 }
});

test('guest publication and its reader are configured only for the enabled Amazon test account',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-guest-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir),input={TEST_CLOUD_ORIGIN:'https://cloud.example.test',CLOUD_VENUE_SERVICE_LEVELS:'test',TEST_CLOUD_AMAZON:'1',TEST_CLOUD_GUEST_MENU:'1'};
 const child=testRuntimeEnvironment('account',config,input);
 assert.equal(child.GUEST_ORIGIN,'https://menus.cloud.example.test');
 for(const change of [{TEST_CLOUD_AMAZON:undefined},{CLOUD_VENUE_SERVICE_LEVELS:undefined},{NODE_ENV:'production'},{TEST_CLOUD_GUEST_MENU:'0'}])
  assert.equal(testRuntimeEnvironment('account',config,{...input,...change}).GUEST_ORIGIN,undefined);
 assert.equal(testRuntimeEnvironment('email',config,input).GUEST_ORIGIN,undefined);
});

test('Amazon capture advertises HTTPS while the verifier keeps its private storage endpoint',async t=>{
 const {testRuntimeEnvironment}=await import('./runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'cloud-amazon-backup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir);
 const flags={TEST_CLOUD_AMAZON:'1',CLOUD_TEST_AMAZON_BACKUPS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test',TEST_CLOUD_ORIGIN:'https://cloud.example.test',CLOUD_VERIFIER_IMAGE:'sha256:'+'a'.repeat(64)};
 const account=testRuntimeEnvironment('account',config,flags),worker=testRuntimeEnvironment('backup',config,flags);
 assert.equal(account.CLOUD_TEST_AMAZON_BACKUPS,'1');
 assert.equal(account.CLOUD_VERIFIER_IMAGE,undefined);
 assert.equal(worker.CLOUD_TEST_AMAZON_BACKUPS,'1');
 assert.equal(worker.CLOUD_BACKUP_ENDPOINT,'https://waitron.local:8333');
 assert.equal(worker.CLOUD_VERIFIER_IMAGE,flags.CLOUD_VERIFIER_IMAGE);
 assert.equal(testRuntimeEnvironment('email',config,flags).CLOUD_TEST_AMAZON_BACKUPS,undefined);
 for(const change of [{TEST_CLOUD_AMAZON:undefined},{NODE_ENV:'production'},{CLOUD_VENUE_SERVICE_LEVELS:undefined},{TEST_CLOUD_ORIGIN:undefined},{TEST_CLOUD_ORIGIN:'https://cloud.example.test:8333'}])
  assert.throws(()=>testRuntimeEnvironment('account',config,{...flags,...change}),/test_cloud.amazon_backups/);
});

test('capture setup refuses a public upload address outside the Amazon HTTPS shape',async()=>{
 const {openTestCaptureRuntime}=await import('./service-runtime.mjs');
 await assert.rejects(openTestCaptureRuntime({mode:'test-free-paid',uploadOrigin:'https://cloud.example.test'}),/test_cloud.amazon_backups/);
 await assert.rejects(openTestCaptureRuntime({mode:'test-venue-levels',uploadOrigin:'https://cloud.example.test:8333'}),/test_cloud.amazon_backups/);
});
