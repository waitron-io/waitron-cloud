import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
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
 const value=testRuntimeEnvironment(role,config,{CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'1',GOOGLE_MAPS_SERVER_KEY:'fake-only',GEOAPIFY_API_KEY:'fake-only',CLOUD_OPENAI_API_KEY:'fake-only',CLOUD_SMTP_HOST:'outside.test',NODE_AUTH_TOKEN:'fake-only',CLOUD_VERIFIER_IMAGE:'sha256:'+'a'.repeat(64)});
 assert.equal(value.CLOUD_VENUE_SERVICE_LEVELS,'test');assert.equal(value.CLOUD_TEST_SERVICE_PLANS,'0');
 assert.equal(parsePlanMode(value.CLOUD_TEST_SERVICE_PLANS,value.CLOUD_VENUE_SERVICE_LEVELS),'test-venue-levels');
 for(const key of ['CLOUD_ADDRESS_LOOKUP_SETTINGS','GOOGLE_MAPS_SERVER_KEY','GEOAPIFY_API_KEY','CLOUD_OPENAI_API_KEY','CLOUD_SMTP_HOST','NODE_AUTH_TOKEN'])assert.equal(value[key],undefined,key);
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

test('test account receives its mounted backup disk only in venue-level mode',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cloud-stage-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=await bootstrap(dir),settings={CLOUD_BACKUP_STAGE_ROOT:'/run/backup-stage'};
 assert.equal(testRuntimeEnvironment('account',config,{...settings,CLOUD_VENUE_SERVICE_LEVELS:'test'}).CLOUD_BACKUP_STAGE_ROOT,settings.CLOUD_BACKUP_STAGE_ROOT);
 assert.equal(testRuntimeEnvironment('account',config,{...settings,CLOUD_TEST_SERVICE_PLANS:'1'}).CLOUD_BACKUP_STAGE_ROOT,undefined);
 assert.equal(testRuntimeEnvironment('backup',config,{...settings,CLOUD_VENUE_SERVICE_LEVELS:'test'}).CLOUD_BACKUP_STAGE_ROOT,undefined);
});

test('only opted-in LAN account modes receive the private exit stage',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-exit-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const config=await bootstrap(directory),root='/run/backup-stage';
 for(const flags of [{CLOUD_TEST_SERVICE_PLANS:'1'},{CLOUD_VENUE_SERVICE_LEVELS:'test'}]){
  const environment={...flags,CLOUD_EXIT_STAGE_ROOT:root};
  assert.equal(testRuntimeEnvironment('account',config,environment).CLOUD_EXIT_STAGE_ROOT,root);
  assert.equal(testRuntimeEnvironment('backup',config,environment).CLOUD_EXIT_STAGE_ROOT,undefined);
  assert.throws(()=>testRuntimeEnvironment('account',config,{...environment,CLOUD_EXIT_STAGE_ROOT:'/other'}),/test_cloud.exit_stage/);
  assert.throws(()=>testRuntimeEnvironment('account',config,{...environment,TEST_CLOUD_AMAZON:'1'}),/test_cloud.exit_stage/);
 }
 assert.equal(testRuntimeEnvironment('account',config,{CLOUD_EXIT_STAGE_ROOT:root}).CLOUD_EXIT_STAGE_ROOT,undefined);
});

test('ranged exit needs an explicit LAN account opt-in with a private mount',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-exit-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const config=await bootstrap(directory),enabled={CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_EXIT_RANGE_DOWNLOADS:'1'};
 const environment={...enabled,CLOUD_EXIT_STAGE_ROOT:'/run/backup-stage'};
 assert.equal(testRuntimeEnvironment('account',config,environment).CLOUD_EXIT_RANGE_DOWNLOADS,'1');
 assert.equal(testRuntimeEnvironment('backup',config,environment).CLOUD_EXIT_RANGE_DOWNLOADS,undefined);
 assert.throws(()=>testRuntimeEnvironment('account',config,enabled),/test_cloud.exit_stage/);
 assert.throws(()=>testRuntimeEnvironment('account',config,{...environment,CLOUD_TEST_SERVICE_PLANS:'0'}),/test_cloud.exit_stage/);
 assert.throws(()=>testRuntimeEnvironment('account',config,{...environment,TEST_CLOUD_AMAZON:'1'}),/test_cloud.exit_stage/);
 assert.throws(()=>testRuntimeEnvironment('account',config,{...environment,NODE_ENV:'production'}),/test_cloud.exit_stage/);
});

test('the exit worker clears only its abandoned stage after acquiring the mount', {skip:process.platform!=='linux',timeout:8000},async t=>{
 const {spawnExitWorker,openExitStage}=await import('./runtime.mjs');
 const root=await mkdtemp(join(tmpdir(),'cloud-exit-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const stale=join(root,'exit-download'),other=join(root,'other-work');
 await mkdir(stale);await mkdir(other);
 await assert.rejects(openExitStage(root),/test_cloud.exit_stage/);
 const options={stdio:'pipe',env:{PATH:process.env.PATH}};
 const owner=await spawnExitWorker(root,['-e','console.log("held");process.stdin.resume()'],options);
 const ownerExit=once(owner,'exit');t.after(async()=>{owner.stdin.end();await ownerExit;});
 assert.equal(await Promise.race([once(owner.stdout,'data').then(([chunk])=>String(chunk).trim()),ownerExit.then(()=>null)]),'held');
 const script=`import {openExitStage} from ${JSON.stringify(new URL('./runtime.mjs',import.meta.url).href)};
 const stage = await openExitStage(process.argv[1],process.env.CLOUD_EXIT_STAGE_LOCKED);
 console.log(JSON.stringify(stage));`;
 const start=async()=>{
  const child=await spawnExitWorker(root,['--input-type=module','-e',script,root],options);
  const exit=once(child,'exit');let stdout='';for await(const chunk of child.stdout)stdout+=chunk;
  return {code:(await exit)[0],stdout};
 };
 assert.deepEqual(await start(),{code:73,stdout:''});
 assert.ok((await stat(stale)).isDirectory());
 owner.stdin.end();assert.equal((await ownerExit)[0],0);
 const next=await start();assert.equal(next.code,0);assert.deepEqual(JSON.parse(next.stdout),{stageRoot:root,enabled:false});
 await assert.rejects(stat(stale),{code:'ENOENT'});
 assert.ok((await stat(other)).isDirectory());
});
