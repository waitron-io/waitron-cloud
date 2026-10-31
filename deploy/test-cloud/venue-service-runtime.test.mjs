import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';
import {parsePlanMode} from '../../packages/registration/src/organisation-plans.ts';

const roles=['account','storage','backup','manifest','reconcile','translation','email','migrate','monitor','usage','probe','gateway'];
for(const role of roles)test(`venue runtime forwards explicit test authority to ${role} without provider inputs`,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const config=await bootstrap(directory);
 const value=testRuntimeEnvironment(role,config,{CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'1',CLOUD_ADDRESS_LOOKUP:'1',GOOGLE_MAPS_API_KEY:'fake-only',GEOAPIFY_API_KEY:'fake-only',CLOUD_OPENAI_API_KEY:'fake-only',CLOUD_SMTP_HOST:'outside.test',NODE_AUTH_TOKEN:'fake-only',CLOUD_VERIFIER_IMAGE:'sha256:'+'a'.repeat(64)});
 assert.equal(value.CLOUD_VENUE_SERVICE_LEVELS,'test');assert.equal(value.CLOUD_TEST_SERVICE_PLANS,'0');
 assert.equal(parsePlanMode(value.CLOUD_TEST_SERVICE_PLANS,value.CLOUD_VENUE_SERVICE_LEVELS),'test-venue-levels');
 for(const key of ['CLOUD_ADDRESS_LOOKUP','GOOGLE_MAPS_API_KEY','GEOAPIFY_API_KEY','CLOUD_OPENAI_API_KEY','CLOUD_SMTP_HOST','NODE_AUTH_TOKEN'])assert.equal(value[key],undefined,key);
 assert.notEqual(value.CLOUD_TRANSLATION,'1');
 if(role==='account'){assert.equal(value.CLOUD_TRANSLATION,'0');assert.equal(value.CLOUD_STAFF_CERTIFICATES,'1');}
 if(['storage','manifest','reconcile'].includes(role))assert.match(value.DATABASE_URL,/postgres:5432/);
 if(role==='email')assert.equal(value.CLOUD_MAIL_TRANSPORT,'test-capture');
 if(role==='backup'){
  assert.equal(value.CLOUD_BACKUP_ENDPOINT,'https://waitron.local:8333');assert.equal(value.CLOUD_BACKUP_CA_FILE,'/run/local-stack/lan/ca.pem');
  assert.equal(value.CLOUD_VERIFIER_STATE_DIR,'/run/backup-verifier');assert.equal(value.CLOUD_VERIFIER_IMAGE,'sha256:'+'a'.repeat(64));
 }else assert.equal(value.CLOUD_VERIFIER_STATE_DIR,undefined);
});

test('venue runtime rejects conflicting or malformed flags before reading configuration',()=>{
 for(const environment of [
  {CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},
  {CLOUD_VENUE_SERVICE_LEVELS:'1'}, {CLOUD_VENUE_SERVICE_LEVELS:''},
  {CLOUD_VENUE_SERVICE_LEVELS:'production'}, {CLOUD_TEST_SERVICE_PLANS:'yes'},
  {CLOUD_TEST_SERVICE_PLANS:'yes',CLOUD_VENUE_SERVICE_LEVELS:'test'},
 ])for(const role of roles)assert.throws(()=>testRuntimeEnvironment(role,null,environment),/test_cloud.plan_mode/);
});

test('venue runtime leaves both historical modes unchanged when its flag is dormant',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-dormant-'));t.after(()=>rm(directory,{recursive:true,force:true}));const config=await bootstrap(directory);
 for(const role of roles)for(const flag of ['0','1']){
  const absent=testRuntimeEnvironment(role,config,{CLOUD_TEST_SERVICE_PLANS:flag});
  const dormant=testRuntimeEnvironment(role,config,{CLOUD_TEST_SERVICE_PLANS:flag,CLOUD_VENUE_SERVICE_LEVELS:'0'});
  assert.equal(dormant.CLOUD_VENUE_SERVICE_LEVELS,'0');delete dormant.CLOUD_VENUE_SERVICE_LEVELS;assert.deepEqual(dormant,absent);
  assert.equal(parsePlanMode(absent.CLOUD_TEST_SERVICE_PLANS,absent.CLOUD_VENUE_SERVICE_LEVELS),flag==='0'?'existing':'test-free-paid');
 }
});
