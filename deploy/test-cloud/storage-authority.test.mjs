import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Agent} from 'node:https';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
import {storageOperations} from './storage-operation-diagnostics.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand,GetObjectCommand,ListObjectsV2Command}=require('@aws-sdk/client-s3');
const denied=e=>e?.$metadata?.httpStatusCode===403;
// Missing IAM withdrawal must leave this test red even if the API hides credentials.
test('persistent stream authority withdraws the actual writer, preserves readers and issues a fresh upgrade', {timeout:90000},async t=>{
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const {openStorageAuthority}=await import('./storage-authority.mjs');
 const location=await storage.bucket('managed-authority-a'),other=await storage.bucket('managed-authority-b');
 const clients=[];t.after(()=>{for(const client of clients)client.destroy();});
 function client(credentials,bucket=location.bucket){const s3=new S3Client({endpoint:storage.endpoint,region:'local',credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});clients.push(s3);return {put:key=>s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:'venue body'})),get:key=>s3.send(new GetObjectCommand({Bucket:bucket,Key:key})),list:prefix=>s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix}))};}
 const options={directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
 const authority=await openStorageAuthority(options),a=randomUUID(),b=randomUUID();
 const input={venueId:a,location,prefix:`streams/${a}/`},inputB={venueId:b,location:other,prefix:`streams/${b}/`};
 const first=await authority.provision(input),neighbour=await authority.provision(inputB),old=client(first.writerCredentials),peer=client(neighbour.writerCredentials,other.bucket);
 await old.put(input.prefix+'point');await peer.put(inputB.prefix+'point');
 await assert.rejects(old.put('incoming/foreign'),denied);
 await assert.rejects(client(first.writerCredentials,other.bucket).put(input.prefix+'foreign'),denied);
 const reader=await authority.reader({...input,reference:first.readerReference});
 assert.ok(reader.accessKeyId!==first.writerCredentials.accessKeyId,'reader must use a separate identity');
 await assert.rejects(client(reader).put(input.prefix+'forbidden'),denied);
 assert.equal((await authority.read(first.readerReference,location,input.prefix+'point')).toString(),'venue body');
 await assert.rejects(authority.read(first.readerReference,location,'streams/foreign/point'),/test_cloud.storage_scope/);
 await assert.rejects(authority.provision({...input,prefix:'streams/foreign/'}),/test_cloud.storage_scope/);
 const unknown=randomUUID();await assert.rejects(authority.provision({venueId:unknown,location,prefix:'streams/foreign/'}),/test_cloud.storage_scope/);
 await assert.rejects(authority.provision({venueId:unknown,location:{...location,endpoint:storage.endpoint+'/'},prefix:`streams/${unknown}/`}),/test_cloud.storage_scope/);
 await assert.rejects(authority.provision({...input,location:{...location,endpoint:'https://foreign.invalid'}}),/test_cloud.storage_scope/);
 assert.equal((await authority.provision(input)).writerReference,first.writerReference);
 await authority.withdrawWriter(a);
 await assert.rejects(old.put(input.prefix+'after'),denied);
 await assert.rejects(old.list(input.prefix),denied);
 await peer.put(inputB.prefix+'after');
 assert.equal((await authority.read(first.readerReference,location,input.prefix+'point')).toString(),'venue body');
 const restarted=await openStorageAuthority(options),upgraded=await restarted.provision(input);
 assert.ok(upgraded.writerCredentials.accessKeyId!==first.writerCredentials.accessKeyId,'upgrade must mint a fresh writer');
 assert.notEqual(upgraded.writerReference,first.writerReference);assert.equal(upgraded.readerReference,first.readerReference);
 await client(upgraded.writerCredentials).put(input.prefix+'upgrade');await assert.rejects(old.put(input.prefix+'revived'),denied);
 assert.equal((await stat(join(options.directory,'state.json'))).mode&0o777,0o600);
 const onDisk=JSON.parse(await readFile(join(options.directory,'state.json'),'utf8'));assert.equal(onDisk.version,1);
 // A failed reload cannot return success. Durable intent is reapplied on reopening.
 let interrupted=false;
 const failure=await openStorageAuthority({...options,reload:async()=>{if(interrupted)throw Error('injected reload interruption');await storage.reloadIdentityFile();}});interrupted=true;
 await assert.rejects(failure.withdrawWriter(a),/interruption/);
 await openStorageAuthority(options);
 await assert.rejects(client(upgraded.writerCredentials).put(input.prefix+'restart'),denied);
 await peer.put(inputB.prefix+'restart');
});

// Losing the ledger must never turn existing static writer identities into untracked access.
test('missing durable identity state refuses to overwrite an existing managed IAM file', {timeout:90000},async t=>{
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const {openStorageAuthority}=await import('./storage-authority.mjs');
 const {rm}=await import('node:fs/promises');
 const options={directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
 const authority=await openStorageAuthority(options),venueId=randomUUID();
 await authority.provision({venueId,location:await storage.bucket('managed-state-loss'),prefix:`streams/${venueId}/`});
 const original=await readFile(options.iamPath);
 await rm(join(options.directory,'state.json'));
 await assert.rejects(openStorageAuthority(options),/test_cloud.storage_state/);
 assert.ok((await readFile(options.iamPath)).equals(original),'missing state must leave the IAM file unchanged');
});

// Returning before the provider applies a new identity hands the caller unusable credentials.
test('provision waits until the provider has applied both writer and reader identities', {timeout:90000},async t=>{
 const operation=storageOperations(message=>t.diagnostic(message));
 const storage=await operation('startup',()=>startBackupStorage());t.after(()=>storage.stop());
 const {openStorageAuthority}=await import('./storage-authority.mjs');
 const pending=[];t.after(()=>Promise.all(pending));
 const authority=await operation('authority-open',()=>openStorageAuthority({directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:async()=>{pending.push(new Promise((resolve,reject)=>setTimeout(()=>operation('identity-reload',()=>storage.reloadIdentityFile()).then(resolve,reject),150)));}}));
 const venueId=randomUUID(),location=await operation('bucket-create',()=>storage.bucket('managed-delayed-reload')),prefix=`streams/${venueId}/`;
 const result=await operation('provision',()=>authority.provision({venueId,location,prefix}));
 const s3=new S3Client({endpoint:storage.endpoint,region:'local',credentials:result.writerCredentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>s3.destroy());
 await operation('writer-put',()=>s3.send(new PutObjectCommand({Bucket:location.bucket,Key:prefix+'point',Body:'ready immediately'})));
 assert.equal((await operation('reader-get',()=>authority.read(result.readerReference,location,prefix+'point'))).toString(),'ready immediately');
});

// Removing the shared file lease must expose a lost identity when two processes provision at once.
test('separate authority instances serialize concurrent provisioning without losing a venue', {timeout:90000},async t=>{
 const storage=await startBackupStorage();t.after(()=>storage.stop());const {openStorageAuthority}=await import('./storage-authority.mjs');
 const options={directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
 const first=await openStorageAuthority(options),second=await openStorageAuthority(options),a=randomUUID(),b=randomUUID(),location=await storage.bucket('concurrent-managed');
 const result=await Promise.allSettled([first.provision({venueId:a,location,prefix:`streams/${a}/`}),second.provision({venueId:b,location,prefix:`streams/${b}/`})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,2,'both independently opened authorities must finish provisioning');
 const state=JSON.parse(await readFile(join(options.directory,'state.json'),'utf8'));assert.deepEqual(Object.keys(state.venues).sort(),[a,b].sort());
 await openStorageAuthority(options);
 for(const [index,id] of [a,b].entries()){
  const record=result[index];assert.equal(record.status,'fulfilled');const credentials=await first.reader({venueId:id,location,prefix:`streams/${id}/`,reference:record.value.readerReference});assert.ok(credentials.accessKeyId!==record.value.writerCredentials.accessKeyId,'concurrent provisioning must retain distinct readers');
 }
});
