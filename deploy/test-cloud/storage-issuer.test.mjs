import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import {createPublicKey,verify} from 'node:crypto';
import {bootstrapTestCloud} from './bootstrap.mjs';
// A replaced issuer key breaks durable STS identity; discovery must never expose private material.
test('private storage issuer survives restart and serves trusted discovery and the key that signs exact scopes', {timeout:30000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'test-cloud-issuer-'));t.after(()=>rm(root,{recursive:true,force:true}));await bootstrapTestCloud(root);
 const {bootstrapStorageIssuer,startStorageIssuer}=await import('./storage-issuer.mjs');
 const first=await bootstrapStorageIssuer(root),again=await bootstrapStorageIssuer(root);assert.deepEqual(again,first);
 const ca=await readFile(join(root,'lan/ca.pem'));
 const server=await startStorageIssuer(root,{port:0,host:'127.0.0.1'});t.after(()=>server.close());
 async function get(path,trust=ca){return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.port,servername:'waitron.local',path,ca:trust},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end();});}
 const discovery=await get('/.well-known/openid-configuration');assert.equal(discovery.status,200);assert.equal(discovery.body.issuer,'https://waitron.local:8444');assert.equal(discovery.body.jwks_uri,'https://waitron.local:8444/jwks');
 const jwks=await get('/jwks');assert.equal(jwks.body.keys.length,1);assert.equal(jwks.body.keys[0].d,undefined);
 const token=server.authority.token({kind:'capture',bucket:'venue-a',scope:'incoming/point-a'}),[header,payload,signature]=token.split('.');
 assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),createPublicKey({key:jwks.body.keys[0],format:'jwk'}),Buffer.from(signature,'base64url')),true);
 const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.iss,discovery.body.issuer);assert.equal(claims.scope,'incoming/point-a');assert.equal(claims.kind,'capture');assert.equal(claims.exp-claims.iat,60);
 assert.equal((await get('/private-key')).status,404);await assert.rejects(get('/jwks',Buffer.from('')));
 const iam=JSON.parse(await readFile(join(root,'storage-authority/sts.json'),'utf8'));
 assert.equal(iam.sts.tokenDuration,'15m');assert.equal(iam.sts.maxSessionLength,'15m');assert.equal(iam.providers[0].config.issuer,discovery.body.issuer);
 const policies=Object.fromEntries(iam.policies.map(p=>[p.name,p.document.Statement[0]]));assert.deepEqual(policies.capture.Action,['s3:PutObject']);assert.deepEqual(policies.restore.Action,['s3:GetObject']);assert.deepEqual(policies.capture.Resource,['arn:aws:s3:::${jwt:bucket}/${jwt:scope}']);
 assert.equal((await stat(join(root,'storage-authority/issuer.json'))).mode&0o777,0o600);
});

// Damaged authority state must fail without quietly replacing the issuer or broadening STS policy.
test('storage issuer refuses partial state, changed scope policy and weakened private permissions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'test-cloud-issuer-corrupt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {bootstrapStorageIssuer}=await import('./storage-issuer.mjs');const {chmod,writeFile}=await import('node:fs/promises');
 const original=await bootstrapStorageIssuer(root),file=join(root,'storage-authority/issuer.json'),stsFile=join(root,'storage-authority/sts.json'),key=await readFile(file),sts=await readFile(stsFile);
 await chmod(file,0o644);await assert.rejects(bootstrapStorageIssuer(root),/test_cloud.storage_issuer_state/);await chmod(file,0o600);
 const changed=JSON.parse(sts);changed.policies[0].document.Statement[0].Resource=['*'];await writeFile(stsFile,JSON.stringify(changed));await assert.rejects(bootstrapStorageIssuer(root),/test_cloud.storage_issuer_state/);await writeFile(stsFile,sts);
 await rm(file);await assert.rejects(bootstrapStorageIssuer(root),/test_cloud.storage_issuer_state/);await writeFile(file,key,{mode:0o600});
 assert.deepEqual(await bootstrapStorageIssuer(root),original);
});
