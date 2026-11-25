import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {openProofWindow} from '../../registration/test/fixtures/action-proof.ts';
import {waitLock} from '../../registration/test/fixtures/relay-stop-barrier.ts';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

const origin='https://cloud.example.test';
const operator=randomUUID(),customer=randomUUID(),organisation=randomUUID(),business=randomUUID();
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{
 db=await database();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[operator,customer]);
 await db.pool.query("INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,'venue-operator@example.test','synthetic-hash',clock_timestamp())",[operator]);
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[business,organisation]);
});
after(async()=>db?.close());

function app(enabled=true,production=false,countryCode='ES'){
 const options={pool:db.pool,outbox:db.outbox,operatorAccountId:operator,operatorVenues:enabled,
  config:{portalOrigin:origin,rateKey:db.rateKey,production,countryCode,trustedProxyIps:[]}};
 return createAccountApp(options);
}
const session=(accountId=operator)=>transaction(db.pool,c=>createSession(c,accountId));
const send=(app:ReturnType<typeof createAccountApp>,actor?:Awaited<ReturnType<typeof session>>)=>
 async (path:'read'|'address-lookup',body:unknown)=>app.request(origin+'/api/account/operator/venues/'+path,{
  method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':actor?.csrfToken??'',
   cookie:actor?'__Host-cloud_session='+actor.token:''},body:JSON.stringify(body),
 },{incoming:{socket:{remoteAddress:'192.0.2.25'}}} as HttpBindings);

async function venue(name:string|null,environment='test',scope={organisation,business}){
 const id=randomUUID();
 await db.pool.query('INSERT INTO venues(id,environment,organisation_id,legal_business_id,display_name) VALUES($1,$2,$3,$4,$5)',
  [id,environment,scope.organisation,scope.business,name]);
 return id;
}

test('venue routes are off outside the demo and require the configured operator',async()=>{
 const actor=await session();
 const venueId=await venue('Demo authorization');
 const disabled=send(app(false),actor);
 assert.equal((await disabled('read',{venueId})).status,404);
 assert.equal((await disabled('address-lookup',{venueId,stopped:true})).status,404);
 assert.throws(()=>app(true,true),/operator_venues.*production/);
 const enabled=app();
 const actions=await enabled.request(origin+'/api/account/operator/actions',{
  headers:{cookie:'__Host-cloud_session='+actor.token},
 },{incoming:{socket:{remoteAddress:'192.0.2.25'}}} as HttpBindings);
 assert.equal(actions.status,200);
 assert.equal((await actions.json()).operatorVenues,true);
 assert.equal((await send(enabled)('read',{venueId})).status,401);
 const wrongOperator=send(enabled,await session(customer));
 assert.equal((await wrongOperator('read',{venueId})).status,403);
 assert.equal((await wrongOperator('address-lookup',{venueId,stopped:true})).status,403);
 const withoutProof=send(enabled,actor);
 for(const id of [venueId,randomUUID()]){
  const reply=await withoutProof('address-lookup',{venueId:id,stopped:true});
  assert.equal(reply.status,403);
  assert.deepEqual(await reply.json(),{error:'proof_required'});
 }
});

test('venue search ignores accents and case, treats wildcards literally and records only disclosed venues',async()=>{
 const id=await venue('Café Lunar');
 const other=await venue('Cafe de Luna');
 const outside=await venue('Café Lunar','production');
 const unnamed=await venue(null);
 const actor=await session(),read=send(app(),actor);
 assert.equal((await read('read',{query:'ca'})).status,400);
 assert.equal((await read('read',{query:'\u0301'.repeat(3)})).status,400);
 assert.deepEqual(await (await read('read',{query:'caf%'})).json(),{venues:[]});
 const response=await read('read',{query:'CAFE LUNAR'});
 assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await response.json(),{venues:[{id,name:'Café Lunar',stopped:false}]});
 assert.deepEqual(await (await read('read',{venueId:unnamed})).json(),{venues:[{id:unnamed,name:null,stopped:false}]});
 assert.equal((await read('read',{venueId:outside})).status,404);
 assert.equal((await send(app(true,false,'FR'),actor)('read',{venueId:id})).status,404);
 await openProofWindow(db.pool,actor.token);
 assert.equal((await read('address-lookup',{venueId:outside,stopped:true})).status,404);
 assert.equal((await send(app(true,false,'FR'),actor)('address-lookup',{venueId:id,stopped:true})).status,404);
 const {rows}=await db.pool.query(`SELECT venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id FROM security_audit_events
  WHERE venue_id=ANY($1::uuid[]) ORDER BY occurred_at`,[[id,other,outside,unnamed]]);
 assert.deepEqual(rows,[id,unnamed].map(venueId=>({venue_id:venueId,event_type:'venue.viewed',actor_kind:'platform_account',
  actor_id:operator,subject_kind:'venue',subject_id:venueId})));
});

test('a broad venue search shows no rows until narrowed',async()=>{
 for(let n=0;n<11;n++)await venue('Harbour '+n);
 const read=send(app(),await session());
 const response=await read('read',{query:'Harbour'});
 assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await response.json(),{venues:[],tooMany:true});
 const {rows}=await db.pool.query(`SELECT 1 FROM security_audit_events e JOIN venues v ON v.id=e.venue_id
  WHERE v.display_name LIKE 'Harbour %'`);
 assert.deepEqual(rows,[]);
});

test('a failed history insert blocks disclosure and rolls back the stop',async()=>{
 const venueId=await venue('Audit failure');
 const actor=await session();await openProofWindow(db.pool,actor.token);
 const request=send(app(),actor);
 await db.pool.query(`ALTER TABLE security_audit_events ADD CONSTRAINT test_refuse_venue_audit
  CHECK (venue_id IS DISTINCT FROM '${venueId}'::uuid)`);
 try{
  const read=await request('read',{venueId});
  assert.equal(read.status,503);
  assert.deepEqual(await read.json(),{error:'temporarily_unavailable'});
  const write=await request('address-lookup',{venueId,stopped:true});
  assert.equal(write.status,503);
  const saved=await db.pool.query('SELECT 1 FROM address_lookup_stopped_venues WHERE venue_id=$1',[venueId]);
  assert.equal(saved.rowCount,0);
 }finally{await db.pool.query('ALTER TABLE security_audit_events DROP CONSTRAINT test_refuse_venue_audit');}
});

test('a stop waits for the venue lock and rolls back if fresh proof expires while waiting',async()=>{
 const venueId=await venue('Venue lock');
 const actor=await session();await openProofWindow(db.pool,actor.token);
 const tokenHash=createHash('sha256').update(actor.token).digest('hex');
 const blocker=await db.pool.connect();
 let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[venueId]);
  const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
  const {rows:[{deadline}]}=await db.pool.query(`UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '596 seconds'
   WHERE token_hash=$1 RETURNING action_proved_at+interval '10 minutes' AS deadline`,[tokenHash]);
  pending=send(app(),actor)('address-lookup',{venueId,stopped:true});
  await waitLock(db.secondPool,db.schema,'FOR NO KEY UPDATE OF v',pid);
  await db.secondPool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)",[deadline]);
 }finally{
  await blocker.query('ROLLBACK');blocker.release();
 }
 const response=await pending!;
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'proof_required'});
 assert.equal((await db.pool.query('SELECT 1 FROM address_lookup_stopped_venues WHERE venue_id=$1',[venueId])).rowCount,0);
 assert.equal((await db.pool.query('SELECT 1 FROM security_audit_events WHERE venue_id=$1',[venueId])).rowCount,0);
});

test('search records venues in the same organisation order as owner setup',async()=>{
 const scopes=[0,1].map(()=>({organisation:randomUUID(),business:randomUUID()}))
  .sort((a,b)=>a.organisation.localeCompare(b.organisation));
 const [first,last]=scopes as [typeof scopes[number],typeof scopes[number]];
 for(const scope of scopes){
  await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[scope.organisation]);
  await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[scope.business,scope.organisation]);
 }
 const north=await venue('Ordered audit North','test',last);
 const south=await venue('Ordered audit South','test',first);
 const actor=await session();
 let pending:Promise<Response>|undefined;
 await transaction(db.secondPool,async holder=>{
  await holder.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[first.organisation]);
  const {rows:[{pid}]}=await holder.query('SELECT pg_backend_pid() AS pid');
  pending=send(app(),actor)('read',{query:'Ordered audit'});
  await waitLock(db.pool,db.schema,'INSERT INTO security_audit_events',pid);
  await holder.query("SET LOCAL lock_timeout='500ms'");
  await holder.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[last.organisation]);
 }).catch(async error=>{await pending;throw error;});
 const result=await pending!;
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{venues:[
  {id:north,name:'Ordered audit North',stopped:false},{id:south,name:'Ordered audit South',stopped:false},
 ]});
});

test('the stop takes the organisation before the venue so setup can complete',async()=>{
 const venueId=await venue('Organisation lock');
 const actor=await session();await openProofWindow(db.pool,actor.token);
 let pending:Promise<Response>|undefined;
 await transaction(db.secondPool,async holder=>{
  await holder.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[organisation]);
  const {rows:[{pid}]}=await holder.query('SELECT pg_backend_pid() AS pid');
  pending=send(app(),actor)('address-lookup',{venueId,stopped:true});
  await waitLock(db.pool,db.schema,'',pid);
  await holder.query("SET LOCAL lock_timeout='500ms'");
  await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[venueId]);
 }).catch(async error=>{await pending;throw error;});
 const result=await pending!;
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{id:venueId,name:'Organisation lock',stopped:true});
});
