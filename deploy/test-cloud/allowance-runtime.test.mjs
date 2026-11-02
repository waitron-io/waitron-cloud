import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import * as rules from '../../packages/registration/src/billing-allowance-rules.ts';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';

const enabled={CLOUD_TEST_ALLOWANCES:'1',CLOUD_ALLOWANCE_CALENDAR:'UTC',CLOUD_VENUE_SERVICE_LEVELS:'test'};
function parse(environment,mode='test-venue-levels'){
 assert.equal(typeof rules.allowanceOptionsFromEnv,'function','runtime must validate explicit allowance options before database/provider work');
 return rules.allowanceOptionsFromEnv(environment,mode);
}
test('allowance runtime requires both explicit test mode and UTC without fallback',()=>{
 assert.deepEqual(parse(enabled),{mode:'test',calendar:'UTC'});
 for(const mode of ['existing','test-free-paid','test-venue-levels']){
  assert.equal(parse({},mode),undefined);assert.equal(parse({CLOUD_TEST_ALLOWANCES:'0'},mode),undefined);
 }
 for(const mode of ['existing','test-free-paid'])assert.throws(()=>parse(enabled,mode),{code:'invalid_allowance_input'});
 for(const environment of [
  {...enabled,CLOUD_TEST_ALLOWANCES:''},{...enabled,CLOUD_TEST_ALLOWANCES:'true'},
  {...enabled,CLOUD_TEST_ALLOWANCES:'test'},{...enabled,CLOUD_TEST_ALLOWANCES:'production'},
  {CLOUD_TEST_ALLOWANCES:'1'},{...enabled,CLOUD_ALLOWANCE_CALENDAR:'Europe/Rome'},
  {CLOUD_ALLOWANCE_CALENDAR:'UTC'},{CLOUD_TEST_ALLOWANCES:'0',CLOUD_ALLOWANCE_CALENDAR:'UTC'},
 ])assert.throws(()=>parse(environment),{code:'invalid_allowance_input'});
});

test('test runtime forwards allowance options only to existing service consumers',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'allowance-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));const config=await bootstrap(directory);
 for(const role of ['account','translation','storage','backup','manifest','reconcile','email','migrate','monitor','usage','probe','gateway']){
  const absent=testRuntimeEnvironment(role,config,{CLOUD_VENUE_SERVICE_LEVELS:'test'});
  const off=testRuntimeEnvironment(role,config,{CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_ALLOWANCES:'0'});assert.deepEqual(off,absent);
  const value=testRuntimeEnvironment(role,config,{...enabled,CLOUD_TRANSLATION:'1',CLOUD_OPENAI_API_KEY:'fixture-only',CLOUD_SMTP_HOST:'outside.invalid'});
  if(['account','translation'].includes(role)){assert.equal(value.CLOUD_TEST_ALLOWANCES,'1');assert.equal(value.CLOUD_ALLOWANCE_CALENDAR,'UTC');assert.deepEqual(parse(value),{mode:'test',calendar:'UTC'});}
  else {assert.equal(value.CLOUD_TEST_ALLOWANCES,undefined);assert.equal(value.CLOUD_ALLOWANCE_CALENDAR,undefined);}
  assert.equal(value.CLOUD_OPENAI_API_KEY,undefined);assert.equal(value.CLOUD_SMTP_HOST,undefined);assert.notEqual(value.CLOUD_TRANSLATION,'1');
 }
});

test('invalid allowance runtime input refuses before configuration access',()=>{
 for(const role of ['account','translation','gateway'])for(const environment of [
  {...enabled,CLOUD_VENUE_SERVICE_LEVELS:undefined},
  {...enabled,CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:undefined},
  {...enabled,CLOUD_ALLOWANCE_CALENDAR:'Europe/Rome'}, {CLOUD_TEST_ALLOWANCES:'1'},
 ])assert.throws(()=>testRuntimeEnvironment(role,null,environment),/test_cloud.allowance_mode/);
});
