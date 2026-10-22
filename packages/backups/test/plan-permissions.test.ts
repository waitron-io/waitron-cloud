import {verifyPointFixture} from './fixtures/verification.ts';
import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {login} from '@waitron-cloud/identity';
import {SignupStore,RegistrationStore,OrganisationPlanStore,InstallationStore,createLeaseIssuer,encodeMachine,transaction,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../src/managed-streams.ts';
import {BackupCaptures} from '../src/captures.ts';
import {BackupRecovery,recoveryPayload} from '../src/recovery.ts';
import {RecoveryRequests,requestPayload} from '../src/recovery-request.ts';
import {ReplacementStore,replacementPayload} from '../src/replacement.ts';
import {receipt} from '../src/storage.ts';
import {BackupWorker} from '../src/worker.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
const mode='test-free-paid',origin='https://cloud.test',password='a long enough plan test password';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const vault=new BackupKeyVault(randomBytes(32));
const workerImage='cloud-plan-worker:'+randomUUID(),execute=promisify(execFile),root=new URL('../../../',import.meta.url);
let workerImageBuilt=false;
let db:Awaited<ReturnType<typeof database>>,plans:OrganisationPlanStore;
let a:Awaited<ReturnType<typeof installed>>,b:typeof a;
const objects=new Map<string,Buffer>();
let grants=0,provisions=0,wait:(()=>Promise<void>)|undefined,removeWait:(()=>Promise<void>)|undefined;
const storage=()=>({async read(key:string){const v=objects.get(key);if(!v)throw Error('NoSuchKey');return v;},async put(key:string,v:Buffer){objects.set(key,Buffer.from(v));return receipt(v);},async remove(key:string){await removeWait?.();objects.delete(key);}});
const authority:ManagedStreamAuthority={async provision({venueId}){provisions++;await wait?.();return {writerReference:'writer:'+venueId,readerReference:'reader:'+venueId,writerCredentials:{accessKeyId:'writer',secretAccessKey:'private'}};},async read(){await wait?.();throw Error('NoSuchKey');}};
const catalogue=()=>new BackupCatalogue(db.pool,vault,storage,mode);
const streams=()=>new ManagedStreams(db.pool,vault,authority,mode);
const machines=()=>new InstallationStore(db.pool,issuer,origin,undefined,mode);
async function installed(label:string){
 const email=label+'@example.test',signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:label,legalBusinessName:label+' SL',countryCode:'ES'});
 const session=await transaction(db.pool,c=>login(c,{email,password}));
 const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const binding={operationId:randomUUID(),installationKey:publicKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(db.pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());
 return {...owner,...session,...await registration.complete(binding),key,publicKey,localVenueId:binding.localVenueId};
}
const location=(item=a)=>({endpoint:'https://store.test',bucket:'venue-'+item.venueId,region:'local'});
const streamInput=()=>({localVenueId:a.localVenueId,sourceNodeId:randomUUID(),pointerSignerPublicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64')});
function proof(action:MachineAction,lease?:SignedEnvelope,body:unknown={},id=randomUUID()){
 const bytes=encodeMachine({origin,action,installationId:a.installationId,operationId:id,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
 return {payload:bytes.toString('base64url'),signature:sign(null,bytes,a.key.privateKey).toString('base64url')};
}
async function revision(){return Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[a.installationId])).rows[0].configuration_revision);}
async function paid(){await plans.set(a.organisationId,'paid');await catalogue().provision(a.installationId,location());}
async function snapshot(days=0){
 const reserved=await catalogue().reserveCapture(a.installationId,randomUUID()),bytes=Buffer.from('encrypted archive '+reserved.id);objects.set(reserved.incomingKey,bytes);
 const metadata={...receipt(bytes),capturedAt:new Date(Date.now()-days*86400000).toISOString(),retention:'daily' as const,sourceNodeId:randomUUID(),modules:{core:1}};
 const point=await catalogue().publish(a.installationId,reserved.id,metadata);await verifyPointFixture(db.pool,catalogue(),point.id);return {point,metadata};
}
before(async()=>{db=await database();plans=new OrganisationPlanStore(db.pool);await execute('docker',['build','-q','-t',workerImage,'-f','packages/backups/test/container-fixture/Worker.Dockerfile','.'],{cwd:root,timeout:120000});workerImageBuilt=true;},{timeout:150000});
after(async()=>{try{if(workerImageBuilt)await execute('docker',['image','rm',workerImage],{timeout:30000});}finally{await db?.close();}});
beforeEach(async()=>{await resetSchema(db.pool);objects.clear();grants=0;provisions=0;wait=undefined;removeWait=undefined;a=await installed('plan-a');b=await installed('plan-b');});

// Removing the paid admission check would let a free organisation obtain keys or mutate storage state.
test('free_cannot_provision_reserve_publish_or_rotate',async()=>{
 await assert.rejects(catalogue().provision(a.installationId,location()),/permission_denied/);
 await paid();const item=await snapshot();await plans.set(a.organisationId,'free');
 await assert.rejects(catalogue().reserveCapture(a.installationId,randomUUID()),/permission_denied/);
 await assert.rejects(catalogue().publish(a.installationId,item.point.id,item.metadata),/permission_denied/);
 await assert.rejects(catalogue().rotate(a.installationId),/permission_denied/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_key_versions')).rows[0].count,'1');
});
test('free_cannot_configure_observe_stream_or_obtain_recovery_keys',async()=>{
 await paid();const rev=await revision();await plans.set(a.organisationId,'free');
 await assert.rejects(streams().configure(a.installationId,rev,streamInput()),/permission_denied/);
 await assert.rejects(streams().observe(a.installationId,rev),/permission_denied/);
 await assert.rejects(streams().recovery(a.venueId,rev),/permission_denied/);assert.equal(provisions,0);
});
test('cached_machine_reply_never_reissues_paid_configuration',async()=>{
 await paid();const store=machines();const configured=await store.configure(a.installationId,await revision(),[{service:'remote_access',state:'ready',configuration:{secret:'private-gateway'}}]);
 const renew=proof('renew'),first=await store.execute('renew',renew);assert(first.lease);assert(JSON.stringify(first).includes('private-gateway'));
 const config=proof('configuration',first.lease,{servicesVersion:2}),report=proof('report',first.lease,{revision:configured.revision,observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]});
 await store.execute('configuration',config);await store.execute('report',report);await plans.set(a.organisationId,'free');
 const cleared=(await db.pool.query("SELECT state,configuration FROM installation_services WHERE installation_id=$1 AND service<>'content_translation' ORDER BY service",[a.installationId])).rows;
 assert.deepEqual(cleared,[{state:'unconfigured',configuration:{}},{state:'unconfigured',configuration:{}},{state:'unconfigured',configuration:{}}]);
 for(const [action,envelope] of [['renew',renew],['configuration',config],['report',report]] as const){
  const current=await store.execute(action,envelope);assert.equal(current.revision,configured.revision+1);
  for(const s of current.services.filter(s=>s.service!=='content_translation')){assert.equal(s.state,'unconfigured');assert.deepEqual(s.configuration,{});assert.equal(s.health,'unknown');}
  assert.equal(current.services.some(s=>s.service==='content_translation'),action==='configuration');
 }
 await assert.rejects(store.configure(a.installationId,await revision(),[{service:'retained_snapshots',state:'ready',configuration:{key:'secret'}}]),/permission_denied/);
});
test('downgrade_advances_each_installation_once_and_keeps_other_organisation',async()=>{
 const before=await revision();await plans.set(a.organisationId,'paid');assert.equal(await revision(),before+1);
 const same=await plans.set(a.organisationId,'paid');assert.equal(same.changed,false);assert.equal(await revision(),before+1);
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[b.installationId])).rows[0].configuration_revision,0);
 await plans.set(a.organisationId,'free');assert.equal(await revision(),before+2);
});
test('provider_wait_rechecks_downgrade',async()=>{
 await paid();const lease=(await machines().execute('renew',proof('renew'))).lease;assert(lease);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 const captures=new BackupCaptures(db.pool,issuer,origin,{vault,objects:storage,planMode:mode,async grant(){grants++;entered();await blocked;return {credentials:{accessKeyId:'a',secretAccessKey:'b',sessionToken:'c'},expiresAt:new Date(Date.now()+900000).toISOString()};}});
 const pending=captures.execute('backup-reserve',proof('backup-reserve',lease));const rejected=assert.rejects(pending,/permission_denied/);
 await started;try{await plans.set(a.organisationId,'free');}finally{release();}await rejected;assert.equal(grants,1);
});
test('stream_provider_wait_rechecks_downgrade',async()=>{
 await paid();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);wait=async()=>{entered();await blocked;};
 const pending=streams().configure(a.installationId,await revision(),streamInput()),rejected=assert.rejects(pending,/permission_denied/);
 await started;try{await plans.set(a.organisationId,'free');}finally{release();}await rejected;
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_managed_streams')).rows[0].count,'0');
});
test('downgrade_preserves_last_verified_snapshot_and_pauses_expiry',async()=>{
 await paid();const first=await snapshot(90),second=await snapshot(80);await plans.set(a.organisationId,'free');
 assert.equal(await catalogue().cleanupOne(a.venueId),null);assert(objects.has(first.point.objectKey));assert(objects.has(second.point.objectKey));
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_points WHERE NOT deleting AND deleted_at IS NULL')).rows[0].count,'2');
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_key_versions')).rows[0].count,'1');
});
test('metadata_and_close_survive_downgrade_but_target_read_and_replacement_completion_do_not',async()=>{
 await paid();const {point}=await snapshot(),target=generateKeyPairSync('ed25519'),targetKey=target.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const recovery=new BackupRecovery(db.pool,vault,origin,undefined,mode),id=randomUUID();
 await recovery.start(a.token,a.csrfToken,{id,pointId:point.id,mode:'failure',targetPublicKey:targetKey,oldServerUnavailable:true,acceptDataLoss:true});
 await plans.set(a.organisationId,'free');assert.equal((await recovery.catalogue(a.token,a.venueId)).points.length,1);assert.equal((await recovery.status(a.token,id)).id,id);
 const bytes=recoveryPayload(origin,id,'read',point.digest,Date.now()),signed={payload:bytes.toString('base64url'),signature:sign(null,bytes,target.privateKey).toString('base64url')};
 await assert.rejects(recovery.target(id,'read',signed),/permission_denied/);
 await assert.rejects(recovery.start(a.token,a.csrfToken,{id,pointId:point.id,mode:'failure',targetPublicKey:targetKey,oldServerUnavailable:true,acceptDataLoss:true}),/permission_denied/);
 await assert.rejects(new ReplacementStore(db.pool,vault,origin,mode).complete(id,a.token,a.csrfToken,{oldInstallationId:a.installationId,oldServerUnavailable:true,confirmReplacement:true}),/permission_denied/);
 await recovery.close(a.token,a.csrfToken,id);assert.equal((await recovery.status(a.token,id)).status,'closed');
});
test('upgrade_reprovisions_existing_location_and_stream_binding',async()=>{
 await paid();const input=streamInput(),first=await streams().configure(a.installationId,await revision(),input);
 await plans.set(a.organisationId,'free');await plans.set(a.organisationId,'paid');await catalogue().provision(a.installationId,location());
 const fresh=await streams().configure(a.installationId,await revision(),input);assert(fresh.configurationRevision>first.configurationRevision);
 const view=await machines().execute('renew',proof('renew'));assert.equal(view.services.find(s=>s.service==='retained_snapshots')?.state,'provisioning');assert.equal(view.services.find(s=>s.service==='continuous_backup')?.state,'provisioning');
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_key_versions')).rows[0].count,'1');
});

test('free_HTTP_refusal_has_existing_permission_code_and_no_grant_or_key',async()=>{
 await paid();await plans.set(a.organisationId,'free');
 const lease=(await machines().execute('renew',proof('renew'))).lease;assert(lease);
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:issuer,planMode:mode,
  captures:{vault,objects:storage,managedStreams:authority,async grant(){grants++;throw Error('free grant called');}}});
 const request=async(action:MachineAction,body:unknown={})=>app.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof(action,lease,body))},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as Parameters<typeof app.request>[2]);
 const reserve=await request('backup-reserve');assert.equal(reserve.status,403);assert.deepEqual(await reserve.json(),{error:'permission_denied'});
 const stream=await request('backup-stream-configure',{revision:await revision(),...streamInput()});assert.equal(stream.status,403);assert.deepEqual(await stream.json(),{error:'permission_denied'});
 assert.equal(grants,0);assert.equal(provisions,0);
});

test('test_plan_mode_rejects_production_installation_and_authenticates_before_policy',async()=>{
 const lease=(await machines().execute('renew',proof('renew'))).lease;assert(lease);
 const captures=new BackupCaptures(db.pool,issuer,origin,{vault,objects:storage,planMode:mode,async grant(){grants++;throw Error('unexpected grant');}});
 const forged={...proof('backup-reserve',lease),signature:sign(null,Buffer.from('wrong'),a.key.privateKey).toString('base64url')};
 await assert.rejects(captures.execute('backup-reserve',forged),/invalid_proof/);
 await plans.set(a.organisationId,'paid');await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[a.venueId]);
 await assert.rejects(catalogue().provision(a.installationId,location()),/permission_denied/);
 await assert.rejects(machines().execute('renew',proof('renew')),/permission_denied/);assert.equal(grants,0);
});

test('production_machine_HTTP_uses_existing_permission_denied_response',async()=>{
 await plans.set(a.organisationId,'paid');await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[a.venueId]);
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:issuer,planMode:mode});
 const response=await app.request(origin+'/api/installations/renew',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof('renew'))},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as Parameters<typeof app.request>[2]);
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
});

test('plan_lock_order_survives_pairing_replacement_and_two_installations',async()=>{
 await paid();const second=await pairAnother(),reg=new RegistrationStore(db.pool),pendingBinding=binding();
 await reg.start(pendingBinding);await reg.approveCloud(pendingBinding,a.accountId);await reg.approveLocal(pendingBinding,randomUUID());
 const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
 const change=plans.set(a.organisationId,'free');
 try {
  await waitForQuery('SELECT i.id FROM installations i JOIN venues v%');
  // Pairing and new organisation references can finish while the setter waits on an installation.
  await reg.complete(pendingBinding);
  await transaction(db.pool,async client=>{await client.query("SET LOCAL lock_timeout='500ms'");await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[randomUUID(),a.organisationId]);});
 } finally {await blocker.query('ROLLBACK');blocker.release();}
 await change;
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[second.installationId])).rows[0].configuration_revision,1);
 // A setter waiting behind a policy reader cannot take installation locks first.
 const reader=await db.secondPool.connect();await reader.query('BEGIN');await reader.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[a.organisationId]);
 const upgrade=plans.set(a.organisationId,'paid');
 try {await waitForQuery('SELECT id,service_plan,service_plan_revision FROM organisations%');await reader.query('SELECT id FROM installations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[a.installationId,second.installationId]]);}
 finally {await reader.query('ROLLBACK');reader.release();}
 await upgrade;assert.equal((await plans.show(a.organisationId)).plan,'paid');
});
function binding(){return {operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:a.organisationId,legalBusinessId:a.legalBusinessId};}
async function pairAnother(){const r=new RegistrationStore(db.pool),b=binding();await r.start(b);await r.approveCloud(b,a.accountId);await r.approveLocal(b,randomUUID());return r.complete(b);}
async function waitForQuery(pattern:string){
 for(let n=0;n<200;n++){if((await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,pattern])).rowCount)return;await new Promise(r=>setTimeout(r,5));}
 assert.fail('expected database lock wait: '+pattern);
}

test('replacement_replay_rechecks_policy_and_concurrent_downgrade_cannot_deadlock',async()=>{
 await paid();const {point}=await snapshot(),target=generateKeyPairSync('ed25519'),targetKey=target.publicKey.export({type:'spki',format:'der'}).toString('base64url'),id=randomUUID();
 const recovery=new BackupRecovery(db.pool,vault,origin,undefined,mode);await recovery.start(a.token,a.csrfToken,{id,pointId:point.id,mode:'failure',targetPublicKey:targetKey,oldServerUnavailable:true,acceptDataLoss:true});
 const restored=recoveryPayload(origin,id,'restored',point.digest,Date.now());await recovery.target(id,'restored',{payload:restored.toString('base64url'),signature:sign(null,restored,target.privateKey).toString('base64url')});
 const fresh=generateKeyPairSync('ed25519'),proposed={id,localVenueId:a.localVenueId,nodeId:point.sourceNodeId,publicKey:fresh.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey:randomBytes(32).toString('base64')};
 const envelope=(action:'prepare'|'status')=>{const bytes=replacementPayload(origin,action,proposed,Date.now());return {id,payload:bytes.toString('base64url'),signature:sign(null,bytes,target.privateKey).toString('base64url'),keySignature:sign(null,bytes,fresh.privateKey).toString('base64url')};};
 const replacement=new ReplacementStore(db.pool,vault,origin,mode);await replacement.machine('prepare',envelope('prepare'));
 const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[a.venueId]);
 const completion=replacement.complete(id,a.token,a.csrfToken,{oldInstallationId:a.installationId,oldServerUnavailable:true,confirmReplacement:true});
 let downgrade:ReturnType<typeof plans.set>|undefined;
 try{await waitForQuery('SELECT id FROM venues%');downgrade=plans.set(a.organisationId,'free');await waitForQuery('SELECT id,service_plan,service_plan_revision FROM organisations%');}
 finally{await blocker.query('ROLLBACK');blocker.release();}
 const result=await completion;assert.equal(result.state,'complete');await downgrade;
 await assert.rejects(replacement.machine('status',envelope('status')),/permission_denied/);
 await assert.rejects(replacement.complete(id,a.token,a.csrfToken,{oldInstallationId:a.installationId,oldServerUnavailable:true,confirmReplacement:true}),/permission_denied/);
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[result.registration.installationId])).rows[0].configuration_revision,2);
});

test('retention_deletion_cannot_continue_after_a_committed_downgrade',async()=>{
 await paid();const old=await snapshot(90);await snapshot(80);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 removeWait=async()=>{entered();await blocked;};const cleaning=catalogue().cleanupOne(a.venueId);await started;
 const change=plans.set(a.organisationId,'free');
 try{await waitForQuery('SELECT id,service_plan,service_plan_revision FROM organisations%');assert.equal((await plans.show(a.organisationId)).plan,'paid');}
 finally{release();await cleaning;await change;}
 assert.equal(objects.has(old.point.objectKey),false);assert.equal((await plans.show(a.organisationId)).plan,'free');
});

test('plan_transition_rolls_back_configuration_together_with_policy',async()=>{
 await paid();const before=await machines().execute('renew',proof('renew'));
 await db.pool.query("CREATE FUNCTION reject_plan_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'plan-commit-refused'; END $$");
 await db.pool.query('CREATE CONSTRAINT TRIGGER reject_plan_commit AFTER UPDATE ON organisations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_plan_commit()');
 await assert.rejects(plans.set(a.organisationId,'free'),/plan-commit-refused/);
 const after=await machines().execute('renew',proof('renew'));assert.equal(after.revision,before.revision);assert.deepEqual(after.services,before.services);assert.equal((await plans.show(a.organisationId)).plan,'paid');
});

test('fresh_machine_and_account_views_mask_existing_free_configuration',async()=>{
 const ordinary=new InstallationStore(db.pool,issuer,origin);
 await ordinary.configure(a.installationId,0,[{service:'retained_snapshots',state:'ready',configuration:{secret:'legacy-secret'}}]);
 const current=await machines().execute('renew',proof('renew'));
 assert.equal(JSON.stringify(current).includes('legacy-secret'),false);assert.equal(current.services.find(s=>s.service==='retained_snapshots')?.state,'unconfigured');
 const list=await machines().listWithSession(a.token);assert.equal(list[0]?.services.find(s=>s.service==='retained_snapshots')?.state,'unconfigured');
 assert.equal((await ordinary.execute('renew',proof('renew'))).services.find(s=>s.service==='retained_snapshots')?.state,'ready');
});

test('recovery_approval_and_HTTP_provider_wait_use_current_plan',async()=>{
 await paid();const {point}=await snapshot(),target=generateKeyPairSync('ed25519'),id=randomUUID(),code='12345678';
 const publicKey=target.publicKey.export({type:'spki',format:'der'}).toString('base64url'),request=requestPayload(origin,id,'start',publicKey,code,Date.now());
 const requests=new RecoveryRequests(db.pool,vault,origin,undefined,mode);await requests.machine('start',{payload:request.toString('base64url'),signature:sign(null,request,target.privateKey).toString('base64url')});
 const selection={pointId:point.id,oldServerUnavailable:true,acceptDataLoss:true};await plans.set(a.organisationId,'free');
 await assert.rejects(requests.approve(id,code,a.token,a.csrfToken,selection),/permission_denied/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries')).rows[0].count,'0');
 await plans.set(a.organisationId,'paid');await requests.approve(id,code,a.token,a.csrfToken,selection);
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:issuer,planMode:mode,
  captures:{vault,objects:storage,async grant(){grants++;await plans.set(a.organisationId,'free');return {credentials:{accessKeyId:'a',secretAccessKey:'b',sessionToken:'c'},expiresAt:new Date(Date.now()+900000).toISOString()};}}});
 const bytes=recoveryPayload(origin,id,'read',point.digest,Date.now());
 const response=await app.request(origin+'/api/recovery/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,payload:bytes.toString('base64url'),signature:sign(null,bytes,target.privateKey).toString('base64url')})},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as Parameters<typeof app.request>[2]);
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});assert.equal(grants,1);
});

test('ordinary_mode_keeps_missing_installation_and_local_backup_refusal_order',async()=>{
 const bytes=encodeMachine({origin,action:'renew',installationId:randomUUID(),operationId:randomUUID(),issuedAt:Date.now(),lease:'',body:'{}'});
 await assert.rejects(new InstallationStore(db.pool,issuer,origin).execute('renew',{payload:bytes.toString('base64url'),signature:sign(null,bytes,a.key.privateKey).toString('base64url')}),/unavailable/);
 await new BackupCatalogue(db.pool,vault,storage).provision(a.installationId,location());await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[a.venueId]);
 const captures=new BackupCaptures(db.pool,issuer,origin,{vault,objects:storage,async grant(){throw Error('unexpected grant');}});
 const forged={...proof('backup-reserve'),signature:sign(null,Buffer.from('wrong'),a.key.privateKey).toString('base64url')};
 await assert.rejects(captures.execute('backup-reserve',forged),/backup.local_integration_only/);
});

test('worker_CLI_test_mode_pauses_free_expiry_without_contacting_storage',async()=>{
 await paid();const first=await snapshot(90);await snapshot(80);await plans.set(a.organisationId,'free');
 const worker=new BackupWorker(db.pool,catalogue(),async()=>assert.fail('scheduling cannot verify'),'plan-fixture');await worker.schedule();
 await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'retention'");
 {
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);
  const directory=await mkdtemp(join(tmpdir(),'plan-worker-controller-'));
  try{const imageId=(await execute('docker',['image','inspect','--format','{{.Id}}',workerImage])).stdout.trim();
  const result=await execute(process.execPath,['packages/backups/src/worker-cli.ts','--once'],{cwd:root,timeout:30000,env:{PATH:process.env.PATH,DATABASE_URL:url.href,CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_BACKUP_MASTER_KEY:randomBytes(32).toString('hex'),CLOUD_VERIFIER_IMAGE:imageId,CLOUD_VERIFIER_OWNER:'plan-'+randomUUID(),LOCAL_STACK_CONFIG_DIR:directory,CLOUD_BACKUP_ENDPOINT:'https://127.0.0.1:9',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'test',CLOUD_BACKUP_SECRET_KEY:'test'}});
  assert.equal(JSON.parse(result.stdout).failures,0);
  assert.deepEqual((await db.pool.query('SELECT deleting,deleted_at FROM backup_points WHERE id=$1',[first.point.id])).rows[0],{deleting:false,deleted_at:null});
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});
test('worker_CLI_rejects_malformed_plan_mode_before_mutation',async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);
 await assert.rejects(promisify(execFile)(process.execPath,['packages/backups/src/worker-cli.ts','--retry-failed'],{cwd:new URL('../../../',import.meta.url),timeout:30000,env:{PATH:process.env.PATH,DATABASE_URL:url.href,CLOUD_TEST_SERVICE_PLANS:'true'}}));
});
