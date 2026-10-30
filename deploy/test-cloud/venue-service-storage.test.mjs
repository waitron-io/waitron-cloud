import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
import {openStorageAuthority} from './storage-authority.mjs';
import {openPlanStorage,openRuntimeStorage} from './service-runtime.mjs';
import {venueServiceFixture,set,read} from '../../packages/registration/test/fixtures/venue-service.ts';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const denied=e=>e?.$metadata?.httpStatusCode===403;

async function fixture(t,{database=false}={}){
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const db=database?await venueServiceFixture():undefined;if(db)t.after(()=>db.close());
 const options={directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
 const clients=[];t.after(()=>clients.forEach(c=>c.destroy()));
 async function input(venueId=randomUUID()) {return {venueId,location:await storage.bucket('venue-'+venueId),prefix:`streams/${venueId}/`};}
 function writer(grant,value){const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:{...grant.writerCredentials},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});clients.push(client);return suffix=>client.send(new PutObjectCommand({Bucket:value.location.bucket,Key:value.prefix+suffix,Body:'retained venue body'}),{abortSignal:AbortSignal.timeout(5000)});}
 return {storage,db,options,input,writer,state:async()=>JSON.parse(await readFile(join(options.directory,'state.json'),'utf8'))};
}

// Equal numeric revisions from different policy systems must never reuse a writer key.
test('venue storage separates legacy revision one from venue generation one',{timeout:90000},async t=>{
 const f=await fixture(t),input=await f.input();
 const legacy=await openStorageAuthority(f.options),first=await legacy.provision({...input,policyRevision:1}),old=f.writer(first,input);await old('before');
 assert.equal((await f.state()).version,1);
 const reader=await legacy.reader({...input,reference:first.readerReference});
 const options={...f.options,policyMode:'test-venue-levels',authorizeWriter:async()=>true};
 const venue=await openStorageAuthority(options);
 await assert.rejects(old('mode-reopen'),denied);
 const next=await venue.provision({...input,policyRevision:1});
 assert.notEqual(next.writerReference,first.writerReference,'mode equality must be part of writer reuse');
 assert.notEqual(next.writerCredentials.accessKeyId,first.writerCredentials.accessKeyId);
 await assert.rejects(old('equal-revision'),denied);await f.writer(next,input)('new-mode');
 assert.equal(next.readerReference,first.readerReference);assert.deepEqual(await venue.reader({...input,reference:first.readerReference}),reader);
 assert.equal((await venue.read(first.readerReference,input.location,input.prefix+'before')).toString(),'retained venue body');
 const state=await f.state();assert.equal(state.version,2);assert.equal(state.venues[input.venueId].policyMode,'test-venue-levels');assert.equal(state.venues[input.venueId].policyRevision,1);
 assert.deepEqual(state.venues[input.venueId].retired,[first.writerCredentials]);
 const restarted=await openStorageAuthority(options);assert.deepEqual(await restarted.provision({...input,policyRevision:1}),next);
 await assert.rejects(old('after-restart'),denied);
 // Both a new legacy instance and a retained pre-upgrade instance must observe the durable mode.
 await openStorageAuthority({...f.options,policyMode:'test-free-paid',authorizeWriter:async()=>true});
 await assert.rejects(f.writer(next,input)('legacy-reopen'),denied);await legacy.reconcile();
 await assert.rejects(f.writer(next,input)('old-instance'),denied);
 assert.equal((await legacy.read(first.readerReference,input.location,input.prefix+'before')).toString(),'retained venue body');
 const venueAgain=await openStorageAuthority(options),current=await venueAgain.provision({...input,policyRevision:1});
 const legacyAgain=await legacy.provision({...input,policyRevision:1});
 assert.notEqual(legacyAgain.writerReference,current.writerReference,'a retained legacy instance must rotate the new-mode writer before reuse');
 await assert.rejects(f.writer(current,input)('legacy-provision'),denied);await f.writer(legacyAgain,input)('fresh-legacy');
});

// Invalid mode cannot select the ordinary always-allowed adapter or alter private files.
test('venue storage refuses unknown policy mode before private state changes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'venue-storage-mode-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const options={directory:join(root,'managed'),iamPath:join(root,'iam.json'),admin:{accessKeyId:'synthetic-admin',secretAccessKey:'synthetic-secret'},endpoint:'https://storage.invalid',region:'local',reload:async()=>{}};
 await assert.rejects(openStorageAuthority({...options,policyMode:'unknown'}),/test_cloud.plan_mode/);
 await assert.rejects(readFile(join(options.directory,'state.json')),e=>e.code==='ENOENT');
});

// Treating missing or foreign mode as legacy would revive authority after a damaged v2 state.
for(const mode of [undefined,null,'unknown',1])test(`venue storage refuses malformed version two writer mode ${String(mode)}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'venue-storage-state-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'managed');await mkdir(directory,{mode:0o700});const id=randomUUID(),endpoint='https://storage.invalid';
 const item={location:{endpoint,region:'local',bucket:'synthetic-bucket'},prefix:`streams/${id}/`,reader:{accessKeyId:'reader',secretAccessKey:'reader-secret'},readerId:randomUUID(),policyRevision:1,policyMode:mode,writer:null,writerId:null,retired:[]};
 await writeFile(join(directory,'state.json'),JSON.stringify({version:2,venues:{[id]:item}}),{mode:0o600});
 const iamPath=join(root,'iam.json');await writeFile(iamPath,'unchanged',{mode:0o600});
 await assert.rejects(openStorageAuthority({directory,iamPath,admin:{accessKeyId:'admin',secretAccessKey:'admin-secret'},endpoint,region:'local',policyMode:'test-venue-levels',reload:async()=>{throw Error('unexpected reload');}}),/test_cloud.storage_state/);
 assert.equal(await readFile(iamPath,'utf8'),'unchanged');
});

// The venue adapter must consume the enrolled generation, never its organisation's paid switch.
test('venue storage runtime uses enrolled levels and refuses unregistered and production venues',{timeout:90000},async t=>{
 const f=await fixture(t,{database:true}),d=f.db,options={...f.options,pool:d.pool,mode:'test-venue-levels'};
 const authority=await openRuntimeStorage(options),input=await f.input(d.venues[0]);
 await d.pool.query("UPDATE organisations SET service_plan='paid',service_plan_revision=1");
 await assert.rejects(authority.provision(input),/permission_denied/);
 await set(d,'connected',d.venues[0],false);await assert.rejects(authority.provision(input),/permission_denied/);
 await set(d);assert.equal((await read(d)).revision,1);
 const first=await authority.provision(input);await f.writer(first,input)('enrolled');
 const production=await f.input(d.production);await assert.rejects(authority.provision(production),/permission_denied/);
 await set(d,'registered');await authority.reconcile();await assert.rejects(f.writer(first,input)('downgrade'),denied);
 await assert.rejects(authority.reader({...input,reference:first.readerReference}),/permission_denied/);
 assert.equal((await authority.read(first.readerReference,input.location,input.prefix+'enrolled')).toString(),'retained venue body');
});

// A missed round trip and a process restart must not preserve the old physical writer.
test('venue storage withdraws stale generations across downgrade round trips and restart',{timeout:90000},async t=>{
 const f=await fixture(t,{database:true}),d=f.db;await set(d);await set(d,'connected',d.venues[1]);
 const a=await f.input(d.venues[0]),b=await f.input(d.venues[1]),options={...f.options,pool:d.pool,mode:'test-venue-levels'};
 const authority=await openPlanStorage(options),first=await authority.provision(a),peer=await authority.provision(b),old=f.writer(first,a),neighbour=f.writer(peer,b);
 await old('before');await neighbour('before');const reader=await authority.reader({...a,reference:first.readerReference});
 await set(d,'registered');await authority.reconcile();await assert.rejects(old('downgrade'),denied);await neighbour('neighbour');
 await set(d);const second=await authority.provision(a);assert.notEqual(second.writerReference,first.writerReference);await f.writer(second,a)('second');
 await set(d,'registered');await set(d);
 const restarted=await openPlanStorage(options);await assert.rejects(f.writer(second,a)('restart-gap'),denied);await neighbour('restart');
 const third=await restarted.provision(a);assert.notEqual(third.writerReference,second.writerReference);assert.equal(third.readerReference,first.readerReference);assert.deepEqual(await restarted.reader({...a,reference:first.readerReference}),reader);await f.writer(third,a)('third');
 assert.equal((await restarted.read(first.readerReference,a.location,a.prefix+'before')).toString(),'retained venue body');
 await assert.rejects(old('never-revived'),denied);await assert.rejects(f.writer(second,a)('never-revived'),denied);
});

// Returning after a provider wait without the admitted generation leaks credentials across 2->1->2.
test('venue storage rejects a generation change during provider publication',{timeout:90000},async t=>{
 const f=await fixture(t,{database:true}),d=f.db;await set(d);const input=await f.input(d.venues[0]);let pause;
 const authority=await openPlanStorage({...f.options,pool:d.pool,mode:'test-venue-levels',reload:async()=>{await f.storage.reloadIdentityFile();await pause?.();}});
 const first=await authority.provision(input);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);pause=async()=>{entered();await gate;};
 const pending=authority.provision(input);void pending.catch(()=>{});
 try{await started;await set(d,'registered');await set(d);}finally{pause=undefined;release();}
 await assert.rejects(pending,/permission_denied/);await assert.rejects(f.writer(first,input)('late-grant'),denied);
 const next=await authority.provision(input);assert.notEqual(next.writerReference,first.writerReference);await f.writer(next,input)('fresh');
});

// An unavailable country policy must withdraw physical keys before surfacing its database error.
test('venue storage policy outage withdraws writers and preserves recovery readers',{timeout:90000},async t=>{
 const f=await fixture(t,{database:true}),d=f.db;await set(d);const input=await f.input(d.venues[0]),options={...f.options,pool:d.pool,mode:'test-venue-levels'};
 const authority=await openPlanStorage(options),first=await authority.provision(input),old=f.writer(first,input);await old('before');
 await d.pool.query('ALTER TABLE billing_service_authority RENAME TO billing_service_authority_unavailable');
 try{await assert.rejects(authority.reconcile(),e=>e.code==='42P01');await assert.rejects(old('outage'),denied);assert.equal((await authority.read(first.readerReference,input.location,input.prefix+'before')).toString(),'retained venue body');}
 finally{await d.pool.query('ALTER TABLE billing_service_authority_unavailable RENAME TO billing_service_authority');}
 const reopened=await openPlanStorage(options),next=await reopened.provision(input);assert.notEqual(next.writerReference,first.writerReference);assert.equal(next.readerReference,first.readerReference);await assert.rejects(old('outage-revival'),denied);await f.writer(next,input)('recovered');
});
