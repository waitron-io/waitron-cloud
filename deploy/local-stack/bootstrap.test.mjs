import assert from 'node:assert/strict';
import {createHash,createPublicKey} from 'node:crypto';
import {mkdtemp,readFile,stat,writeFile,rm,mkdir,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {bootstrap} from './bootstrap.mjs';
import {claimLease} from './lease.mjs';

const roots=[];
test.afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function root(){const path=await mkdtemp(join(tmpdir(),'cloud-local-stack-'));roots.push(path);return path;}
const digest=value=>createHash('sha256').update(value).digest('hex');

test('bootstrap creates one private, valid local identity and signed empty gateway authority',async()=>{
 const directory=await root(),config=await bootstrap(directory),again=await bootstrap(directory);
 assert.deepEqual(again,config);
 assert.equal(config.version,1);
 assert.match(config.database.password,/^[0-9a-f]{64}$/);
 assert.match(config.email.keys[config.email.activeKeyId],/^[0-9a-f]{64}$/);
 assert.match(config.http.rateKey,/^[0-9a-f]{64}$/);
 assert.match(config.backup.masterKey,/^[0-9a-f]{64}$/);
 assert.equal(config.storage.endpoint,'https://storage:8333');
 assert.equal(config.gateway.routes,0);
 const names=['runtime.json','postgres-password','gateway-issuer.pem','gateway-signing-key.pem','gateway-wireguard.key','gateway-bot.key','gateway-manifest.json','gateway-sequence','storage-ca.pem','storage-cert.pem','storage-key.pem','storage-iam.json'];
 for(const name of names)assert.equal((await stat(join(directory,name))).mode&0o777,0o600,name);
 assert.equal((await stat(directory)).mode&0o777,0o700);
 const publicKey=createPublicKey(await readFile(join(directory,'gateway-issuer.pem')));
 const manifest=verifyManifest(JSON.parse(await readFile(join(directory,'gateway-manifest.json'),'utf8')),publicKey,config.gateway.cellId,Date.now());
 assert.equal(manifest.sequence,1);assert.deepEqual(manifest.routes,[]);
 assert.ok(manifest.expiresAt-Date.now()<=600000);
 assert.equal(digest(await readFile(join(directory,'gateway-signing-key.pem'))),config.fingerprints.gatewaySigningKey);
 assert.equal(digest(await readFile(join(directory,'storage-cert.pem'))),config.fingerprints.storageCertificate);
 assert.equal((await readFile(join(directory,'postgres-password'),'utf8')).trim(),config.database.password);
});

test('concurrent bootstrap calls converge on one identity',async()=>{
 const directory=await root();
 const values=await Promise.all(Array.from({length:8},()=>bootstrap(directory)));
 assert.equal(new Set(values.map(value=>value.fingerprints.gatewaySigningKey)).size,1);
 assert.equal(new Set(values.map(value=>value.database.password)).size,1);
});

test('bootstrap refuses malformed existing state instead of replacing it',async()=>{
 const directory=await root();await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(join(directory,'runtime.json'),'{"version":1}',{mode:0o600});
 await assert.rejects(bootstrap(directory),/local_stack\.configuration_invalid/);
 assert.equal(await readFile(join(directory,'runtime.json'),'utf8'),'{"version":1}');
});

test('bootstrap refuses incomplete existing state instead of replacing its identity',async()=>{
 const directory=await root(),config=await bootstrap(directory);
 await rm(join(directory,'postgres-password'));
 await assert.rejects(bootstrap(directory),/local_stack\.configuration_invalid/);
 assert.equal(JSON.parse(await readFile(join(directory,'runtime.json'),'utf8')).fingerprints.gatewaySigningKey,config.fingerprints.gatewaySigningKey);
});

test('bootstrap validates the gateway public certificate used by the gateway',async()=>{
 const directory=await root();await bootstrap(directory);await rm(join(directory,'public-certs','default.pem'));
 await assert.rejects(bootstrap(directory),/local_stack\.configuration_invalid/);
});

test('bootstrap reclaims a stale interrupted-process lock',async()=>{
 const directory=await root(),lock=join(directory,'.bootstrap.lock');await writeFile(lock,'abandoned',{mode:0o600});
 const old=new Date(Date.now()-60000);await utimes(lock,old,old);
 assert.equal((await bootstrap(directory)).version,1);
});

test('a reclaimed lease prevents its previous owner from publishing',async()=>{
 const directory=await root(),path=join(directory,'.lease'),first=await claimLease(path,{staleMs:10});
 const old=new Date(Date.now()-60000);await utimes(path,old,old);const second=await claimLease(path,{staleMs:10});
 await assert.rejects(first.assertOwned(),/local_stack\.lease_lost/);
 await first.release();await second.release();
});

test('bootstrap persists an independent factor key and refuses a malformed supplied factor configuration',async()=>{
 const directory=await root(),config=await bootstrap(directory);
 assert.match(config.factor?.keys?.[config.factor?.activeKeyId]??'',/^[0-9a-f]{64}$/);
 const factor=config.factor.keys[config.factor.activeKeyId];
 for(const key of [config.email.keys['local-v1'],config.pairing.keys['local-v1'],config.recovery.keys['local-v1'],config.http.rateKey,config.backup.masterKey])assert.notEqual(factor,key);
 assert.deepEqual((await bootstrap(directory)).factor,config.factor);
 config.factor={activeKeyId:'missing',keys:{}};const bytes=JSON.stringify(config);
 await writeFile(join(directory,'runtime.json'),bytes,{mode:0o600});
 await assert.rejects(bootstrap(directory),/local_stack\.configuration_invalid/);
 assert.equal(await readFile(join(directory,'runtime.json'),'utf8'),bytes);
});
