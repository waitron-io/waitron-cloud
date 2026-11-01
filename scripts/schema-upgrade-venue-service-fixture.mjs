import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Agent} from 'node:https';
import {createRequire} from 'node:module';
import {source,digest} from './schema-upgrade-fixture.mjs';
import {billingState} from './schema-upgrade-billing-fixture.mjs';
import {backupState} from './schema-upgrade-backup-fixture.mjs';
import {startBackupStorage} from './backup-storage-fixture.mjs';

const require=createRequire(new URL('../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}});
export async function venueServiceAuthorityState(pool){
 const state={billing:await billingState(pool),backups:await backupState(pool)};
 for(const table of ['billing_service_authority','installations','installation_services'])state[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return state;
}
async function change(store,scope,venueId,level){
 const prior=await store.venue(scope,venueId),command={type:'set_venue',venueId,expectedRevision:prior.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}},stamp=event();
 return {scope,command,event:stamp,receipt:await store.transition(scope,stamp,command)};
}
export async function seedVenueServiceAuthority(root,pool,state){
 const {BillingStore,transaction,readVenuePermissions,parsePlanMode}=await source(root,'packages/registration/src/index.ts');
 const {openRuntimeStorage}=await source(root,'deploy/test-cloud/service-runtime.mjs');
 assert.equal(parsePlanMode(undefined,undefined),'existing');
 assert.equal((await pool.query('SELECT count(*) FROM billing_service_authority')).rows[0].count,'0');
 const store=new BillingStore(pool),items=[];
 for(let i=0;i<state.owners.length;i++){
  const owner=state.owners[i],scope={organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  items.push(await change(store,scope,state.installations[i].venueId,'connected'));
 }
 const scope=items[0].scope,venueId=randomUUID();
 await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,scope.organisationId,scope.legalBusinessId]);
 const today=(await pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 const trial={type:'start_trial',venueId,level:'connected',on:today},trialEvent=event();
 const trialReceipt=await store.transition(scope,trialEvent,trial);
 items.push({scope,command:trial,event:trialEvent,receipt:trialReceipt});
 const end=(await store.history(scope,venueId)).trials[0].endsOn;
 const extension={type:'extend_trial',venueId,level:'connected',expectedEnd:end},extensionEvent=event();
 items.push({scope,command:extension,event:extensionEvent,receipt:await store.execute(scope,extensionEvent,extension)});
 const storage=await startBackupStorage();
 try{
  const installed=state.installations[0],location=await storage.bucket('authority-'+randomUUID()),input={venueId:installed.venueId,location,prefix:`streams/${installed.venueId}/`};
  const options={pool,mode:'test-venue-levels',directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
  const authority=await openRuntimeStorage(options),grant=await authority.provision(input);
  const writer=new S3Client({endpoint:storage.endpoint,region:'local',credentials:grant.writerCredentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});
  const oldState=await readFile(join(options.directory,'state.json'));
  try{await writer.send(new PutObjectCommand({Bucket:location.bucket,Key:input.prefix+'retained',Body:'restored venue stream'}));}finally{writer.destroy();}
  items.push(await change(store,scope,installed.venueId,'registered'));
  items.push(await change(store,scope,installed.venueId,'connected'));
  const current=await authority.provision(input);
  assert.notEqual(current.writerReference,grant.writerReference);assert.equal(current.readerReference,grant.readerReference);
  const permission=await transaction(pool,c=>readVenuePermissions(c,installed.venueId,'test-venue-levels'));assert.equal(permission.revision,3);
  const proof={items,storage,options,input,grant,current,oldState,backup:state.backupProof};
  await restoredVenueServiceAuthority(root,pool,proof,await venueServiceAuthorityState(pool));
  return proof;
 }catch(error){await storage.stop();throw error;}
}
export async function restoredVenueServiceAuthority(root,pool,proof,expected){
 const {BillingStore,transaction,readVenuePermissions}=await source(root,'packages/registration/src/index.ts');
 const {BackupKeyVault}=await source(root,'packages/backups/src/keys.ts');
 assert.equal(digest(await venueServiceAuthorityState(pool)),digest(expected),'authority facts setup keys and holds survive exactly');
 const store=new BillingStore(pool);
 for(const item of proof.items){
  const invoke=item.command.type==='extend_trial'?'execute':'transition';
  assert.deepEqual(await store[invoke](item.scope,item.event,item.command),item.receipt);
  const foreign=proof.items.find(other=>other.scope.organisationId!==item.scope.organisationId).scope;
  await assert.rejects(store.transition(foreign,event(),{type:'set_venue',venueId:item.command.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}}),{code:'billing_scope_not_found'});
 }
 const current=await transaction(pool,c=>readVenuePermissions(c,proof.input.venueId,'test-venue-levels'));
 assert.equal(current.level,'connected');assert.equal(current.revision,3);
 const trial=proof.items.find(item=>item.command.type==='start_trial');
 const permission=await transaction(pool,c=>readVenuePermissions(c,trial.command.venueId,'test-venue-levels'));
 assert.equal(permission.level,'connected');assert.equal(permission.revision,2);
 const backup=proof.backup,key=(await pool.query('SELECT sealed FROM backup_key_versions WHERE venue_id=$1 AND version=1',[backup.venueId])).rows[0];
 assert.deepEqual(backup.vault.open(backup.venueId,1,key.sealed),backup.keys);
 assert.throws(()=>new BackupKeyVault(randomBytes(32)).open(backup.venueId,1,key.sealed),/key_unavailable/);
 assert.throws(()=>new BackupKeyVault(Buffer.alloc(0)),/key_configuration/);
 assert.equal((await pool.query('SELECT point_id FROM backup_recoveries WHERE id=$1',[backup.holdId])).rows[0].point_id,backup.pointId);
 assert.equal(digest(await venueServiceAuthorityState(pool)),digest(expected),'event retries and foreign refusals leave restored rows unchanged');
}
export async function qualifyRestoredVenueWriter(root,pool,proof){
 const {openRuntimeStorage}=await source(root,'deploy/test-cloud/service-runtime.mjs');
 const directory=join(proof.storage.root,'restored-managed');await mkdir(directory,{mode:0o700});
 await writeFile(join(directory,'state.json'),proof.oldState,{mode:0o600});
 const restored=await openRuntimeStorage({...proof.options,pool,directory});
 const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 assert.equal(state.venues[proof.input.venueId].writer,null,'stale writer is withdrawn before restored readiness');
 const writer=new S3Client({endpoint:proof.storage.endpoint,region:'local',credentials:proof.grant.writerCredentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:proof.storage.ca})}});
 try{
  await assert.rejects(writer.send(new PutObjectCommand({Bucket:proof.input.location.bucket,Key:proof.input.prefix+'stale',Body:'refused'}),{abortSignal:AbortSignal.timeout(5000)}),error=>error?.$metadata?.httpStatusCode===403);
 }finally{writer.destroy();}
 assert.equal((await restored.read(proof.grant.readerReference,proof.input.location,proof.input.prefix+'retained')).toString(),'restored venue stream');
 return true;
}
