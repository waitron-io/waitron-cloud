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
