import {recordPublicCopy} from './fixtures/public-copy.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';

let db:Awaited<ReturnType<typeof database>>,store:RemoteAccessStore,sequence=0,subnet=100;
const peer=()=>randomBytes(32).toString('base64');
before(async()=>{db=await database();store=new RemoteAccessStore(db.pool);});
after(async()=>db?.close());
async function fixture(){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(`name-${++sequence}@example.test`);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Cafés',legalBusinessName:'Cafés SL',countryCode:'ES'});
 const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(db.pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const installed=await registration.complete(binding);
 const cells=[randomUUID(),randomUUID()];
 for(const [n,id] of cells.entries())await store.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`cell-${id}.example.test`,zone:'venues.example.test',subnet:++subnet,publicKey:peer(),endpoint:`gw.cell-${n===0?'a':'b'}.example.test:51820`});
 const placed=await store.provision(installed.installationId,cells[0]!,peer());
 return {...installed,cells,placed};
}
async function runName(worker:RemoteConfigurationReconciler,id:string,signal?:AbortSignal){
 await worker.schedule();
 assert.equal((await db.pool.query("SELECT count(*)::integer AS n FROM remote_configuration_jobs WHERE kind='name' AND target_id=$1",[id])).rows[0].n,1,'placed venue needs one name job');
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'name' OR target_id<>$1",[id]);
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='name' AND target_id=$1",[id]);
 assert.equal(await worker.runOnce(signal),true);
}
test('a placed venue points its assigned names, including when a custom name is selected',async()=>{
 const current=await fixture(),calls:string[][]=[];
 await db.pool.query("UPDATE remote_hostnames SET hostname='menu.cafe.example.test' WHERE venue_id=$1 AND kind='public'",[current.venueId]);
 const worker=new RemoteConfigurationReconciler(db.pool,{pointName:async(name,target)=>{calls.push([name,target]);}});
 await runName(worker,current.installationId);
 assert.deepEqual(calls,[[`staff-v-${current.venueId}.venues.example.test`,'gw.cell-a.example.test'],[`v-${current.venueId}.venues.example.test`,'gw.cell-a.example.test']]);
 assert.deepEqual((await db.pool.query("SELECT applied_digest=desired_digest AS applied,attempts,last_error FROM remote_configuration_jobs WHERE kind='name' AND target_id=$1",[current.installationId])).rows,[{applied:true,attempts:0,last_error:null}]);
});
test('staged and ready moves keep the source DNS target; committing switches both names',async()=>{
 const current=await fixture(),calls:string[][]=[],worker=new RemoteConfigurationReconciler(db.pool,{pointName:async(name,target)=>{calls.push([name,target]);}});
 const operationId=randomUUID();await store.stageMove({operationId,installationId:current.installationId,targetCellId:current.cells[1]!,targetPeerPublicKey:current.placed.peerPublicKey,expectedRevision:1});
 await runName(worker,current.installationId);assert.deepEqual(calls.map(c=>c[1]),['gw.cell-a.example.test','gw.cell-a.example.test']);calls.length=0;
 const manifest=await store.manifest(current.cells[1]!);await store.markMoveReady(operationId,1,manifest.sequence);
 await runName(worker,current.installationId);assert.deepEqual(calls.map(c=>c[1]),['gw.cell-a.example.test','gw.cell-a.example.test']);calls.length=0;
 await recordPublicCopy(db.pool,operationId);await store.completeMove(operationId,1);await runName(worker,current.installationId);
 assert.deepEqual(calls,[[`staff-v-${current.venueId}.venues.example.test`,'gw.cell-b.example.test'],[`v-${current.venueId}.venues.example.test`,'gw.cell-b.example.test']]);
});
test('a cancelled move leaves both stable names on the source cell',async()=>{
 const current=await fixture(),calls:string[][]=[],worker=new RemoteConfigurationReconciler(db.pool,{pointName:async(name,target)=>{calls.push([name,target]);}});
 const operationId=randomUUID();await store.stageMove({operationId,installationId:current.installationId,targetCellId:current.cells[1]!,targetPeerPublicKey:current.placed.peerPublicKey,expectedRevision:1});await store.cancelMove(operationId,1);
 await runName(worker,current.installationId);assert.deepEqual(calls,[[`staff-v-${current.venueId}.venues.example.test`,'gw.cell-a.example.test'],[`v-${current.venueId}.venues.example.test`,'gw.cell-a.example.test']]);
});
for(const change of ['claim','shutdown'] as const)test(`${change} during the first DNS write prevents the second and any success`,async()=>{
 const current=await fixture(),calls:string[][]=[],stop=new AbortController();
 const worker=new RemoteConfigurationReconciler(db.pool,{pointName:async(name,target)=>{
  calls.push([name,target]);
  if(change==='claim')await db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='name' AND target_id=$1",[current.installationId]);else stop.abort();
 }});
 await runName(worker,current.installationId,stop.signal);
 assert.deepEqual(calls,[[`staff-v-${current.venueId}.venues.example.test`,'gw.cell-a.example.test']]);
 assert.deepEqual((await db.pool.query("SELECT status,attempts,failures::text,applied_digest IS NULL AS unapplied FROM remote_configuration_jobs WHERE kind='name' AND target_id=$1",[current.installationId])).rows,[{status:'pending',attempts:change==='claim'?1:0,failures:change==='claim'?'1':'0',unapplied:true}]);
});
test('a name job continues after nine failures with bounded attempts and delay',async()=>{
 const current=await fixture(),worker=new RemoteConfigurationReconciler(db.pool,{pointName:async()=>{throw Error('synthetic DNS refusal');}});
 for(let n=1;n<=9;n++){
  await runName(worker,current.installationId);
  assert.deepEqual((await db.pool.query("SELECT status,attempts,last_error,available_at>clock_timestamp() AS delayed,available_at<=clock_timestamp()+interval '900 seconds' AS bounded FROM remote_configuration_jobs WHERE kind='name' AND target_id=$1",[current.installationId])).rows,[{status:'pending',attempts:Math.min(n,7),last_error:'reconcile_failed',delayed:true,bounded:true}]);
 }
 await db.pool.query("UPDATE remote_configuration_jobs SET status='running',attempts=8,claim_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE kind='name' AND target_id=$1",[current.installationId,randomUUID()]);
 await runName(worker,current.installationId);
 assert.deepEqual((await db.pool.query("SELECT status,attempts,runs FROM remote_configuration_jobs WHERE kind='name' AND target_id=$1",[current.installationId])).rows,[{status:'pending',attempts:7,runs:'10'}]);
});
