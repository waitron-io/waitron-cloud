import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,type KeyObject} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {InstallationStore,RegistrationStore,SignupStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '../src/index.ts';
const origin='https://cloud.example.test',original=['continuous_backup','remote_access','retained_snapshots'];
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,venue:{installationId:string;venueId:string},key:KeyObject;
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('fourth@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const pair=generateKeyPairSync('ed25519');key=pair.privateKey;
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'),
  localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
});
function proof(action:MachineAction,body:unknown,operationId=randomUUID(),lease?:SignedEnvelope):SignedEnvelope{
 return rawProof(action,JSON.stringify(body),operationId,lease);
}
function rawProof(action:MachineAction,body:string,operationId=randomUUID(),lease?:SignedEnvelope):SignedEnvelope{
 const payload=encodeMachine({origin,action,installationId:venue.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body});
 return {payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')};
}
const services=async()=>(await db.pool.query('SELECT service,state FROM installation_services WHERE installation_id=$1 ORDER BY service',[venue.installationId])).rows;
test('a new installation has the three original services unconfigured and translation ready',async()=>{
 assert.deepEqual(await services(),[{service:'content_translation',state:'ready'},{service:'continuous_backup',state:'unconfigured'},
  {service:'remote_access',state:'unconfigured'},{service:'retained_snapshots',state:'unconfigured'}]);
});
test('backfill preserves existing services, configuration, revision and revocation',async()=>{
 await db.pool.query("UPDATE installation_services SET state='failed',configuration=$2 WHERE installation_id=$1",[venue.installationId,{retained:'configuration'}]);
 await db.pool.query('UPDATE installations SET configuration_revision=7,revoked_at=clock_timestamp() WHERE id=$1',[venue.installationId]);
 const snapshot=async()=>({services:(await db.pool.query('SELECT * FROM installation_services ORDER BY service')).rows,installation:(await db.pool.query('SELECT * FROM installations')).rows});
 const before=await snapshot(),sql=await readFile(new URL('../migrations/041_content_translation_service.sql',import.meta.url),'utf8');
 await Promise.all([db.pool.query(sql),db.secondPool.query(sql)]);
 assert.deepEqual(await snapshot(),before);
 await db.pool.query("DELETE FROM installation_services WHERE installation_id=$1 AND service='content_translation'",[venue.installationId]);
 await Promise.all([db.pool.query(sql),db.secondPool.query(sql)]);
 assert.deepEqual((await snapshot()).services.filter(s=>s.service!=='content_translation'),before.services.filter(s=>s.service!=='content_translation'));
 assert.deepEqual((await snapshot()).installation,before.installation);
 assert.deepEqual((await services()).filter(s=>s.service==='content_translation'),[{service:'content_translation',state:'ready'}]);
 await assert.rejects(new InstallationStore(db.pool,issuer,origin).execute('renew',proof('renew',{})),/revoked/);
});
test('version opt-in requires exact signed bytes and applies only to configuration',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),lease=(await store.execute('renew',proof('renew',{}))).lease!;
 for(const text of [' {"servicesVersion":2}','{"servicesVersion":2} ','{"servicesVersion": 2}','{"servicesVersion":2.0}','{"servicesVersion":2,"servicesVersion":2}','null','[]'])
  await assert.rejects(store.execute('configuration',rawProof('configuration',text,randomUUID(),lease)),/invalid_proof/,text);
 for(const action of ['renew','report','revoke'] as const)
  await assert.rejects(store.execute(action,proof(action,{servicesVersion:2},randomUUID(),action==='report'?lease:undefined)),/invalid_proof/,action);
 await assert.rejects(store.execute('report',proof('report',{revision:0,observedAt:Date.now(),services:[{service:'content_translation',health:'healthy',failure:null}]},randomUUID(),lease)),/invalid_proof/);
 await assert.rejects(store.configure(venue.installationId,0,[{service:'content_translation' as never,state:'failed',configuration:{}}]),/invalid_proof/);
 assert.equal((await store.execute('revoke',proof('revoke',{}))).services.length,3);
});
test('a retried version-2 result stays durable while fresh reads reflect current state',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),lease=(await store.execute('renew',proof('renew',{}))).lease!,operationId=randomUUID();
 const first=await store.execute('configuration',proof('configuration',{servicesVersion:2},operationId,lease));
 await store.configure(venue.installationId,0,[{service:'remote_access',state:'ready',configuration:{hostname:'changed.example.test'}}]);
 const second=new InstallationStore(db.secondPool,issuer,origin);
 assert.deepEqual(await second.execute('configuration',proof('configuration',{servicesVersion:2},operationId,lease)),first);
 const current=await second.execute('configuration',proof('configuration',{servicesVersion:2},randomUUID(),lease));
 assert.equal(current.revision,1);assert.equal(current.services.find(s=>s.service==='remote_access')!.state,'ready');
 await assert.rejects(store.execute('configuration',proof('configuration',{},operationId,lease)),/conflict/);
 const legacyId=randomUUID();await store.execute('configuration',proof('configuration',{},legacyId,lease));
 await assert.rejects(store.execute('configuration',proof('configuration',{servicesVersion:2},legacyId,lease)),/conflict/);
 assert.equal((await db.pool.query("SELECT count(*)::integer AS n FROM installation_operations WHERE installation_id=$1 AND operation_id=$2",[venue.installationId,operationId])).rows[0].n,1);
 await store.execute('revoke',proof('revoke',{}));
 await assert.rejects(store.execute('configuration',proof('configuration',{servicesVersion:2},operationId,lease)),/revoked/);
});
test('version-2 configuration still requires a valid signature and matching current lease',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),renewed=await store.execute('renew',proof('renew',{})),lease=renewed.lease!;
 await assert.rejects(store.execute('configuration',proof('configuration',{servicesVersion:2})),/invalid_proof/);
 const valid=proof('configuration',{servicesVersion:2},randomUUID(),lease);
 const wrong=generateKeyPairSync('ed25519').privateKey;
 await assert.rejects(store.execute('configuration',{...valid,signature:sign(null,Buffer.from(valid.payload,'base64url'),wrong).toString('base64url')}),/invalid_proof/);
 const now=Date.now(),publicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
 for(const overrides of [{venueId:randomUUID()},{installationId:randomUUID()},{publicKey},{issuedAt:now-7200000,expiresAt:now-3600000}]){
  const mismatched=issuer.issue({origin,leaseId:randomUUID(),installationId:venue.installationId,venueId:venue.venueId,environment:'test',publicKey:(await db.pool.query('SELECT public_key FROM installations WHERE id=$1',[venue.installationId])).rows[0].public_key,issuedAt:now,expiresAt:now+3600000,...overrides});
  await assert.rejects(store.execute('configuration',proof('configuration',{servicesVersion:2},randomUUID(),mismatched)),/invalid_proof/);
 }
});
test("041's backfill gives an installation that lacks translation one ready row, once",async()=>{
 await db.pool.query("DELETE FROM installation_services WHERE installation_id=$1 AND service='content_translation'",[venue.installationId]);
 const sql=await readFile(new URL('../migrations/041_content_translation_service.sql',import.meta.url),'utf8');
 await db.pool.query(sql);await db.pool.query(sql);
 assert.deepEqual((await services()).filter(s=>s.service==='content_translation'),[{service:'content_translation',state:'ready'}]);
});
test('configuration answers three services to {} and four to servicesVersion 2, replays a retry, and refuses any other body',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),lease=(await store.execute('renew',proof('renew',{}))).lease!;
 assert.deepEqual((await store.execute('configuration',proof('configuration',{},randomUUID(),lease))).services.map(s=>s.service),original);
 const op=randomUUID(),four=await store.execute('configuration',proof('configuration',{servicesVersion:2},op,lease));
 assert.deepEqual(four.services.map(s=>s.service).sort(),[...original,'content_translation'].sort());
 assert.deepEqual(four.services.find(s=>s.service==='content_translation'),{service:'content_translation',state:'ready',configuration:{},health:'unknown',failure:null,observedAt:null});
 assert.deepEqual(await store.execute('configuration',proof('configuration',{servicesVersion:2},op,lease)),four);
 for(const body of [{servicesVersion:3},{servicesVersion:'2'},{servicesVersion:2,extra:true},{version:2}])
  await assert.rejects(store.execute('configuration',proof('configuration',body,randomUUID(),lease)),/invalid_proof/,JSON.stringify(body));
 assert.deepEqual((await store.execute('renew',proof('renew',{}))).services.map(s=>s.service),original);
 const report={revision:0,observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]};
 assert.deepEqual((await store.execute('report',proof('report',report,randomUUID(),lease))).services.map(s=>s.service),original);
});
