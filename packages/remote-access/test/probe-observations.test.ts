import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteProbeObservationStore} from '../src/probe-observations.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import type {RemoteProbeResult} from '../src/probe.ts';

const peerKey=()=>randomBytes(32).toString('base64');
const installationKey=()=>generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
let db:Awaited<ReturnType<typeof database>>;

before(async()=>{db=await database();});
after(async()=>db?.close());

async function placed(){
 const signup=new SignupStore(db.pool,db.outbox),email=`evidence-${randomUUID()}@example.test`;
 await signup.request(email);const message=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in message);
 const owner=await signup.complete(message.token,{password:'a long enough evidence password',organisationName:'Evidence',legalBusinessName:'Evidence SL',countryCode:'ES'});
 const input={operationId:randomUUID(),installationKey:installationKey(),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registrations=new RegistrationStore(db.pool);await registrations.start(input);await registrations.approveCloud(input,owner.accountId);await registrations.approveLocal(input,randomUUID());const installation=await registrations.complete(input);
 const remote=new RemoteAccessStore(db.pool),cell=randomUUID();await remote.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'evidence.example.test',subnet:44,publicKey:peerKey(),endpoint:'gateway.example.test:51820'});
 const placement=await remote.provision(installation.installationId,cell,peerKey());
 return {...installation,...placement,revision:1};
}

function result(target:Awaited<ReturnType<typeof placed>>,checkedAt:string,status:'healthy'|'failed'):RemoteProbeResult{
 const service=status==='healthy'
  ?{status,checkedAt,elapsedMs:12,certificate:{notBefore:'2026-09-01T00:00:00.000Z',notAfter:'2026-12-01T00:00:00.000Z',fingerprint256:'AA:BB'}} as const
  :{status,checkedAt,elapsedMs:13,failure:'timeout'} as const;
 return {version:1,installationId:target.installationId,venueId:target.venueId,revision:target.revision,staffHostname:target.staffHostname,publicHostname:target.publicHostname,checkedAt,public:service,staff:service};
}

test('probe evidence survives restart and rejects older, replaced and revoked route results',async()=>{
 const target=await placed(),first='2026-09-25T10:00:00.000Z',older='2026-09-25T09:59:59.000Z',newer='2026-09-25T10:00:01.000Z';
 const store=new RemoteProbeObservationStore(db.pool);assert.equal(await store.record(result(target,first,'healthy')),true);
 assert.equal(await new RemoteProbeObservationStore(db.pool).record(result(target,newer,'failed')),true);
 const afterRestart=await db.pool.query("SELECT service,status,checked_at,last_success_at,last_failure_at,last_failure,certificate_not_after FROM remote_probe_observations WHERE installation_id=$1 ORDER BY service",[target.installationId]);
 assert.deepEqual(afterRestart.rows.map(row=>[row.service,row.status,row.checked_at.toISOString(),row.last_success_at.toISOString(),row.last_failure_at.toISOString(),row.last_failure,row.certificate_not_after.toISOString()]),[
  ['public','failed',newer,first,newer,'timeout','2026-12-01T00:00:00.000Z'],['staff','failed',newer,first,newer,'timeout','2026-12-01T00:00:00.000Z']]);
 assert.equal(await store.record(result(target,older,'healthy')),false);

 const simultaneous=[result(target,'2026-09-25T10:00:03.000Z','healthy'),result(target,'2026-09-25T10:00:02.000Z','failed')];
 await Promise.all([store.record(simultaneous[0]!),new RemoteProbeObservationStore(db.secondPool).record(simultaneous[1]!)]);
 assert.deepEqual((await db.pool.query("SELECT DISTINCT status,checked_at FROM remote_probe_observations WHERE installation_id=$1",[target.installationId])).rows.map(row=>[row.status,row.checked_at.toISOString()]),[['healthy','2026-09-25T10:00:03.000Z']]);

 const future=new Date(Date.now()+10*60*1000).toISOString();
 await assert.rejects(store.record(result(target,future,'healthy')),/invalid_probe_result/);

 await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[target.installationId]);
 assert.equal(await store.record(result(target,'2026-09-25T10:00:04.000Z','failed')),false);
 const revisionTwo={...target,revision:2};assert.equal(await store.record(result(revisionTwo,'2026-09-25T10:00:04.000Z','failed')),true);
 await db.pool.query("UPDATE remote_hostnames SET hostname='new.evidence.example.test' WHERE venue_id=$1 AND kind='public'",[target.venueId]);
 assert.equal(await store.record(result(revisionTwo,'2026-09-25T10:00:05.000Z','healthy')),false);
 const blocker=await db.secondPool.connect();let committed=false;
 try{
  await blocker.query('BEGIN');await blocker.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[target.installationId]);
  let settled=false;const pending=store.record({...result(revisionTwo,'2026-09-25T10:00:06.000Z','healthy'),publicHostname:'new.evidence.example.test'}).then(value=>{settled=true;return value;});
  await delay(50);assert.equal(settled,false);await blocker.query('COMMIT');committed=true;assert.equal(await pending,false);
 }finally{if(!committed)await blocker.query('ROLLBACK');blocker.release();}
 assert.deepEqual((await db.pool.query("SELECT DISTINCT status,checked_at FROM remote_probe_observations WHERE installation_id=$1",[target.installationId])).rows.map(row=>[row.status,row.checked_at.toISOString()]),[['failed','2026-09-25T10:00:04.000Z']]);
});
