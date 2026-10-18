import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {OrganisationPlanStore} from '../../packages/registration/src/organisation-plans.ts';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const denied=e=>e?.$metadata?.httpStatusCode===403;
// A plan check at the API alone cannot catch a missed writer withdrawal or brief free/paid toggle.
test('current plans fence direct writers, missed downgrade revisions, production venues and delayed provider replies', {timeout:120000},async t=>{
 const db=await database();t.after(()=>db.close());const storage=await startBackupStorage();t.after(()=>storage.stop());
 const {openPlanStorage}=await import('./service-runtime.mjs');
 const plans=new OrganisationPlanStore(db.pool);
 async function venue(environment='test'){
  const organisationId=randomUUID(),business=randomUUID(),venueId=randomUUID();
  await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);await db.pool.query('INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,$5)',[venueId,organisationId,business,randomUUID(),environment]);
  return {organisationId,venueId,location:await storage.bucket('venue-'+venueId),prefix:`streams/${venueId}/`};
 }
 const a=await venue(),b=await venue(),production=await venue('production');let pause;
 const options={pool:db.pool,mode:'test-free-paid',directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:async()=>{await storage.reloadIdentityFile();await pause?.();}};
 const authority=await openPlanStorage(options),clients=[];t.after(()=>clients.forEach(c=>c.destroy()));
 function writer(value,item=a){const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:value.writerCredentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});clients.push(client);return key=>client.send(new PutObjectCommand({Bucket:item.location.bucket,Key:item.prefix+key,Body:'plan-scoped body'}));}
 await assert.rejects(authority.provision(a),/permission_denied/);
 await plans.set(production.organisationId,'paid');await assert.rejects(authority.provision(production),/permission_denied/);
 await assert.rejects(openPlanStorage({...options,mode:'existing'}),/test_cloud.plan_mode/);
 await plans.set(a.organisationId,'paid');await plans.set(b.organisationId,'paid');
 const first=await authority.provision(a),peer=await authority.provision(b),old=writer(first),neighbour=writer(peer,b);await old('before');await neighbour('before');
 await plans.set(a.organisationId,'free');await authority.reconcile();await assert.rejects(old('free'),denied);await neighbour('paid');
 await plans.set(a.organisationId,'paid');const upgraded=await authority.provision(a);assert.notEqual(upgraded.writerReference,first.writerReference);await writer(upgraded)('upgrade');await assert.rejects(old('revival'),denied);
 // Even a free->paid interval between polls retires the prior revision's writer.
 await plans.set(a.organisationId,'free');await plans.set(a.organisationId,'paid');await authority.reconcile();await assert.rejects(writer(upgraded)('missed-toggle'),denied);
 let fresh=await authority.provision(a);assert.notEqual(fresh.writerReference,upgraded.writerReference);
 const beforeDirectRenewal=fresh;await plans.set(a.organisationId,'free');await plans.set(a.organisationId,'paid');fresh=await authority.provision(a);
 assert.notEqual(fresh.writerReference,beforeDirectRenewal.writerReference,'explicit provision must rotate a stale revision without waiting for reconciliation');await assert.rejects(writer(beforeDirectRenewal)('before-direct-renewal'),denied);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);pause=async()=>{entered();await gate;};
 const pending=authority.provision(a);void pending.catch(()=>{});
 try{await started;await plans.set(a.organisationId,'free');}finally{pause=undefined;release();}
 await assert.rejects(pending,/permission_denied/);await assert.rejects(writer(fresh)('delayed'),denied);
 const restarted=await openPlanStorage(options);await restarted.reconcile();await neighbour('restart');
 await assert.rejects(restarted.provision({...a,venueId:randomUUID()}),/permission_denied/);
 // A real schema failure is a policy outage; existing writers must lose authority too.
 await db.pool.query('ALTER TABLE organisations RENAME TO organisations_unavailable');
 try{
  await assert.rejects(openPlanStorage(options));
  await assert.rejects(neighbour('policy-unavailable'),denied);
 }finally{await db.pool.query('ALTER TABLE organisations_unavailable RENAME TO organisations');}
 const recovered=await openPlanStorage(options),renewed=await recovered.provision(b);
 assert.notEqual(renewed.writerReference,peer.writerReference);await writer(renewed,b)('policy-restored');
 await assert.rejects(neighbour('old-after-policy-restored'),denied);
});

// The real managed-stream consumer must accept fresh references and preserve its original recovery identity.
test('ManagedStreams persists the adapter references and reprovisions a fresh writer after downgrade', {timeout:120000},async t=>{
 const {generateKeyPairSync,randomBytes}=await import('node:crypto');
 const {ManagedStreams}=await import('../../packages/backups/src/managed-streams.ts');
 const {BackupCatalogue}=await import('../../packages/backups/src/catalogue.ts');
 const {BackupKeyVault}=await import('../../packages/backups/src/keys.ts');
 const {BackupObjects}=await import('../../packages/backups/src/storage.ts');
 const {openPlanStorage}=await import('./service-runtime.mjs');
 const db=await database();t.after(()=>db.close());const storage=await startBackupStorage();t.after(()=>storage.stop());
 const organisationId=randomUUID(),business=randomUUID(),venueId=randomUUID(),localVenueId=randomUUID(),installationId=randomUUID(),publicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venueId,organisationId,business,localVenueId]);await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,publicKey]);await db.pool.query("INSERT INTO installation_services(installation_id,service) SELECT $1,unnest(ARRAY['retained_snapshots','continuous_backup','remote_access'])",[installationId]);
 const plans=new OrganisationPlanStore(db.pool);await plans.set(organisationId,'paid');
 const location=await storage.bucket('real-stream-'+venueId),vault=new BackupKeyVault(randomBytes(32)),objects=new BackupObjects(location,storage.admin,storage.ca);t.after(()=>objects.close());
 const catalogue=new BackupCatalogue(db.pool,vault,()=>objects,'test-free-paid');await catalogue.provision(installationId,location);
 const authority=await openPlanStorage({pool:db.pool,mode:'test-free-paid',directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()}),streams=new ManagedStreams(db.pool,vault,authority,'test-free-paid');
 const revision=async()=>Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installationId])).rows[0].configuration_revision);
 const input={localVenueId,sourceNodeId:randomUUID(),pointerSignerPublicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64')};
 const first=await streams.configure(installationId,await revision(),input),client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:{accessKeyId:first.bucket.accessKeyId,secretAccessKey:first.bucket.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>client.destroy());
 const write=key=>client.send(new PutObjectCommand({Bucket:location.bucket,Key:first.bucket.prefix+key,Body:'retained stream data'}));await write('before');
 const initial=(await db.pool.query('SELECT reader_reference,writer_reference FROM backup_managed_streams WHERE venue_id=$1',[venueId])).rows[0];
 await plans.set(organisationId,'free');await authority.reconcile();await assert.rejects(write('downgrade'),denied);
 await assert.rejects(streams.configure(installationId,await revision(),input),/permission_denied/);
 await plans.set(organisationId,'paid');await catalogue.provision(installationId,location);const next=await streams.configure(installationId,await revision(),input);
 const refreshed=(await db.pool.query('SELECT reader_reference,writer_reference FROM backup_managed_streams WHERE venue_id=$1',[venueId])).rows[0];
 assert.equal(refreshed.reader_reference,initial.reader_reference);assert.notEqual(refreshed.writer_reference,initial.writer_reference);assert.equal(next.recoveryKey===first.recoveryKey,true,'reprovisioning must retain the recovery key');assert.ok(next.bucket.accessKeyId!==first.bucket.accessKeyId,'the consumer must receive a fresh writer');
 assert.equal((await authority.read(refreshed.reader_reference,location,first.bucket.prefix+'before')).toString(),'retained stream data');
 await assert.rejects(write('old-after-upgrade'),denied);
 const upgraded=new S3Client({endpoint:storage.endpoint,region:'local',credentials:{accessKeyId:next.bucket.accessKeyId,secretAccessKey:next.bucket.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>upgraded.destroy());
 await upgraded.send(new PutObjectCommand({Bucket:location.bucket,Key:next.bucket.prefix+'upgraded',Body:'fresh stream data'}));
});
