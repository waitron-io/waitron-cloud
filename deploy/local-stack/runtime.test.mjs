import assert from 'node:assert/strict';
import {mkdtemp,chmod,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {bootstrap} from './bootstrap.mjs';
import {loadRuntime,runtimeEnvironment} from './runtime.mjs';

const roots=[];test.afterEach(async()=>Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true}))));
async function configured(){const path=await mkdtemp(join(tmpdir(),'cloud-runtime-'));roots.push(path);return {path,config:await bootstrap(path)};}

test('runtime roles receive only their explicit configuration',async()=>{
 const {config}=await configured(),database=`postgres://cloud:${config.database.password}@postgres:5432/cloud`;
 const expected={
  migrate:{DATABASE_URL:database},
  account:{DATABASE_URL:database,CLOUD_FACTOR_ACTIVE_KEY_ID:config.factor.activeKeyId,CLOUD_FACTOR_KEYS:JSON.stringify(config.factor.keys),CLOUD_RECOVERY_ACTIVE_KEY_ID:config.recovery.activeKeyId,CLOUD_RECOVERY_KEYS:JSON.stringify(config.recovery.keys),CLOUD_PAIRING_ACTIVE_KEY_ID:config.pairing.activeKeyId,CLOUD_PAIRING_KEYS:JSON.stringify(config.pairing.keys),CLOUD_EMAIL_ACTIVE_KEY_ID:'local-v1',CLOUD_EMAIL_KEYS:JSON.stringify(config.email.keys),CLOUD_PORTAL_ORIGIN:'http://localhost:3000',CLOUD_HTTP_RATE_KEY:config.http.rateKey,CLOUD_HTTP_HOST:'0.0.0.0',CLOUD_HTTP_PORT:'3000',CLOUD_PORTAL_ASSETS_DIR:'/app/apps/portal/dist',CLOUD_INSTALLATION_ISSUER_KEY:config.installation.issuerKey},
  email:{DATABASE_URL:database,CLOUD_EMAIL_ACTIVE_KEY_ID:'local-v1',CLOUD_EMAIL_KEYS:JSON.stringify(config.email.keys),CLOUD_PORTAL_ORIGIN:'http://localhost:3000',MAILPIT_SMTP_PORT:'1025',CLOUD_MAIL_TRANSPORT:'local'},
  monitor:{DATABASE_URL:database,CLOUD_EMAIL_ACTIVE_KEY_ID:'local-v1',CLOUD_EMAIL_KEYS:JSON.stringify(config.email.keys)},
  usage:{DATABASE_URL:database},probe:{DATABASE_URL:database},
  backup:{DATABASE_URL:database,CLOUD_BACKUP_MASTER_KEY:config.backup.masterKey,CLOUD_BACKUP_ENDPOINT:'https://storage:8333',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:config.storage.accessKeyId,CLOUD_BACKUP_SECRET_KEY:config.storage.secretAccessKey,CLOUD_BACKUP_CA_FILE:'/run/local-stack/storage-ca.pem'},
  gateway:{GATEWAY_STATE_DIR:'/state',GATEWAY_MANIFEST:'/run/local-stack/gateway-manifest.json',GATEWAY_CELL_ID:config.gateway.cellId,GATEWAY_TRUST_KEY:'/run/local-stack/gateway-issuer.pem',GATEWAY_WIREGUARD_KEY:'/run/local-stack/gateway-wireguard.key',GATEWAY_BOT_KEY:'/run/local-stack/gateway-bot.key',GATEWAY_SUBNET:'61'},
  manifest:{LOCAL_STACK_CONFIG_DIR:'/run/local-stack'},reconcile:{DATABASE_URL:database}
 };
 for(const [role,value] of Object.entries(expected))assert.deepEqual(runtimeEnvironment(role,config),value,role);
 assert.throws(()=>runtimeEnvironment('shell',config),/local_stack\.role_invalid/);
});

test('runtime loader rejects group-readable private configuration',async()=>{
 const {path}=await configured();await chmod(join(path,'runtime.json'),0o640);
 await assert.rejects(loadRuntime(path),/local_stack\.configuration_permissions/);
});

test('runtime loader reads a valid bootstrap identity',async()=>{
 const {path,config}=await configured();assert.deepEqual(await loadRuntime(path),config);
});

test('runtime loader rejects versioned configuration with missing keys',async()=>{
 const {path}=await configured();await writeFile(join(path,'runtime.json'),'{"version":1}',{mode:0o600});
 await assert.rejects(loadRuntime(path),/local_stack\.configuration_invalid/);
});

test('usage runtime passes explicit schedule settings without passing unrelated secrets',async()=>{
 const {config}=await configured();
 const env=runtimeEnvironment('usage',config,{CLOUD_USAGE_INTERVAL_MS:'1200',CLOUD_USAGE_BATCH_SIZE:'3',PRIVATE_VALUE:'do-not-forward'});
 assert.deepEqual(Object.keys(env).sort(),['CLOUD_USAGE_BATCH_SIZE','CLOUD_USAGE_INTERVAL_MS','DATABASE_URL']);
 assert.equal(env.CLOUD_USAGE_INTERVAL_MS,'1200');assert.equal(env.CLOUD_USAGE_BATCH_SIZE,'3');
});

test('backup runtime forwards only explicit container limits and ownership',async()=>{
 const {config}=await configured();
 const env=runtimeEnvironment('backup',config,{CLOUD_VERIFIER_IMAGE:'local-verifier:proof',CLOUD_VERIFIER_OWNER:'proof-worker',CLOUD_VERIFIER_MEMORY_MIB:'512',CLOUD_VERIFIER_SCRATCH_MIB:'64',UNRELATED_SECRET:'private'});
 assert.equal(env.CLOUD_VERIFIER_IMAGE,'local-verifier:proof');assert.equal(env.CLOUD_VERIFIER_OWNER,'proof-worker');
 assert.equal(env.CLOUD_VERIFIER_MEMORY_MIB,'512');assert.equal(env.CLOUD_VERIFIER_SCRATCH_MIB,'64');assert.equal(env.UNRELATED_SECRET,undefined);
});

test('new local stacks persist an independent pairing key and expose it only to account workers',async()=>{
 const {path,config}=await configured();assert.ok(config.pairing?.keys?.[config.pairing?.activeKeyId]);
 assert.notEqual(config.pairing.keys[config.pairing.activeKeyId],config.email.keys[config.email.activeKeyId]);
 assert.deepEqual((await bootstrap(path)).pairing,config.pairing);
 const account=runtimeEnvironment('account',config);
 assert.equal(account.CLOUD_PAIRING_ACTIVE_KEY_ID,config.pairing.activeKeyId);
 assert.deepEqual(JSON.parse(account.CLOUD_PAIRING_KEYS),config.pairing.keys);
 for(const role of ['migrate','email','monitor','usage','probe','backup','gateway','manifest','reconcile'])assert.equal(runtimeEnvironment(role,config).CLOUD_PAIRING_KEYS,undefined);
});

test('existing local configuration is not regenerated when it lacks pairing keys',async()=>{
 const {path,config}=await configured();delete config.pairing;
 await writeFile(join(path,'runtime.json'),JSON.stringify(config),{mode:0o600});
 assert.deepEqual(await bootstrap(path),config);assert.deepEqual(await loadRuntime(path),config);
 assert.equal(runtimeEnvironment('account',config).CLOUD_PAIRING_KEYS,undefined);
});

test('new local stacks persist independent recovery keys only for account workers',async()=>{
 const {path,config}=await configured();assert.ok(config.recovery?.keys?.[config.recovery?.activeKeyId]);
 const secret=config.recovery.keys[config.recovery.activeKeyId];
 assert.notEqual(secret,config.pairing.keys[config.pairing.activeKeyId]);assert.notEqual(secret,config.backup.masterKey);assert.notEqual(secret,config.email.keys[config.email.activeKeyId]);
 assert.deepEqual((await bootstrap(path)).recovery,config.recovery);
 const env=runtimeEnvironment('account',config);assert.equal(env.CLOUD_RECOVERY_ACTIVE_KEY_ID,config.recovery.activeKeyId);assert.deepEqual(JSON.parse(env.CLOUD_RECOVERY_KEYS),config.recovery.keys);
 for(const role of ['migrate','email','monitor','usage','probe','backup','gateway','manifest','reconcile'])assert.equal(runtimeEnvironment(role,config).CLOUD_RECOVERY_KEYS,undefined);
});

test('existing local configuration is not regenerated when it lacks recovery keys',async()=>{
 const {path,config}=await configured();delete config.recovery;
 await writeFile(join(path,'runtime.json'),JSON.stringify(config),{mode:0o600});
 assert.deepEqual(await bootstrap(path),config);assert.deepEqual(await loadRuntime(path),config);
 assert.equal(runtimeEnvironment('account',config).CLOUD_RECOVERY_KEYS,undefined);
});

test('only account receives an explicitly enabled staff certificate exchange',async()=>{
 const {config}=await configured();assert.equal(runtimeEnvironment('account',config).CLOUD_STAFF_CERTIFICATES,undefined);
 assert.equal(runtimeEnvironment('account',config,{CLOUD_STAFF_CERTIFICATES:'1'}).CLOUD_STAFF_CERTIFICATES,'1');
 for(const role of ['migrate','email','monitor','usage','probe','backup','gateway','manifest','reconcile'])assert.equal(runtimeEnvironment(role,config,{CLOUD_STAFF_CERTIFICATES:'1'}).CLOUD_STAFF_CERTIFICATES,undefined);
});

test('only account receives stored factor keys and an explicitly supplied factor policy',async()=>{
 const {config}=await configured();
 assert.ok(config.factor?.keys?.[config.factor?.activeKeyId]);
 const env=runtimeEnvironment('account',config,{CLOUD_FACTOR_POLICY:'local-policy',CLOUD_FACTOR_KEYS:'foreign-keys',UNRELATED_SECRET:'private'});
 assert.equal(env.CLOUD_FACTOR_ACTIVE_KEY_ID,config.factor.activeKeyId);
 assert.deepEqual(JSON.parse(env.CLOUD_FACTOR_KEYS),config.factor.keys);
 assert.equal(env.CLOUD_FACTOR_POLICY,'local-policy');assert.equal(env.UNRELATED_SECRET,undefined);
 assert.equal(runtimeEnvironment('account',config).CLOUD_FACTOR_POLICY,undefined);
 for(const role of ['migrate','email','monitor','usage','probe','backup','gateway','manifest','reconcile']){
  const other=runtimeEnvironment(role,config,{CLOUD_FACTOR_POLICY:'local-policy'});
  assert.equal(other.CLOUD_FACTOR_KEYS,undefined);assert.equal(other.CLOUD_FACTOR_POLICY,undefined);
 }
});

test('older local configuration keeps its bytes and independent paths without inventing factor keys',async()=>{
 const {path,config}=await configured();delete config.factor;
 const bytes=JSON.stringify(config);await writeFile(join(path,'runtime.json'),bytes,{mode:0o600});
 assert.deepEqual(await bootstrap(path),config);assert.deepEqual(await loadRuntime(path),config);
 assert.equal(runtimeEnvironment('account',config).CLOUD_FACTOR_KEYS,undefined);
});
