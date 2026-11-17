import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {join} from 'node:path';
import {test} from 'node:test';
import {createLeaseIssuer,encodeMachine,InstallationStore} from '../../packages/registration/src/index.ts';
import {venueServiceFixture,set,read} from '../../packages/registration/test/fixtures/venue-service.ts';
import {BackupCatalogue} from '../../packages/backups/src/catalogue.ts';
import {BackupKeyVault} from '../../packages/backups/src/keys.ts';
import {ManagedStreamMachines} from '../../packages/account-http/src/managed-streams.ts';
import {RemoteAccessStore} from '../../packages/remote-access/src/placement.ts';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
import {executeTestServiceCommand} from './service-controls.mjs';
import {openPlanStorage} from './service-runtime.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const mode='test-venue-levels',origin='https://cloud.example.test';
const environment={CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0'};

// Removing the command, durable gate or writer withdrawal lets a box write after an owner stops backups.
test('backup switch withdraws real writers and survives setup and restart while remote routes stay available',{timeout:120000},async t=>{
 const f=await venueServiceFixture();t.after(()=>f.close());await set(f);
 const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[0]])).rows[0].id;
 const keys=generateKeyPairSync('ed25519'),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 await f.pool.query('UPDATE installations SET public_key=$2 WHERE id=$1',[installationId,keys.publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
 const revision=async()=>Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installationId])).rows[0].configuration_revision);
 let lease;
 function proof(action,body={}){const payload=encodeMachine({origin,installationId,operationId:randomUUID(),issuedAt:Date.now(),action,body:JSON.stringify(body),lease:lease?JSON.stringify(lease):''});return {payload:payload.toString('base64url'),signature:sign(null,payload,keys.privateKey).toString('base64url')};}
 const installations=new InstallationStore(f.pool,issuer,origin,undefined,mode);
 lease=(await installations.execute('renew',proof('renew'))).lease;
 const remote=new RemoteAccessStore(f.pool,mode),cellId=randomUUID();
 await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'test.example.test',subnet:81,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
 await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const storageOptions={pool:f.pool,mode,directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
 const authority=await openPlanStorage(storageOptions),vault=new BackupKeyVault(randomBytes(32));
 const location=await storage.bucket('backup-switch-'+f.venues[0]);
 const catalogue=new BackupCatalogue(f.pool,vault,()=>{throw Error('unexpected object operation');},mode);
 await catalogue.provision(installationId,location);
 const streams=new ManagedStreamMachines(f.pool,issuer,origin,vault,authority,undefined,mode);
 const input={sourceNodeId:randomUUID(),pointerSignerPublicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64')};
 const configure=async(target=streams)=>target.execute('backup-stream-configure',proof('backup-stream-configure',{revision:await revision(),...input}));
 const first=await configure();
 const clients=[];t.after(()=>clients.forEach(client=>client.destroy()));
 function writer(config){const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:{accessKeyId:config.bucket.accessKeyId,secretAccessKey:config.bucket.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});clients.push(client);return suffix=>client.send(new PutObjectCommand({Bucket:location.bucket,Key:config.bucket.prefix+suffix,Body:'retained backup'}));}
 const old=writer(first);await old('before');
 const context={pool:f.pool,issuer,origin,environment,storageOptions};
 assert.deepEqual(await executeTestServiceCommand(context,{command:'backups',installationId,enabled:false}),{enabled:false});
 await assert.rejects(old('off'),error=>error?.$metadata?.httpStatusCode===403);
 assert.equal((await read(f)).level,'connected');
 assert.deepEqual((await remote.manifest(cellId)).routes.map(route=>route.installationId),[installationId]);
 const status=await installations.execute('configuration',proof('configuration'));
 for(const name of ['continuous_backup','retained_snapshots']){const service=status.services.find(s=>s.service===name);assert.equal(service.state,'unconfigured');assert.deepEqual(service.configuration,{testCloudEnabled:false});}
 await assert.rejects(catalogue.provision(installationId,location),/backup.permission_denied/);
 await assert.rejects(catalogue.reserveCapture(installationId,randomUUID()),/backup.permission_denied/);
 // An independently permissive provider must not hide a missing signed-setup refusal.
 const forbidden=new ManagedStreamMachines(f.pool,issuer,origin,vault,{async provision(){throw Error('forbidden provider call');},read:authority.read},undefined,mode);
 await assert.rejects(configure(forbidden),/backup.permission_denied/);
 await assert.rejects(authority.provision({venueId:f.venues[0],location,prefix:first.bucket.prefix}),/permission_denied/);
 const reopened=await openPlanStorage(storageOptions);await reopened.reconcile();
 await assert.rejects(configure(),/backup.permission_denied/);
 assert.equal((await reopened.read((await f.pool.query('SELECT reader_reference FROM backup_managed_streams WHERE venue_id=$1',[f.venues[0]])).rows[0].reader_reference,location,first.bucket.prefix+'before')).toString(),'retained backup');
 assert.deepEqual(await executeTestServiceCommand(context,{command:'backups',installationId,enabled:true}),{enabled:true});
 await catalogue.provision(installationId,location);const next=await configure();
 assert.notEqual(next.bucket.accessKeyId,first.bucket.accessKeyId);assert.equal(next.recoveryKey,first.recoveryKey);
 await writer(next)('enabled');await assert.rejects(old('never-revived'),error=>error?.$metadata?.httpStatusCode===403);
 assert.deepEqual((await remote.manifest(cellId)).routes.map(route=>route.installationId),[installationId]);
 const production=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.production])).rows[0].id;
 await assert.rejects(executeTestServiceCommand(context,{command:'backups',installationId:production,enabled:false}),/test_cloud.service_target/);
 await assert.rejects(executeTestServiceCommand(context,{command:'backups',installationId,enabled:'false'}),/test_cloud.service_command/);
});
