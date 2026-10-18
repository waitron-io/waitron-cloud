import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

// A paid capture uses the advertised LAN endpoint; the verifier worker must read the same location.
test('test backup worker uses canonical storage and normal LAN trust in enabled mode',async t=>{
 const api=await import('./runtime.mjs'),dir=await mkdtemp(join(tmpdir(),'cloud-backup-command-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=await bootstrap(dir);
 const value=api.testRuntimeEnvironment('backup',config,{CLOUD_TEST_SERVICE_PLANS:'1'});
 assert.equal(value.CLOUD_BACKUP_ENDPOINT,'https://waitron.local:8333');assert.equal(value.CLOUD_BACKUP_CA_FILE,'/run/local-stack/lan/ca.pem');
 assert.equal(api.testRuntimeEnvironment('backup',config,{}).CLOUD_BACKUP_ENDPOINT,'https://storage:8333');
});
